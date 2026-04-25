import type { eventWithTime } from "@rrweb/types";
import type {
  RecorderConfig,
  AgentReplayEvent,
  ConsoleEntry,
  NetworkEntry,
  ErrorEntry,
  Transport,
} from "./types.js";
import { getOrCreateSession } from "./session.js";

type EventCallback = (event: AgentReplayEvent) => void;

interface RecorderState {
  rrwebStop: (() => void) | null;
  networkCleanup: (() => void) | null;
  errorCleanup: (() => void) | null;
  listeners: EventCallback[];
  buffer: AgentReplayEvent[];
  flushTimer: ReturnType<typeof setInterval> | null;
  transport: Transport | null;
  config: Required<
    Pick<
      RecorderConfig,
      | "captureConsole"
      | "captureNetwork"
      | "captureDom"
      | "batchSize"
      | "flushIntervalMs"
    >
  >;
}

let state: RecorderState | null = null;

function getSessionStart(): number {
  const session = getOrCreateSession();
  return new Date(session.startedAt).getTime();
}

function emit(event: AgentReplayEvent): void {
  if (!state) return;
  state.buffer.push(event);
  for (const cb of state.listeners) cb(event);
  if (state.buffer.length >= state.config.batchSize) {
    void flush();
  }
}

async function flush(): Promise<void> {
  if (!state || state.buffer.length === 0) return;
  const batch = state.buffer.splice(0);
  if (state.transport) {
    try {
      await state.transport.send(batch);
    } catch {
      // Re-add events on failure
      state.buffer.unshift(...batch);
    }
  }
}

// ── Network interception ─────────────────────────────────

function interceptNetwork(
  sessionId: string,
  ignorePatterns: (string | RegExp)[] = []
): () => void {
  const sessionStart = getSessionStart();

  function shouldIgnore(url: string): boolean {
    return ignorePatterns.some((p) =>
      typeof p === "string" ? url.includes(p) : p.test(url)
    );
  }

  // Patch fetch
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

    if (shouldIgnore(url)) return originalFetch.call(window, input, init);

    const method = init?.method ?? "GET";
    const start = Date.now();

    try {
      const response = await originalFetch.call(window, input, init);
      const now = Date.now();
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: method.toUpperCase(),
        url,
        status: response.status,
        statusText: response.statusText,
        durationMs: now - start,
        initiator: "fetch",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });

      // Also emit as error if 5xx
      if (response.status >= 500) {
        const errEntry: ErrorEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          message: `${method.toUpperCase()} ${url} returned ${response.status}`,
          type: "error",
          source: "network",
        };
        emit({ type: "error", timestamp: now, sessionId, data: errEntry });
      }

      return response;
    } catch (err) {
      const now = Date.now();
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: method.toUpperCase(),
        url,
        status: null,
        durationMs: now - start,
        error: err instanceof Error ? err.message : String(err),
        initiator: "fetch",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
      throw err;
    }
  };

  // Patch XMLHttpRequest
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  type XHRWithMeta = XMLHttpRequest & { _arMethod: string; _arUrl: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (XHR as any).open = function xhrOpen(
    this: XHRWithMeta,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this._arMethod = method;
    this._arUrl = String(url);
    return (originalOpen as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (XHR as any).send = function xhrSend(
    this: XHRWithMeta,
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    if (shouldIgnore(this._arUrl)) {
      return originalSend.call(this, body);
    }

    const start = Date.now();
    const xhr = this;
    xhr.addEventListener("loadend", () => {
      const now = Date.now();
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: (xhr._arMethod ?? "GET").toUpperCase(),
        url: xhr._arUrl ?? "",
        status: xhr.status || null,
        statusText: xhr.statusText,
        durationMs: now - start,
        initiator: "xhr",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
    });
    return originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XHR as any).open = originalOpen;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XHR as any).send = originalSend;
  };
}

// ── Error interception ───────────────────────────────────

