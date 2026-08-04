export default defineContentScript({
  matches: ["http://localhost:*/*", "http://127.0.0.1:*/*"],
  runAt: "document_start",
  async main() {
    const SIDECAR = "http://127.0.0.1:3700";
    const identity = await chrome.runtime.sendMessage({ type: "GET_OR_CREATE_SESSION", url: location.href }) as {
      recording: { sessionId: string; startedAt: number }; pageId: string; sidecarAvailable: boolean;
    };
    const { sessionId } = identity.recording;
    const pageId = identity.pageId;
    let sequence = 0;
    let eventCount = 0;
    let sidecarConnected = identity.sidecarAvailable;
    let providerDetected = false;
    let buffer: unknown[] = [];
    let sending = false;
    const startedAt = identity.recording.startedAt;
    const secret = /authorization|cookie|password|secret|token|api[-_]?key|session(?:id)?|credential/i;
    const redact = (value: unknown, key = ""): unknown => {
      if (secret.test(key)) return "[REDACTED]";
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (typeof parsed === "object" && parsed != null) return JSON.stringify(redact(parsed));
        } catch { /* ordinary text */ }
        return value.replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]");
      }
      if (Array.isArray(value)) return value.map((item) => redact(item));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [childKey, redact(item, childKey)]));
      return value;
    };

    const flush = async () => {
      if (sending || buffer.length === 0 || providerDetected) return;
      sending = true;
      const batch = buffer.splice(0, 250);
      try {
        const response = await fetch(SIDECAR + "/api/v1/events", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            events: batch,
            sessionMetadata: {
              id: sessionId, schemaVersion: 1, startedAt: new Date(startedAt).toISOString(),
              status: "active", mode: "rolling", privacyPreset: "safe", url: location.href,
              userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight },
              metadata: { source: "chrome-extension" },
            },
            pageMetadata: { id: pageId, url: location.href, title: document.title, startedAt: new Date().toISOString() },
          }),
        });
        sidecarConnected = response.ok;
        if (!response.ok) buffer.unshift(...batch);
      } catch {
        sidecarConnected = false;
        buffer.unshift(...batch);
        if (buffer.length > 5_000) buffer = buffer.slice(-5_000);
      } finally {
        sending = false;
        void chrome.runtime.sendMessage({ type: "STATUS_UPDATE", eventCount, sidecarConnected, url: location.href });
        if (buffer.length >= 250) void flush();
      }
    };

    addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "agent-replay-main-v1") return;
      if (event.data.type === "PROVIDER_DETECTED") {
        providerDetected = true;
        buffer = [];
        return;
      }
      if (event.data.type !== "EVENT" || providerDetected) return;
      const timestamp = Date.now();
      buffer.push({
        id: crypto.randomUUID(), type: event.data.signal, sequence: sequence++, timestamp,
        offsetMs: Math.max(0, timestamp - startedAt), sessionId, pageId, data: redact(event.data.data),
      });
      eventCount++;
      if (buffer.length >= 50) void flush();
    });
    window.postMessage({ source: "agent-replay-isolated-v1", type: "INIT", sessionId, pageId }, "*");
    const timer = setInterval(() => void flush(), 2_000);
    addEventListener("pagehide", () => {
      clearInterval(timer);
      if (buffer.length && !providerDetected) {
        navigator.sendBeacon(SIDECAR + "/api/v1/events", new Blob([JSON.stringify({ events: buffer })], { type: "application/json" }));
      }
    });
  },
});
