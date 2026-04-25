import type { eventWithTime } from "@rrweb/types";
import type {
  RecorderConfig,
  NetworkConfig,
  AgentReplayEvent,
  ConsoleEntry,
  NetworkEntry,
  WebSocketEntry,
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

// ── Utilities ────────────────────────────────────────────

const DEFAULT_MAX_BODY_SIZE = 64 * 1024; // 64KB
const DEFAULT_MAX_WS_MESSAGE_SIZE = 16 * 1024; // 16KB
const DEFAULT_BODY_TIMEOUT = 500; // ms

/** Resolve a NetworkConfig with defaults */
function resolveNetworkConfig(config?: NetworkConfig): Required<Omit<NetworkConfig, "ignoreUrls">> & { ignoreUrls: (string | RegExp)[] } {
  return {
    captureRequestBody: config?.captureRequestBody ?? true,
    captureResponseBody: config?.captureResponseBody ?? true,
    captureHeaders: config?.captureHeaders ?? true,
    captureWebSocket: config?.captureWebSocket ?? true,
    maxBodySize: config?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE,
    maxWebSocketMessageSize: config?.maxWebSocketMessageSize ?? DEFAULT_MAX_WS_MESSAGE_SIZE,
    bodyTimeout: config?.bodyTimeout ?? DEFAULT_BODY_TIMEOUT,
    ignoreUrls: config?.ignoreUrls ?? [],
  };
}

/** Truncate a string to maxBytes, appending a marker if truncated */
function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return value.slice(0, maxBytes) + `… [truncated, ${value.length} bytes total]`;
}

/** Safely serialize a request body to string */
function serializeRequestBody(body: BodyInit | null | undefined, maxBytes: number): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return truncate(body, maxBytes);
  if (body instanceof URLSearchParams) return truncate(body.toString(), maxBytes);
  if (body instanceof FormData) {
    // Serialize FormData keys for visibility (values may be files)
    const parts: string[] = [];
    body.forEach((val, key) => {
      if (val instanceof File) {
        parts.push(`${key}: [File: ${val.name}, ${val.size} bytes]`);
      } else {
        parts.push(`${key}: ${val}`);
      }
    });
    return truncate(`FormData { ${parts.join(", ")} }`, maxBytes);
  }
  if (body instanceof Blob) return `[Blob: ${body.size} bytes, ${body.type || "unknown"}]`;
  if (body instanceof ArrayBuffer) return `[ArrayBuffer: ${body.byteLength} bytes]`;
  if (ArrayBuffer.isView(body)) return `[${body.constructor.name}: ${body.byteLength} bytes]`;
  if (body instanceof ReadableStream) return "[ReadableStream]";
  return "[Unknown body type]";
}

/** Extract headers from a Headers object, Request, or init */
function extractHeaders(source: HeadersInit | Headers | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!source) return result;
  if (source instanceof Headers) {
    source.forEach((v, k) => { result[k] = v; });
  } else if (Array.isArray(source)) {
    for (const [k, v] of source) result[k] = v;
  } else if (typeof source === "object") {
    for (const [k, v] of Object.entries(source)) result[k] = String(v);
  }
  return result;
}

/** Parse raw XHR response headers string into a record */
function parseXhrHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const line of raw.split("\r\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      headers[line.slice(0, idx).toLowerCase()] = line.slice(idx + 2);
    }
  }
  return headers;
}

