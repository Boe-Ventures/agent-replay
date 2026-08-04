import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentReplayEvent, AgentReplayEventType, SessionMetadata } from "../core/types.js";
import { SessionWriter } from "./writer.js";
import { generateSummary } from "./summarizer.js";

const FILE_TYPES: Array<[string, AgentReplayEventType]> = [
  ["events.jsonl", "rrweb"], ["console.jsonl", "console"], ["network.jsonl", "network"],
  ["websocket.jsonl", "websocket"], ["errors.jsonl", "error"],
];

function readJsonl(filePath: string): unknown[] {
  try { return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}

export function listLegacySessions(baseDir = ".agent-replay"): Array<{ id: string; directory: string }> {
  const sessions = path.resolve(baseDir, "sessions");
  if (!fs.existsSync(sessions)) return [];
  return fs.readdirSync(sessions)
    .filter((id) => !fs.existsSync(path.join(sessions, id, "manifest.json")))
    .filter((id) => fs.statSync(path.join(sessions, id)).isDirectory())
    .map((id) => ({ id, directory: path.join(sessions, id) }));
}

export function migrateLegacySession(writer: SessionWriter, legacyId: string): string {
  const source = path.join(writer.baseDir, "sessions", legacyId);
  if (!fs.existsSync(source)) throw new Error("Legacy session not found");
  let oldMetadata: Partial<SessionMetadata> = {};
  try { oldMetadata = JSON.parse(fs.readFileSync(path.join(source, "session.json"), "utf8")) as Partial<SessionMetadata>; } catch { /* optional */ }
  const sessionId = crypto.randomUUID();
  const startedAt = oldMetadata.startedAt ?? new Date(fs.statSync(source).birthtimeMs).toISOString();
  const metadata: SessionMetadata = {
    id: sessionId, schemaVersion: 1, startedAt, endedAt: oldMetadata.endedAt,
    status: oldMetadata.endedAt ? "closed" : "interrupted", mode: "session", privacyPreset: "safe",
    url: oldMetadata.url ?? "", userAgent: oldMetadata.userAgent ?? "",
    viewport: oldMetadata.viewport ?? { width: 0, height: 0 },
    durationMs: oldMetadata.durationMs, metadata: { migratedFrom: legacyId },
  };
  const pageId = crypto.randomUUID();
  writer.initSession(sessionId, metadata, { id: pageId, url: metadata.url, startedAt, title: "Migrated v0.2 page" });
  const start = new Date(startedAt).getTime();
  const events: AgentReplayEvent[] = [];
  let sequence = 0;
  for (const [filename, type] of FILE_TYPES) {
    for (const value of readJsonl(path.join(source, filename))) {
      const record = value as Record<string, unknown>;
      const data = record.type && record.data && type === "rrweb" ? record.data : value;
      const timestamp = Number((data as Record<string, unknown>)?.timestamp ?? record.timestamp ?? start + sequence);
      events.push({
        id: crypto.randomUUID(), type, sequence: sequence++, timestamp,
        offsetMs: Math.max(0, timestamp - start), sessionId, pageId,
        data: data as AgentReplayEvent["data"],
      });
    }
  }
  writer.writeEvents(events);
  generateSummary(writer, sessionId);
  return sessionId;
}
