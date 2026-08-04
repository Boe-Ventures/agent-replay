import * as crypto from "node:crypto";
import type { AgentReplayEvent, AgentReplayEventType, SessionMetadata } from "../../src/core/types.js";

export function metadata(id = crypto.randomUUID()): SessionMetadata {
  return {
    id, schemaVersion: 1, startedAt: new Date(1_700_000_000_000).toISOString(),
    status: "active", mode: "session", privacyPreset: "safe", url: "http://localhost:3000/",
    userAgent: "test", viewport: { width: 1280, height: 800 },
  };
}

export function event(
  sessionId: string,
  type: AgentReplayEventType,
  data: AgentReplayEvent["data"],
  sequence = 0,
): AgentReplayEvent {
  const timestamp = 1_700_000_000_000 + sequence * 10;
  return {
    id: crypto.randomUUID(), type, sequence, timestamp, offsetMs: sequence * 10,
    sessionId, pageId: crypto.randomUUID(), data,
  };
}
