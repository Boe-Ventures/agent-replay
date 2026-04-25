export default defineBackground(() => {
  const SIDECAR_URL = "http://localhost:3700";

  // ── State ──────────────────────────────────────────
  interface TabRecording {
    sessionId: string;
    url: string;
    eventCount: number;
    sidecarConnected: boolean;
    startedAt: number;
  }

  const activeRecordings = new Map<number, TabRecording>();
  let sidecarAvailable = false;

  // ── Sidecar health check ───────────────────────────
  async function checkSidecar(): Promise<boolean> {
    try {
      const res = await fetch(`${SIDECAR_URL}/sessions`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      sidecarAvailable = res.ok;
    } catch {
      sidecarAvailable = false;
    }
    return sidecarAvailable;
  }

  // Check sidecar on startup and every 30 seconds
  void checkSidecar();
  setInterval(() => void checkSidecar(), 30_000);

  // ── Message handling from content scripts ──────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    switch (message.type) {
      case "RECORDING_STARTED":
        if (tabId != null) {
          activeRecordings.set(tabId, {
            sessionId: message.sessionId,
            url: message.url,
            eventCount: 0,
            sidecarConnected: sidecarAvailable,
            startedAt: Date.now(),
          });
          updateBadge(tabId, true);
        }
        break;

      case "RECORDING_STOPPED":
        if (tabId != null) {
          activeRecordings.delete(tabId);
          updateBadge(tabId, false);
        }
        break;

      case "STATUS_UPDATE":
        if (tabId != null) {
          const recording = activeRecordings.get(tabId);
          if (recording) {
            recording.eventCount = message.eventCount;
            recording.sidecarConnected = message.sidecarConnected;
            recording.url = message.url;
          }
        }
        break;

      case "GET_STATUS":
        // Popup requests current state
        if (tabId != null) {
          const rec = activeRecordings.get(tabId);
          sendResponse({
            recording: rec ?? null,
            sidecarAvailable,
          });
        } else {
          // Popup doesn't have a tab, query active tab
          chrome.tabs.query(
            { active: true, currentWindow: true },
            (tabs) => {
              const activeTabId = tabs[0]?.id;
              const rec =
                activeTabId != null
                  ? activeRecordings.get(activeTabId)
                  : null;
              sendResponse({
                recording: rec ?? null,
                sidecarAvailable,
              });
            }
          );
          return true; // Async response
        }
        break;

      case "GET_ALL_RECORDINGS":
        sendResponse({
          recordings: Object.fromEntries(activeRecordings),
          sidecarAvailable,
        });
        break;
    }
  });

  // ── Tab lifecycle ──────────────────────────────────
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeRecordings.delete(tabId);
  });

  // Track URL changes for session rotation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading" && activeRecordings.has(tabId)) {
      // Tab is navigating — content script will re-inject and start a new session
      activeRecordings.delete(tabId);
      updateBadge(tabId, false);
    }
  });

  // ── Badge ──────────────────────────────────────────
  function updateBadge(tabId: number, recording: boolean) {
    if (recording) {
      chrome.action.setBadgeText({ text: "REC", tabId });
      chrome.action.setBadgeBackgroundColor({
        color: "#ef4444",
        tabId,
      });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  }
});
