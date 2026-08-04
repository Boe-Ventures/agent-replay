import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionWriter } from "../../src/server/writer.js";
import { generateSummary, inspectSession } from "../../src/server/summarizer.js";
import { compareSessions } from "../../src/server/compare.js";
import { listLegacySessions, migrateLegacySession } from "../../src/server/legacy.js";
import { event, metadata } from "./helpers.js";

const directories: string[] = [];
const setup = () => { const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-")); directories.push(baseDir); return new SessionWriter({ baseDir }); };
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

test("summaries contain routes, interactions, failures, incidents, and budgeted evidence", () => {
  const writer = setup(); const session = metadata(); writer.initSession(session.id, session);
  writer.writeEvents([
    event(session.id, "interaction", { timestamp: 1, offsetMs: 10, type: "click", target: "button#save", text: "Save" }, 1),
    event(session.id, "network", { timestamp: 2, offsetMs: 20, method: "POST", url: "/api/save", status: 500, durationMs: 30, responseBody: '{"error":"no"}', isError: true, initiator: "fetch" }, 2),
    event(session.id, "error", { timestamp: 3, offsetMs: 30, message: "Save failed", type: "network" }, 3),
    event(session.id, "route-change", { timestamp: 4, offsetMs: 40, from: "/", to: "/done" }, 4),
  ]);
  const summary = generateSummary(writer, session.id)!;
  expect(summary).toContain("Save failed");
  expect(summary).toContain("button#save");
  expect(summary).toContain("/done");
  expect(summary).toContain("Correlated incidents");
  expect(inspectSession(writer, session.id, 300).length).toBeLessThanOrEqual(1_300);
});

test("comparison reports resolved and new outcomes", () => {
  const writer = setup(); const before = metadata(); const after = metadata();
  writer.initSession(before.id, before); writer.initSession(after.id, after);
  writer.writeEvents([
    event(before.id, "error", { timestamp: 1, offsetMs: 1, message: "Broken", type: "error" }),
    event(before.id, "network", { timestamp: 2, offsetMs: 2, method: "GET", url: "/api", status: 500, durationMs: 50, isError: true, initiator: "fetch" }, 1),
    event(after.id, "network", { timestamp: 2, offsetMs: 2, method: "GET", url: "/api", status: 200, durationMs: 20, isError: false, initiator: "fetch" }, 1),
  ]);
  const result = compareSessions(writer, before.id, after.id);
  expect(result.resolvedErrors).toEqual(["Broken"]);
  expect(result.changedNetwork[0]).toMatchObject({ beforeStatus: 500, afterStatus: 200 });
});

test("legacy sessions load non-destructively and migrate explicitly", () => {
  const writer = setup(); const legacy = "2026-04-25T14-30-00Z";
  const directory = path.join(writer.baseDir, "sessions", legacy);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "session.json"), JSON.stringify({ id: legacy, startedAt: "2026-04-25T14:30:00Z", url: "http://localhost:3000", userAgent: "old", viewport: { width: 1, height: 1 } }));
  fs.writeFileSync(path.join(directory, "errors.jsonl"), JSON.stringify({ timestamp: Date.parse("2026-04-25T14:30:01Z"), offsetMs: 1000, message: "old error", type: "error" }) + "\n");
  expect(listLegacySessions(writer.baseDir).map((value) => value.id)).toEqual([legacy]);
  const migrated = migrateLegacySession(writer, legacy);
  expect(writer.readManifest(migrated)?.session.metadata).toEqual({ migratedFrom: legacy });
  expect(fs.existsSync(directory)).toBe(true);
});
