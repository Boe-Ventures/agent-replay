import type { eventWithTime } from "@rrweb/types";

export const REPLAY_SCHEMA_VERSION = 1 as const;

export type RecordingMode = "rolling" | "session" | "demo";
export type PrivacyPreset = "safe" | "diagnostic" | "demo";
export type SessionStatus = "active" | "closed" | "interrupted";

export interface RetentionPolicy {
  rollingWindowMs?: number;
  checkpointIntervalMs?: number;
  preTriggerMs?: number;
  postTriggerMs?: number;
  maxPinnedSessions?: number;
  pinnedMaxAgeMs?: number;
  preserve?: boolean;
}

export interface TriggerPolicy {
  uncaughtErrors?: boolean;
  rejectedPromises?: boolean;
  serverErrors?: boolean;
  networkFailures?: boolean;
  manualMarkers?: boolean;
  clientErrors?: boolean;
}

export interface RedactionConfig {
  fieldNames?: string[];
  headerNames?: string[];
  queryParameters?: string[];
  jsonKeys?: string[];
  replacement?: string;
}

export interface SessionMetadata {
  id: string;
  schemaVersion?: number;
  startedAt: string;
  endedAt?: string;
  status?: SessionStatus;
  mode?: RecordingMode;
  privacyPreset?: PrivacyPreset;
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  durationMs?: number;
  title?: string;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  pinReason?: string;
}

export interface PageMetadata {
  id: string;
  url: string;
  title?: string;
  startedAt: string;
  endedAt?: string;
}

export type RRWebEvent = eventWithTime;

export interface ConsoleEntry {
  timestamp: number;
  offsetMs: number;
  level: "log" | "warn" | "error" | "info" | "debug";
  args: unknown[];
  trace?: string;
}

export interface NetworkEntry {
  timestamp: number;
  offsetMs: number;
  requestId?: string;
  method: string;
  url: string;
  status: number | null;
  statusText?: string;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  responseSize?: number;
  transferSize?: number;
  initiatorType?: string;
  initiatorEventId?: string;
  contentType?: string;
  error?: string;
  isError: boolean;
  initiator: "fetch" | "xhr" | "websocket";
}

export interface WebSocketEntry {
  timestamp: number;
  offsetMs: number;
  requestId?: string;
  url: string;
  direction: "send" | "receive" | "open" | "close" | "error";
  data?: string;
  code?: number;
  reason?: string;
}

export interface ErrorEntry {
  timestamp: number;
  offsetMs: number;
  fingerprint?: string;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  type: "error" | "unhandledrejection" | "console-error" | "network";
}

export interface InteractionEntry {
  timestamp: number;
  offsetMs: number;
  type: "click" | "input" | "change" | "submit" | "scroll" | "navigation";
  target?: string;
  text?: string;
  value?: string;
  x?: number;
  y?: number;
}

export interface RouteChangeEntry {
  timestamp: number;
  offsetMs: number;
  from: string;
  to: string;
  navigationType?: "push" | "replace" | "pop" | "load";
}

export interface MarkerEntry {
  timestamp: number;
  offsetMs: number;
  label: string;
  metadata?: Record<string, unknown>;
  triggerIncident?: boolean;
}

export interface PerformanceEntry {
  timestamp: number;
  offsetMs: number;
  name: string;
  entryType: string;
  duration: number;
  startTime: number;
  detail?: Record<string, unknown>;
}

export interface PlaywrightStepEntry {
  timestamp: number;
  offsetMs: number;
  title: string;
  category?: string;
  status?: "running" | "passed" | "failed";
  metadata?: Record<string, unknown>;
}

export type AgentReplayEventType =
  | "rrweb"
  | "console"
  | "network"
  | "websocket"
  | "error"
  | "interaction"
  | "route-change"
  | "marker"
  | "performance"
  | "playwright-step";

export type AgentReplayEventData =
  | RRWebEvent
  | ConsoleEntry
  | NetworkEntry
  | WebSocketEntry
  | ErrorEntry
  | InteractionEntry
  | RouteChangeEntry
  | MarkerEntry
  | PerformanceEntry
  | PlaywrightStepEntry;

export interface AgentReplayEvent {
  id: string;
  type: AgentReplayEventType;
  sequence: number;
  timestamp: number;
  offsetMs: number;
  sessionId: string;
  pageId: string;
  data: AgentReplayEventData;
}

