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
