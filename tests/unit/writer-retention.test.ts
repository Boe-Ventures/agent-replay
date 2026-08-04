import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentReplayEvent } from "../../src/core/types.js";
import { SessionWriter } from "../../src/server/writer.js";
import { isIncidentTrigger, selectIncidentWindow, selectRollingWindow } from "../../src/core/retention.js";
import { event, metadata } from "./helpers.js";

const directories: string[] = [];
const createWriter = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-"));
  directories.push(directory);
  return new SessionWriter({ baseDir: directory });
};
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe("session-addressed writer", () => {
  test("never cross-contaminates interleaved sessions", () => {
    const writer = createWriter();
    const a = metadata(); const b = metadata();
    writer.initSession(a.id, a); writer.initSession(b.id, b);
    writer.writeEvents([
      event(a.id, "marker", { timestamp: 1, offsetMs: 0, label: "A" }, 0),
      event(b.id, "marker", { timestamp: 2, offsetMs: 0, label: "B" }, 0),
      event(a.id, "marker", { timestamp: 3, offsetMs: 0, label: "A2" }, 1),
    ]);
    expect(writer.readJsonl("markers.jsonl", a.id)).toHaveLength(2);
    expect(writer.readJsonl("markers.jsonl", b.id)).toHaveLength(1);
    expect(fs.readFileSync(path.join(writer.getSessionDir(a.id), "markers.jsonl"), "utf8")).not.toContain('"label":"B"');
  });

  test("writes a v1 manifest and compatibility rrweb stream", () => {
    const writer = createWriter();
    const session = metadata();
    writer.initSession(session.id, session);
    writer.writeEvents([event(session.id, "rrweb", { type: 2, timestamp: 1_700_000_000_000 } as never)]);
    expect(writer.readManifest(session.id)?.schemaVersion).toBe(1);
    expect(writer.readJsonl("events.jsonl", session.id)).toHaveLength(1);
    expect(writer.readJsonl("timeline.jsonl", session.id)).toHaveLength(1);
  });

  test("assigns a stable session sequence when a page-local sequence restarts", () => {
    const writer = createWriter();
    const session = metadata();
    writer.initSession(session.id, session);
    writer.writeEvents([
      event(session.id, "marker", { timestamp: 1, offsetMs: 0, label: "first" }, 0),
      event(session.id, "marker", { timestamp: 2, offsetMs: 1, label: "second" }, 1),
    ]);
    writer.writeEvents([
      event(session.id, "route-change", { timestamp: 3, offsetMs: 2, from: "/a", to: "/b", navigationType: "load" }, 0),
    ]);
    expect(writer.readJsonl<AgentReplayEvent>("timeline.jsonl", session.id).map((item) => item.sequence)).toEqual([0, 1, 2]);
  });
});

describe("retention and triggers", () => {
  test("ordinary 4xx does not trigger but 5xx and network failure do", () => {
    const id = metadata().id;
    const network = (status: number | null) => event(id, "network", { timestamp: 1, offsetMs: 0, method: "GET", url: "/api", status, durationMs: 1, isError: status == null || status >= 400, initiator: "fetch" });
    expect(isIncidentTrigger(network(404))).toBe(false);
    expect(isIncidentTrigger(network(500))).toBe(true);
    expect(isIncidentTrigger(network(null))).toBe(true);
  });

  test("selects five-minute rolling and two-minute-before/fifteen-second-after windows", () => {
    const id = metadata().id;
    const events = [0, 100_000, 200_000, 300_000, 310_000, 320_000].map((timestamp, index) => {
      const value = event(id, "marker", { timestamp, offsetMs: timestamp, label: String(index) }, index);
      value.timestamp = timestamp; return value;
    });
    expect(selectRollingWindow(events, 320_000).map((value) => value.timestamp)).toEqual([100_000, 200_000, 300_000, 310_000, 320_000]);
    expect(selectIncidentWindow(events, 300_000).map((value) => value.timestamp)).toEqual([200_000, 300_000, 310_000]);
  });
});