export interface NetworkConfig {
  captureRequestBody?: boolean;
  captureResponseBody?: boolean;
  captureHeaders?: boolean;
  captureWebSocket?: boolean;
  maxBodySize?: number;
  maxWebSocketMessageSize?: number;
  bodyTimeout?: number;
  ignoreUrls?: (string | RegExp)[];
}

export interface FilterConfig {
  filterConsole?: (entry: ConsoleEntry) => boolean;
  filterNetwork?: (entry: NetworkEntry) => boolean;
  filterError?: (entry: ErrorEntry) => boolean;
  maxBodySize?: number;
}

export interface CleanupConfig {
  maxSessions?: number;
  maxAgeHours?: number;
  preserveLogs?: boolean;
  maxPinnedSessions?: number;
  pinnedMaxAgeMs?: number;
}

export interface RecorderConfig {
  enabled?: boolean;
  recordingMode?: RecordingMode;
  privacyPreset?: PrivacyPreset;
  retention?: RetentionPolicy;
  triggers?: TriggerPolicy;
  metadata?: Record<string, unknown>;
  redaction?: RedactionConfig;
  captureConsole?: boolean;
  captureNetwork?: boolean;
  captureDom?: boolean;
  captureInteractions?: boolean;
  captureRoutes?: boolean;
  capturePerformance?: boolean;
  maskAllInputs?: boolean;
  ignoreSelectors?: string[];
  sampling?: {
    mousemove?: boolean | number;
    mouseInteraction?: boolean;
    scroll?: number;
    media?: number;
    input?: "last" | "all";
  };
  batchSize?: number;
  flushIntervalMs?: number;
  sessionId?: string;
  sidecarUrl?: string;
  token?: string;
  ignoreNetworkPatterns?: (string | RegExp)[];
  networkConfig?: NetworkConfig;
  filters?: FilterConfig;
}

export interface TransportPayload {
  events: AgentReplayEvent[];
  sessionMetadata?: SessionMetadata;
  pageMetadata?: PageMetadata;
}

export interface Transport {
  send(events: AgentReplayEvent[], context?: Omit<TransportPayload, "events">): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface WriterConfig {
  baseDir?: string;
  maxFileSizeBytes?: number;
  maxSessionSizeBytes?: number;
  maxDiskBytes?: number;
  maxSessionAgeMs?: number;
}

export interface SidecarConfig {
  port?: number;
  host?: string;
  token?: string;
  writerConfig?: WriterConfig;
  corsOrigins?: string[];
  cleanupConfig?: CleanupConfig;
  maxBatchBytes?: number;
  maxEventsPerBatch?: number;
  maxMediaChunkBytes?: number;
}

export interface ReplayManifest {
  schemaVersion: 1;
  product: "agent-replay";
  session: SessionMetadata;
  pages: PageMetadata[];
  counts: Partial<Record<AgentReplayEventType, number>>;
  files: Record<string, { bytes: number; sha256?: string }>;
  fidelityWarnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CorrelatedIncident {
  id: string;
  trigger: AgentReplayEvent;
  events: AgentReplayEvent[];
  summary: string;
}

export interface SessionSummary {
  session: SessionMetadata;
  errors: ErrorEntry[];
  network: NetworkEntry[];
  console: ConsoleEntry[];
  interactions: InteractionEntry[];
  routeChanges: RouteChangeEntry[];
  markers: MarkerEntry[];
  incidents: CorrelatedIncident[];
}

export interface ComparisonResult {
  beforeSessionId: string;
  afterSessionId: string;
  alignment: "markers" | "playwright-steps" | "routes-actions" | "timestamps";
  resolvedErrors: string[];
  newErrors: string[];
  changedNetwork: Array<{
    key: string;
    beforeStatus: number | null;
    afterStatus: number | null;
  }>;
  completedRoutes: string[];
  missingRoutes: string[];
  timingChanges: Array<{ key: string; beforeMs: number; afterMs: number; deltaMs: number }>;
  finalStateChanged: boolean;
}

export interface ExportOptions {
  format: "webm" | "mp4" | "gif" | "poster" | "storyboard";
  preset?: "debug" | "launch" | "square" | "vertical";
  fromMs?: number;
  toMs?: number;
  title?: string;
  outro?: string;
  captions?: boolean;
  emphasizeClicks?: boolean;
  removeIdle?: boolean;
  audio?: boolean;
  output?: string;
}