/** Read a response body with a timeout to handle streaming */
function readBodyWithTimeout(response: Response, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve("[Streaming response — body not captured within timeout]");
    }, timeoutMs);

    response
      .text()
      .then((text) => {
        clearTimeout(timer);
        resolve(text);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

/** Read XHR response body, handling different responseType values */
function readXhrResponseBody(xhr: XMLHttpRequest): string | undefined {
  try {
    const rt = xhr.responseType;
    if (rt === "" || rt === "text") {
      return xhr.responseText;
    }
    if (rt === "json") {
      return xhr.response != null ? JSON.stringify(xhr.response) : undefined;
    }
    if (rt === "document") {
      const doc = xhr.response as Document | null;
      return doc?.documentElement?.outerHTML ?? undefined;
    }
    if (rt === "arraybuffer") {
      const buf = xhr.response as ArrayBuffer | null;
      return buf ? `[ArrayBuffer: ${buf.byteLength} bytes]` : undefined;
    }
    if (rt === "blob") {
      const blob = xhr.response as Blob | null;
      return blob ? `[Blob: ${blob.size} bytes, ${blob.type || "unknown"}]` : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// ── PerformanceObserver matching ─────────────────────────

interface PerfTimingData {
  transferSize: number;
  encodedBodySize: number;
  ttfb: number; // responseStart - requestStart
  initiatorType: string;
}

/**
 * Tracks PerformanceResourceTiming entries and matches them to captured requests.
 * Uses URL + timing proximity to correlate entries.
 */
class PerformanceTracker {
  private entries = new Map<string, PerfTimingData[]>();
  private observer: PerformanceObserver | null = null;

  start(): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const res = entry as PerformanceResourceTiming;
          const data: PerfTimingData = {
            transferSize: res.transferSize,
            encodedBodySize: res.encodedBodySize,
            ttfb: res.responseStart > 0 ? res.responseStart - res.requestStart : 0,
            initiatorType: res.initiatorType,
          };
          const existing = this.entries.get(res.name) ?? [];
          existing.push(data);
          this.entries.set(res.name, existing);
        }
      });
      this.observer.observe({ type: "resource", buffered: true });
    } catch {
      // PerformanceObserver not supported
    }
  }

  /** Pop the latest performance data for a URL */
  consume(url: string): PerfTimingData | undefined {
    const entries = this.entries.get(url);
    if (!entries || entries.length === 0) return undefined;
    return entries.pop();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.entries.clear();
  }
}

// ── Network interception ─────────────────────────────────

