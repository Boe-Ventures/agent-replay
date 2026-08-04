// Core types
export type {
  SessionMetadata,
  RRWebEvent,
  ConsoleEntry,
  NetworkEntry,
  ErrorEntry,
  InteractionEntry,
  RouteChangeEntry,
  AgentReplayEvent,
  AgentReplayEventType,
  RecorderConfig,
  FilterConfig,
  CleanupConfig,
  Transport,
  WriterConfig,
  SidecarConfig,
  SessionSummary,
  ReplayManifest,
  ComparisonResult,
  PrivacyPreset,
  RecordingMode,
  RetentionPolicy,
  TriggerPolicy,
  RedactionConfig,
} from "./core/types.js";

// Core utilities
export {
  startRecording,
  stopRecording,
  onEvent,
  getBufferedEvents,
} from "./core/recorder.js";

export {
  PostTransport,
  WebSocketTransport,
  DirectTransport,
  ConsoleTransport,
} from "./core/transport.js";

export {
  getOrCreateSession,
  endSession,
  getCurrentSession,
  rotateSession,
} from "./core/session.js";

export { mark, triggerIncident } from "./core/recorder.js";
export {
  isUuid,
  parseEvent,
  parseTransportPayload,
} from "./core/schema.js";
export {
  DEFAULT_RETENTION,
  DEFAULT_TRIGGERS,
  resolveRetention,
  isIncidentTrigger,
  selectRollingWindow,
  selectIncidentWindow,
} from "./core/retention.js";
