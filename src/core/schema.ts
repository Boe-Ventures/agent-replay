import { z } from "zod";
import { REPLAY_SCHEMA_VERSION, type AgentReplayEvent, type ReplayManifest, type TransportPayload } from "./types.js";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const eventTypeSchema = z.enum([
  "rrweb", "console", "network", "websocket", "error", "interaction",
  "route-change", "marker", "performance", "playwright-step",
]);

export const eventSchema = z.object({
  id: z.string().regex(UUID_PATTERN),
  type: eventTypeSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().finite().nonnegative(),
  offsetMs: z.number().finite().nonnegative(),
  sessionId: z.string().regex(UUID_PATTERN),
  pageId: z.string().regex(UUID_PATTERN),
  data: z.unknown(),
});

export const transportPayloadSchema = z.object({
  events: z.array(eventSchema),
  sessionMetadata: z.object({
    id: z.string().regex(UUID_PATTERN),
    startedAt: z.string(),
    url: z.string(),
    userAgent: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
  }).passthrough().optional(),
  pageMetadata: z.object({
    id: z.string().regex(UUID_PATTERN),
    url: z.string(),
    startedAt: z.string(),
  }).passthrough().optional(),
});

export function parseTransportPayload(input: unknown): TransportPayload {
  return transportPayloadSchema.parse(input) as TransportPayload;
}

export function parseEvent(input: unknown): AgentReplayEvent {
  return eventSchema.parse(input) as AgentReplayEvent;
}

export function createManifest(session: ReplayManifest["session"]): ReplayManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    product: "agent-replay",
    session: { ...session, schemaVersion: REPLAY_SCHEMA_VERSION },
    pages: [],
    counts: {},
    files: {},
    fidelityWarnings: [],
    createdAt: now,
    updatedAt: now,
  };
}