function interceptErrors(sessionId: string): () => void {
  const sessionStart = getSessionStart();

  const onError = (event: ErrorEvent) => {
    const now = Date.now();
    const entry: ErrorEntry = {
      timestamp: now,
      offsetMs: now - sessionStart,
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      type: "error",
    };
    emit({ type: "error", timestamp: now, sessionId, data: entry });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const now = Date.now();
    const entry: ErrorEntry = {
      timestamp: now,
      offsetMs: now - sessionStart,
      message:
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason),
      stack:
        event.reason instanceof Error ? event.reason.stack : undefined,
      type: "unhandledrejection",
    };
    emit({ type: "error", timestamp: now, sessionId, data: entry });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

// ── Public API ───────────────────────────────────────────

export async function startRecording(
  config: RecorderConfig = {},
  transport?: Transport
): Promise<void> {
  if (typeof window === "undefined") return;
  if (state) return; // Already recording

  const session = getOrCreateSession(config.sessionId);

  const resolvedConfig = {
    captureConsole: config.captureConsole ?? true,
    captureNetwork: config.captureNetwork ?? true,
    captureDom: config.captureDom ?? true,
    batchSize: config.batchSize ?? 50,
    flushIntervalMs: config.flushIntervalMs ?? 2000,
  };

  state = {
    rrwebStop: null,
    networkCleanup: null,
    errorCleanup: null,
    listeners: [],
    buffer: [],
    flushTimer: null,
    transport: transport ?? null,
    config: resolvedConfig,
  };

  // Start rrweb DOM recording
  if (resolvedConfig.captureDom) {
    // rrweb doesn't have proper ESM exports, so we need a workaround
    const rrwebModule = await import("rrweb") as unknown as {
      record: <T = eventWithTime>(options?: {
        emit?: (e: T, isCheckout?: boolean) => void;
        blockSelector?: string;
        sampling?: Record<string, unknown>;
        plugins?: unknown[];
      }) => (() => void) | undefined;
    };
    const { record } = rrwebModule;
    const plugins: unknown[] = [];

    if (resolvedConfig.captureConsole) {
      const { getRecordConsolePlugin } = await import(
        "@rrweb/rrweb-plugin-console-record"
      );
      plugins.push(
        getRecordConsolePlugin({
          level: ["log", "info", "warn", "error", "debug"],
          lengthThreshold: 1000,
        })
      );
    }

    const sessionStart = getSessionStart();

    const stopFn = record({
      emit(event: eventWithTime) {
        const rrwebEvent: AgentReplayEvent = {
          type: "rrweb",
          timestamp: Date.now(),
          sessionId: session.id,
          data: event,
        };
        emit(rrwebEvent);

        // Extract console events from rrweb plugin events
        if (
          resolvedConfig.captureConsole &&
          event.type === 6 // Plugin event type
        ) {
          const pluginData = (event as unknown as { data: { plugin: string; payload: { level: string; payload: unknown[]; trace?: string[] } } }).data;
          if (pluginData?.plugin === "rrweb/console@1") {
            const payload = pluginData.payload;
            const consoleEntry: ConsoleEntry = {
              timestamp: Date.now(),
              offsetMs: Date.now() - sessionStart,
              level: payload.level as ConsoleEntry["level"],
              args: payload.payload,
              trace: payload.trace?.join("\n"),
            };
            emit({
              type: "console",
              timestamp: Date.now(),
              sessionId: session.id,
              data: consoleEntry,
            });
          }
        }
      },
      blockSelector: config.ignoreSelectors?.join(", ") ?? undefined,
      sampling: config.sampling
        ? {
            mousemove: config.sampling.mousemove,
            mouseInteraction: config.sampling.mouseInteraction,
            scroll: config.sampling.scroll,
            media: config.sampling.media,
            input: config.sampling.input,
          }
        : undefined,
      plugins: plugins,
    });

    state.rrwebStop = stopFn ?? null;
  }

  // Network interception
  if (resolvedConfig.captureNetwork) {
    state.networkCleanup = interceptNetwork(
      session.id,
      config.ignoreNetworkPatterns
    );
  }

  // Error interception
  state.errorCleanup = interceptErrors(session.id);

  // Periodic flush
  state.flushTimer = setInterval(() => {
    void flush();
  }, resolvedConfig.flushIntervalMs);
}

export async function stopRecording(): Promise<void> {
  if (!state) return;

  // Stop rrweb
  state.rrwebStop?.();

  // Remove network patches
  state.networkCleanup?.();

  // Remove error listeners
  state.errorCleanup?.();

  // Clear flush timer
  if (state.flushTimer) clearInterval(state.flushTimer);

  // Final flush
  await flush();

  // Close transport
  if (state.transport) {
    await state.transport.flush();
    await state.transport.close();
  }

  state = null;
}

export function onEvent(callback: EventCallback): () => void {
  if (!state) return () => {};
  state.listeners.push(callback);
  return () => {
    if (state) {
      state.listeners = state.listeners.filter((cb) => cb !== callback);
    }
  };
}

export function getBufferedEvents(): AgentReplayEvent[] {
  return state?.buffer.slice() ?? [];
}
