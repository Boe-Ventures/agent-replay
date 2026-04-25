import type { eventWithTime } from "@rrweb/types";

// ── Session ──────────────────────────────────────────────

export interface SessionMetadata {
  id: string;
  startedAt: string; // ISO 8601
  endedAt?: string;
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  durationMs?: number;
}

// ── Events ───────────────────────────────────────────────

export type RRWebEvent = eventWithTime;

export interface ConsoleEntry {
  timestamp: number; // ms since epoch
  offsetMs: number; // ms since session start
  level: "log" | "warn" | "error" | "info" | "debug";
  args: unknown[];
  trace?: string;
}

export interface NetworkEntry {
  timestamp: number;
  offsetMs: number;
  method: string;
  url: string;
  status: number | null; // null if aborted/failed
  statusText?: string;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string; // serialized, truncated if large
  responseBody?: string; // serialized, truncated if large
  responseSize?: number; // bytes (content-length or measured)
  transferSize?: number; // from PerformanceObserver
  initiatorType?: string; // fetch, xmlhttprequest, script, etc.
  error?: string;
  isError: boolean;
  initiator: "fetch" | "xhr" | "websocket";
}

export interface WebSocketEntry {
  timestamp: number;
  offsetMs: number;
  url: string;
  direction: "send" | "receive" | "open" | "close" | "error";
  data?: string; // message payload, truncated if large
  code?: number; // close code
  reason?: string; // close reason
}

// ── Network Configuration ────────────────────────────────

export interface NetworkConfig {
  /** Capture request bodies. Default: true */
  captureRequestBody?: boolean;
  /** Capture response bodies. Default: true */
  captureResponseBody?: boolean;
  /** Capture request/response headers. Default: true */
  captureHeaders?: boolean;
  /** Capture WebSocket messages. Default: true */
  captureWebSocket?: boolean;
  /** Max body size in bytes before truncation. Default: 64KB */
  maxBodySize?: number;
  /** Max WebSocket message size in bytes. Default: 16KB */
  maxWebSocketMessageSize?: number;
  /** Timeout in ms for reading streaming response bodies. Default: 500 */
  bodyTimeout?: number;
  /** URL patterns to exclude from capture */
  ignoreUrls?: (string | RegExp)[];
}

export interface ErrorEntry {
  timestamp: number;
  offsetMs: number;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  type: "error" | "unhandledrejection";
}

export interface InteractionEntry {
  timestamp: number;
  offsetMs: number;
  type: "click" | "input" | "scroll" | "navigation";
  target?: string; // CSS selector or description
  value?: string;
}

export interface RouteChangeEntry {
  timestamp: number;
  offsetMs: number;
  from: string;
  to: string;
}

// ── Aggregate event wrapper ──────────────────────────────

export type AgentReplayEventType =
  | "rrweb"
  | "console"
  | "network"
  | "websocket"
  | "error"
  | "interaction"
  | "route-change";

export interface AgentReplayEvent {
  type: AgentReplayEventType;
  timestamp: number;
  sessionId: string;
  data:
    | RRWebEvent
    | ConsoleEntry
    | NetworkEntry
    | WebSocketEntry
    | ErrorEntry
    | InteractionEntry
    | RouteChangeEntry;
}

// ── Config ───────────────────────────────────────────────

export interface RecorderConfig {
  /** Enable/disable recording entirely. Default: true in dev */
  enabled?: boolean;
  /** Capture console logs. Default: true */
  captureConsole?: boolean;
  /** Capture network requests. Default: true */
  captureNetwork?: boolean;
  /** Capture DOM via rrweb. Default: true */
  captureDom?: boolean;
  /** CSS selectors to ignore from rrweb recording */
  ignoreSelectors?: string[];
  /** rrweb sampling config */
  sampling?: {
    mousemove?: boolean | number;
    mouseInteraction?: boolean;
    scroll?: number;
    media?: number;
    input?: "last" | "all";
  };
  /** Max events to buffer before flushing. Default: 50 */
  batchSize?: number;
  /** Flush interval in ms. Default: 2000 */
  flushIntervalMs?: number;
  /** Session ID override. Auto-generated if not provided */
  sessionId?: string;
  /** Sidecar URL. Default: http://localhost:3700 */
  sidecarUrl?: string;
  /** Network URL patterns to ignore */
  ignoreNetworkPatterns?: (string | RegExp)[];
  /** Fine-grained network capture config */
  networkConfig?: NetworkConfig;
}

// ── Transport ────────────────────────────────────────────

export interface Transport {
  send(events: AgentReplayEvent[]): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

// ── Writer ───────────────────────────────────────────────

export interface WriterConfig {
  /** Base directory. Default: .agent-replay */
  baseDir?: string;
  /** Max file size in bytes before rotation. Default: 50MB */
  maxFileSizeBytes?: number;
  /** Max session age in ms. Default: 1 hour */
  maxSessionAgeMs?: number;
}

// ── Server ───────────────────────────────────────────────

export interface SidecarConfig {
  port?: number;
  host?: string;
  writerConfig?: WriterConfig;
  corsOrigins?: string[];
}

// ── Summary ──────────────────────────────────────────────

export interface SessionSummary {
  session: SessionMetadata;
  errors: ErrorEntry[];
  network: NetworkEntry[];
  console: ConsoleEntry[];
  interactions: InteractionEntry[];
  routeChanges: RouteChangeEntry[];
}
