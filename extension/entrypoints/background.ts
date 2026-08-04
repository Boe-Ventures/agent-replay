export default defineBackground(() => {
  const SIDECAR_URL = "http://127.0.0.1:3700";
  const SESSION_TIMEOUT = 30 * 60 * 1000;

  interface TabRecording {
    sessionId: string;
    url: string;
    eventCount: number;
    sidecarConnected: boolean;
    startedAt: number;
    lastSeenAt: number;
    mode: "rolling" | "demo";
    demoCaptureId?: string;
  }

  let activeRecordings = new Map<number, TabRecording>();
  let sidecarAvailable = false;

  async function persist(): Promise<void> {
    await chrome.storage.session.set({ activeRecordings: Object.fromEntries(activeRecordings) });
  }

  async function restore(): Promise<void> {
    const stored = await chrome.storage.session.get("activeRecordings");
    const entries = Object.entries((stored.activeRecordings ?? {}) as Record<string, TabRecording>);
    activeRecordings = new Map(entries.map(([key, value]) => [Number(key), value]));
    for (const [tabId, recording] of activeRecordings) updateBadge(tabId, recording);
  }

  async function checkSidecar(): Promise<boolean> {
    try {
      const response = await fetch(SIDECAR_URL + "/api/v1/health", { signal: AbortSignal.timeout(2_000) });
      sidecarAvailable = response.ok;
    } catch {
      sidecarAvailable = false;
    }
    return sidecarAvailable;
  }

  function updateBadge(tabId: number, recording?: TabRecording): void {
    const demo = Boolean(recording?.demoCaptureId);
    void chrome.action.setBadgeText({ text: recording ? demo ? "DEMO" : "REC" : "", tabId });
    if (recording) void chrome.action.setBadgeBackgroundColor({ color: demo ? "#7c3aed" : "#ef4444", tabId });
  }

  async function ensureOffscreen(): Promise<void> {
    const url = chrome.runtime.getURL("offscreen.html");
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
    if (contexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Record the active development tab to a local WebM demo.",
      });
    }
  }

  async function getOrCreate(tabId: number, url: string): Promise<TabRecording> {
    const existing = activeRecordings.get(tabId);
    const now = Date.now();
    if (existing && now - existing.lastSeenAt <= SESSION_TIMEOUT) {
      existing.url = url;
      existing.lastSeenAt = now;
      await persist();
      return existing;
    }
    const recording: TabRecording = {
      sessionId: crypto.randomUUID(), url, eventCount: 0, sidecarConnected: sidecarAvailable,
      startedAt: now, lastSeenAt: now, mode: "rolling",
    };
    activeRecordings.set(tabId, recording);
    updateBadge(tabId, recording);
    await persist();
    return recording;
  }

  async function startDemo(tabId: number, audio = false): Promise<TabRecording> {
    const tab = await chrome.tabs.get(tabId);
    const recording = await getOrCreate(tabId, tab.url ?? "");
    if (recording.demoCaptureId) return recording;
    await ensureOffscreen();
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        const error = chrome.runtime.lastError;
        if (error || !id) reject(new Error(error?.message ?? "Unable to capture this tab"));
        else resolve(id);
      });
    });
    recording.demoCaptureId = crypto.randomUUID();
    recording.mode = "demo";
    await chrome.runtime.sendMessage({
      target: "offscreen", type: "START_DEMO", streamId,
      sessionId: recording.sessionId, captureId: recording.demoCaptureId,
      sidecarUrl: SIDECAR_URL, audio,
    });
    updateBadge(tabId, recording);
    await persist();
    return recording;
  }

  async function stopDemo(tabId: number): Promise<void> {
    const recording = activeRecordings.get(tabId);
    if (!recording?.demoCaptureId) return;
    await chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_DEMO", captureId: recording.demoCaptureId });
    recording.demoCaptureId = undefined;
    recording.mode = "rolling";
    updateBadge(tabId, recording);
    await persist();
  }

  void restore();
  void checkSidecar();
  setInterval(() => void checkSidecar(), 30_000);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === "offscreen") return;
    const tabId = message.tabId ?? sender.tab?.id;
    void (async () => {
      if (message.type === "GET_OR_CREATE_SESSION" && tabId != null) {
        const recording = await getOrCreate(tabId, message.url ?? sender.tab?.url ?? "");
        sendResponse({ recording, pageId: crypto.randomUUID(), sidecarAvailable });
      } else if (message.type === "STATUS_UPDATE" && tabId != null) {
        const recording = activeRecordings.get(tabId);
        if (recording) {
          recording.eventCount = message.eventCount;
          recording.sidecarConnected = message.sidecarConnected;
          recording.url = message.url;
          recording.lastSeenAt = Date.now();
          await persist();
        }
        sendResponse({ ok: true });
      } else if (message.type === "GET_STATUS") {
        const resolvedTabId = tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        sendResponse({ recording: resolvedTabId == null ? null : activeRecordings.get(resolvedTabId) ?? null, sidecarAvailable });
      } else if (message.type === "START_DEMO" && tabId != null) {
        sendResponse({ recording: await startDemo(tabId, Boolean(message.audio)) });
      } else if (message.type === "STOP_DEMO" && tabId != null) {
        await stopDemo(tabId);
        sendResponse({ ok: true });
      } else if (message.type === "GET_DEMO_STATUS") {
        const status = await chrome.runtime.sendMessage({ target: "offscreen", type: "GET_DEMO_STATUS" });
        sendResponse(status);
      } else if (message.type === "OPEN_VIEWER") {
        await chrome.tabs.create({ url: SIDECAR_URL });
        sendResponse({ ok: true });
      } else if (message.type === "DEMO_FINISHED") {
        const match = [...activeRecordings.entries()].find(([, recording]) => recording.demoCaptureId === message.captureId);
        if (match) {
          const [resolvedTabId, recording] = match;
          recording.demoCaptureId = undefined;
          recording.mode = "rolling";
          updateBadge(resolvedTabId, recording);
          await persist();
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    })().catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void stopDemo(tabId).finally(() => {
      activeRecordings.delete(tabId);
      void persist();
    });
  });
});
