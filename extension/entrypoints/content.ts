import type { eventWithTime } from "@rrweb/types";

export default defineContentScript({
  matches: ["http://localhost:*/*", "http://127.0.0.1:*/*"],
  runAt: "document_idle",

  async main() {
    // Defer if the npm package AgentReplayProvider is already active
    if ((window as any).__AGENT_REPLAY_ACTIVE__) {
      console.log("[agent-replay-ext] Provider detected, deferring.");
      return;
    }

    const SIDECAR_URL = "http://localhost:3700";
    const FLUSH_INTERVAL_MS = 2000;
    const BATCH_SIZE = 50;

    // ── Session ID ─────────────────────────────────────
    const sessionId = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");
    const sessionStart = Date.now();

    // ── Event buffer ───────────────────────────────────
    let buffer: any[] = [];
    let eventCount = 0;
    let sidecarConnected = false;

    function emit(type: string, data: unknown) {
      const event = {
        type,
        timestamp: Date.now(),
        sessionId,
        data,
      };
      buffer.push(event);
      eventCount++;
      if (buffer.length >= BATCH_SIZE) {
        void flush();
      }
    }

    async function flush() {
      if (buffer.length === 0) return;
      const batch = buffer.splice(0);
      try {
        const res = await fetch(`${SIDECAR_URL}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
        });
        if (res.ok) {
          sidecarConnected = true;
        } else {
          sidecarConnected = false;
          buffer.unshift(...batch);
        }
      } catch {
        sidecarConnected = false;
        // Keep events in buffer, cap at 5000 to avoid memory issues
        buffer.unshift(...batch);
        if (buffer.length > 5000) {
          buffer = buffer.slice(-5000);
        }
      }
      // Notify popup of state changes
      try {
        chrome.runtime.sendMessage({
          type: "STATUS_UPDATE",
          sessionId,
          eventCount,
          sidecarConnected,
          url: window.location.href,
        });
      } catch {
        // Extension context may be invalidated
      }
    }

    // ── Check sidecar availability ─────────────────────
    try {
      const res = await fetch(`${SIDECAR_URL}/sessions`, {
        method: "GET",
      });
      sidecarConnected = res.ok;
    } catch {
      sidecarConnected = false;
    }

    // ── rrweb DOM recording ────────────────────────────
    const { record } = await import("rrweb");
    const { getRecordConsolePlugin } = await import(
      "@rrweb/rrweb-plugin-console-record"
    );

    const stopRrweb = record({
      emit(event: eventWithTime) {
        emit("rrweb", event);

        // Extract console entries from rrweb plugin events
        if (event.type === 6) {
          const pluginData = (event as any).data;
          if (pluginData?.plugin === "rrweb/console@1") {
            const payload = pluginData.payload;
            emit("console", {
              timestamp: Date.now(),
              offsetMs: Date.now() - sessionStart,
              level: payload.level,
              args: payload.payload,
              trace: payload.trace?.join("\n"),
            });
          }
        }
      },
      plugins: [
        getRecordConsolePlugin({
          level: ["log", "info", "warn", "error", "debug"],
          lengthThreshold: 1000,
        }),
      ],
      sampling: {
        mousemove: 50,
        mouseInteraction: true,
        scroll: 150,
        input: "last",
      },
    });

    // ── Network interception (fetch) ───────────────────
    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      // Don't intercept our own sidecar calls
      if (url.startsWith(SIDECAR_URL)) {
        return originalFetch.call(window, input, init);
      }

      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const start = performance.now();

      try {
        const response = await originalFetch.call(window, input, init);
        const now = Date.now();
        const durationMs = Math.round((performance.now() - start) * 100) / 100;

        emit("network", {
          timestamp: now,
          offsetMs: now - sessionStart,
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          isError: response.status >= 400,
          initiator: "fetch",
        });

        if (response.status >= 500) {
          emit("error", {
            timestamp: now,
            offsetMs: now - sessionStart,
            message: `${method} ${url} returned ${response.status}`,
            type: "error",
            source: "network",
          });
        }

        return response;
      } catch (err) {
        const now = Date.now();
        emit("network", {
          timestamp: now,
          offsetMs: now - sessionStart,
          method,
          url,
          status: null,
          durationMs: Math.round((performance.now() - start) * 100) / 100,
          error: err instanceof Error ? err.message : String(err),
          isError: true,
          initiator: "fetch",
        });
        throw err;
      }
    };

    // ── Network interception (XHR) ─────────────────────
    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;

    (XHR as any).open = function (
      this: any,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this._arMethod = method;
      this._arUrl = String(url);
      return (originalOpen as any).call(this, method, url, ...rest);
    };

    (XHR as any).send = function (this: any, body?: any) {
      if (
        typeof this._arUrl === "string" &&
        this._arUrl.startsWith(SIDECAR_URL)
      ) {
        return originalSend.call(this, body);
      }

      this._arStartTime = performance.now();
      const xhr = this;

      xhr.addEventListener("loadend", () => {
        const now = Date.now();
        const durationMs =
          Math.round((performance.now() - xhr._arStartTime) * 100) / 100;
        emit("network", {
          timestamp: now,
          offsetMs: now - sessionStart,
          method: (xhr._arMethod ?? "GET").toUpperCase(),
          url: xhr._arUrl ?? "",
          status: xhr.status || null,
          statusText: xhr.statusText,
          durationMs,
          isError: xhr.status >= 400 || xhr.status === 0,
          initiator: "xhr",
        });
      });

      xhr.addEventListener("error", () => {
        const now = Date.now();
        emit("network", {
          timestamp: now,
          offsetMs: now - sessionStart,
          method: (xhr._arMethod ?? "GET").toUpperCase(),
          url: xhr._arUrl ?? "",
          status: null,
          durationMs:
            Math.round((performance.now() - xhr._arStartTime) * 100) / 100,
          error: "Network error",
          isError: true,
          initiator: "xhr",
        });
      });

      return originalSend.call(this, body);
    };

    // ── Error interception ─────────────────────────────
    window.addEventListener("error", (event) => {
      const now = Date.now();
      emit("error", {
        timestamp: now,
        offsetMs: now - sessionStart,
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack,
        type: "error",
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      const now = Date.now();
      emit("error", {
        timestamp: now,
        offsetMs: now - sessionStart,
        message:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
        stack:
          event.reason instanceof Error ? event.reason.stack : undefined,
        type: "unhandledrejection",
      });
    });

    // ── Periodic flush ─────────────────────────────────
    const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

    // ── Notify background of active recording ──────────
    try {
      chrome.runtime.sendMessage({
        type: "RECORDING_STARTED",
        sessionId,
        url: window.location.href,
      });
    } catch {
      // Extension context may be invalidated
    }

    // ── Cleanup on unload ──────────────────────────────
    window.addEventListener("beforeunload", () => {
      clearInterval(flushTimer);
      stopRrweb?.();
      window.fetch = originalFetch;
      (XHR as any).open = originalOpen;
      (XHR as any).send = originalSend;
      // Final sync flush via sendBeacon
      if (buffer.length > 0) {
        const blob = new Blob(
          [JSON.stringify({ events: buffer.splice(0) })],
          { type: "application/json" }
        );
        navigator.sendBeacon(`${SIDECAR_URL}/events`, blob);
      }
      try {
        chrome.runtime.sendMessage({
          type: "RECORDING_STOPPED",
          sessionId,
          eventCount,
        });
      } catch {
        // Context may be invalidated
      }
    });

    // Set the global flag so we don't double-record if the provider loads later
    (window as any).__AGENT_REPLAY_ACTIVE__ = "extension";

    console.log(
      `[agent-replay-ext] Recording started (session: ${sessionId}, sidecar: ${sidecarConnected ? "connected" : "disconnected"})`
    );
  },
});