function interceptNetwork(
  sessionId: string,
  ignorePatterns: (string | RegExp)[] = [],
  networkConfig?: NetworkConfig
): () => void {
  const sessionStart = getSessionStart();
  const cfg = resolveNetworkConfig(networkConfig);

  // Merge ignore patterns: explicit config + NetworkConfig.ignoreUrls
  const allIgnorePatterns = [...ignorePatterns, ...cfg.ignoreUrls];

  function shouldIgnore(url: string): boolean {
    return allIgnorePatterns.some((p) =>
      typeof p === "string" ? url.includes(p) : p.test(url)
    );
  }

  // Start PerformanceObserver
  const perfTracker = new PerformanceTracker();
  perfTracker.start();

  // ── Fetch interception ───────────────────────────────

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

    const method = (
      init?.method ??
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const start = performance.now();
    const startTimestamp = Date.now();

    // Capture request headers
    let requestHeaders: Record<string, string> | undefined;
    if (cfg.captureHeaders) {
      if (input instanceof Request) {
        requestHeaders = extractHeaders(input.headers);
        // Merge any init headers on top
        if (init?.headers) {
          Object.assign(requestHeaders, extractHeaders(init.headers));
        }
      } else {
        requestHeaders = extractHeaders(init?.headers);
      }
    }

    // Capture request body
    let requestBody: string | undefined;
    if (cfg.captureRequestBody) {
      const body = init?.body ?? (input instanceof Request ? input.body : undefined);
      requestBody = serializeRequestBody(body as BodyInit | null | undefined, cfg.maxBodySize);
    }

    try {
      const response = await originalFetch.call(window, input, init);
      const now = Date.now();
      const durationMs = performance.now() - start;

      // Capture response headers
      let responseHeaders: Record<string, string> | undefined;
      if (cfg.captureHeaders) {
        responseHeaders = {};
        try {
          response.headers.forEach((v, k) => { responseHeaders![k] = v; });
        } catch { /* CORS may block */ }
      }

      // Capture response body via clone + timeout
      let responseBody: string | undefined;
      let responseSize: number | undefined;
      if (cfg.captureResponseBody) {
        try {
          const cloned = response.clone();
          const raw = await readBodyWithTimeout(cloned, cfg.bodyTimeout);
          if (raw != null) {
            responseBody = truncate(raw, cfg.maxBodySize);
            responseSize = raw.length;
          }
        } catch {
          // Body read failed — leave undefined
        }
      }

      // Enrich with PerformanceObserver data
      // Use setTimeout(0) to let the browser flush the PerformanceObserver buffer
      const perfData = perfTracker.consume(url);

      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders,
        responseHeaders,
        requestBody,
        responseBody,
        responseSize,
        transferSize: perfData?.transferSize,
        initiatorType: perfData?.initiatorType ?? "fetch",
        isError: response.status >= 400,
        initiator: "fetch",
      };

      emit({ type: "network", timestamp: now, sessionId, data: entry });

      // Also emit as error if 5xx
      if (response.status >= 500) {
        const errEntry: ErrorEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          message: `${method} ${url} returned ${response.status}`,
          type: "error",
          source: "network",
        };
        emit({ type: "error", timestamp: now, sessionId, data: errEntry });
      }

      return response;
    } catch (err) {
      const now = Date.now();
      const durationMs = performance.now() - start;

      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method,
        url,
        status: null,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders,
        requestBody,
        error: err instanceof Error ? err.message : String(err),
        isError: true,
        initiator: "fetch",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
      throw err;
    }
  };

  // ── XMLHttpRequest interception ──────────────────────

  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  const originalSetRequestHeader = XHR.setRequestHeader;

  type XHRWithMeta = XMLHttpRequest & {
    _arMethod: string;
    _arUrl: string;
    _arRequestHeaders: Record<string, string>;
    _arStartTime: number;
    _arRequestBody: string | undefined;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (XHR as any).open = function xhrOpen(
    this: XHRWithMeta,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this._arMethod = method;
    this._arUrl = String(url);
    this._arRequestHeaders = {};
    return (originalOpen as (...args: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (XHR as any).setRequestHeader = function xhrSetRequestHeader(
    this: XHRWithMeta,
    name: string,
    value: string
  ) {
    if (this._arRequestHeaders) {
      this._arRequestHeaders[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (XHR as any).send = function xhrSend(
    this: XHRWithMeta,
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    if (shouldIgnore(this._arUrl)) {
      return originalSend.call(this, body);
    }

    this._arStartTime = performance.now();

    // Capture request body
    if (cfg.captureRequestBody) {
      this._arRequestBody = serializeRequestBody(body as BodyInit | null | undefined, cfg.maxBodySize);
    }

    const xhr = this;

    // Handle successful completion
    const onLoadEnd = () => {
      const now = Date.now();
      const durationMs = performance.now() - xhr._arStartTime;

      // Capture response headers
      let responseHeaders: Record<string, string> | undefined;
      if (cfg.captureHeaders) {
        responseHeaders = parseXhrHeaders(xhr.getAllResponseHeaders());
      }

      // Capture response body
      let responseBody: string | undefined;
      let responseSize: number | undefined;
      if (cfg.captureResponseBody) {
        const raw = readXhrResponseBody(xhr);
        if (raw != null) {
          responseBody = truncate(raw, cfg.maxBodySize);
          responseSize = raw.length;
        }
      }

      // Enrich with PerformanceObserver
      const perfData = perfTracker.consume(xhr._arUrl);

      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: (xhr._arMethod ?? "GET").toUpperCase(),
        url: xhr._arUrl ?? "",
        status: xhr.status || null,
        statusText: xhr.statusText,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders: cfg.captureHeaders ? xhr._arRequestHeaders : undefined,
        responseHeaders,
        requestBody: xhr._arRequestBody,
        responseBody,
        responseSize,
        transferSize: perfData?.transferSize,
        initiatorType: perfData?.initiatorType ?? "xmlhttprequest",
        isError: xhr.status >= 400 || xhr.status === 0,
        initiator: "xhr",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
    };

    // Handle network errors, timeouts, aborts
    const onError = () => {
      const now = Date.now();
      const durationMs = performance.now() - xhr._arStartTime;
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: (xhr._arMethod ?? "GET").toUpperCase(),
        url: xhr._arUrl ?? "",
        status: null,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders: cfg.captureHeaders ? xhr._arRequestHeaders : undefined,
        requestBody: xhr._arRequestBody,
        error: "Network error",
        isError: true,
        initiator: "xhr",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
    };

    const onTimeout = () => {
      const now = Date.now();
      const durationMs = performance.now() - xhr._arStartTime;
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: (xhr._arMethod ?? "GET").toUpperCase(),
        url: xhr._arUrl ?? "",
        status: null,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders: cfg.captureHeaders ? xhr._arRequestHeaders : undefined,
        requestBody: xhr._arRequestBody,
        error: "Request timed out",
        isError: true,
        initiator: "xhr",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
    };

    const onAbort = () => {
      const now = Date.now();
      const durationMs = performance.now() - xhr._arStartTime;
      const entry: NetworkEntry = {
        timestamp: now,
        offsetMs: now - sessionStart,
        method: (xhr._arMethod ?? "GET").toUpperCase(),
        url: xhr._arUrl ?? "",
        status: null,
        durationMs: Math.round(durationMs * 100) / 100,
        requestHeaders: cfg.captureHeaders ? xhr._arRequestHeaders : undefined,
        requestBody: xhr._arRequestBody,
        error: "Request aborted",
        isError: true,
        initiator: "xhr",
      };
      emit({ type: "network", timestamp: now, sessionId, data: entry });
    };

    xhr.addEventListener("loadend", onLoadEnd);
    xhr.addEventListener("error", onError);
    xhr.addEventListener("timeout", onTimeout);
    xhr.addEventListener("abort", onAbort);

    return originalSend.call(this, body);
  };

  // ── WebSocket interception ───────────────────────────

  let cleanupWebSocket: (() => void) | null = null;

  if (cfg.captureWebSocket && typeof window.WebSocket !== "undefined") {
    const OriginalWebSocket = window.WebSocket;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PatchedWebSocket = function WebSocket(
      this: WebSocket,
      url: string | URL,
      protocols?: string | string[]
    ): WebSocket {
      const wsUrl = typeof url === "string" ? url : url.href;

      // Don't intercept our own sidecar WebSocket
      if (shouldIgnore(wsUrl)) {
        if (protocols !== undefined) {
          return new OriginalWebSocket(url, protocols);
        }
        return new OriginalWebSocket(url);
      }

      const ws = protocols !== undefined
        ? new OriginalWebSocket(url, protocols)
        : new OriginalWebSocket(url);

      const maxMsg = cfg.maxWebSocketMessageSize;

      // Emit open
      ws.addEventListener("open", () => {
        const now = Date.now();
        const entry: WebSocketEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          url: wsUrl,
          direction: "open",
        };
        emit({ type: "websocket", timestamp: now, sessionId, data: entry });
      });

      // Emit close
      ws.addEventListener("close", (event) => {
        const now = Date.now();
        const entry: WebSocketEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          url: wsUrl,
          direction: "close",
          code: event.code,
          reason: event.reason || undefined,
        };
        emit({ type: "websocket", timestamp: now, sessionId, data: entry });
      });

      // Emit errors
      ws.addEventListener("error", () => {
        const now = Date.now();
        const entry: WebSocketEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          url: wsUrl,
          direction: "error",
        };
        emit({ type: "websocket", timestamp: now, sessionId, data: entry });
      });

      // Capture received messages
      ws.addEventListener("message", (event) => {
        const now = Date.now();
        let data: string | undefined;
        if (typeof event.data === "string") {
          data = truncate(event.data, maxMsg);
        } else if (event.data instanceof Blob) {
          data = `[Blob: ${event.data.size} bytes]`;
        } else if (event.data instanceof ArrayBuffer) {
          data = `[ArrayBuffer: ${event.data.byteLength} bytes]`;
        }
        const entry: WebSocketEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          url: wsUrl,
          direction: "receive",
          data,
        };
        emit({ type: "websocket", timestamp: now, sessionId, data: entry });
      });

      // Patch send to capture outgoing messages
      const originalSendWs = ws.send.bind(ws);
      ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        const now = Date.now();
        let serialized: string | undefined;
        if (typeof data === "string") {
          serialized = truncate(data, maxMsg);
        } else if (data instanceof Blob) {
          serialized = `[Blob: ${data.size} bytes]`;
        } else if (data instanceof ArrayBuffer) {
          serialized = `[ArrayBuffer: ${data.byteLength} bytes]`;
        } else if (ArrayBuffer.isView(data)) {
          serialized = `[${data.constructor.name}: ${data.byteLength} bytes]`;
        }
        const entry: WebSocketEntry = {
          timestamp: now,
          offsetMs: now - sessionStart,
          url: wsUrl,
          direction: "send",
          data: serialized,
        };
        emit({ type: "websocket", timestamp: now, sessionId, data: entry });
        return originalSendWs(data);
      };

      return ws;
    } as unknown as typeof WebSocket;

    // Copy static properties and prototype chain
    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    Object.defineProperty(PatchedWebSocket, "CONNECTING", { value: OriginalWebSocket.CONNECTING });
    Object.defineProperty(PatchedWebSocket, "OPEN", { value: OriginalWebSocket.OPEN });
    Object.defineProperty(PatchedWebSocket, "CLOSING", { value: OriginalWebSocket.CLOSING });
    Object.defineProperty(PatchedWebSocket, "CLOSED", { value: OriginalWebSocket.CLOSED });

    window.WebSocket = PatchedWebSocket;

    cleanupWebSocket = () => {
      window.WebSocket = OriginalWebSocket;
    };
  }

  // ── Cleanup ──────────────────────────────────────────

  return () => {
    window.fetch = originalFetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XHR as any).open = originalOpen;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XHR as any).send = originalSend;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (XHR as any).setRequestHeader = originalSetRequestHeader;
    cleanupWebSocket?.();
    perfTracker.stop();
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

  // Network interception — now with enriched body/header capture
  if (resolvedConfig.captureNetwork) {
    state.networkCleanup = interceptNetwork(
      session.id,
      config.ignoreNetworkPatterns,
      config.networkConfig
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
