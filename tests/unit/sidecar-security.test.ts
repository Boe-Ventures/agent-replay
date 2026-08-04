import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { createSidecar } from "../../src/server/sidecar.js";
import { event, metadata } from "./helpers.js";

const stops: Array<() => Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

async function start(options: { maxBatchBytes?: number; host?: string; token?: string } = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-"));
  directories.push(baseDir);
  const sidecar = createSidecar({ port: 0, host: options.host, token: options.token, maxBatchBytes: options.maxBatchBytes, writerConfig: { baseDir } });
  await sidecar.start();
  stops.push(sidecar.stop);
  const port = (sidecar.server.address() as AddressInfo).port;
  return { sidecar, url: "http://127.0.0.1:" + port };
}

describe("sidecar security boundaries", () => {
  test("binds loopback and exposes versioned health", async () => {
    const { sidecar, url } = await start();
    expect((sidecar.server.address() as AddressInfo).address).toBe("127.0.0.1");
    expect(await (await fetch(url + "/api/v1/health")).json()).toMatchObject({ status: "ok", schemaVersion: 1 });
  });

  test("rejects hostile origins and malformed IDs", async () => {
    const { url } = await start();
    expect((await fetch(url + "/api/v1/sessions", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    const session = metadata();
    const value = event(session.id, "marker", { timestamp: 1, offsetMs: 0, label: "x" });
    value.sessionId = "../../escape";
    expect((await fetch(url + "/api/v1/events", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ events: [value] }),
    })).status).toBe(400);
  });

  test("allows local cross-origin writes but keeps reads write-only", async () => {
    const { sidecar, url } = await start();
    const session = metadata();
    const value = event(session.id, "marker", { timestamp: 1, offsetMs: 0, label: "local" });
    expect((await fetch(url + "/api/v1/events", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ events: [value], sessionMetadata: session }),
    })).status).toBe(200);
    expect(sidecar.writer.readJsonl("markers.jsonl", session.id)).toHaveLength(1);
    expect((await fetch(url + "/api/v1/sessions", { headers: { Origin: "http://localhost:3000" } })).status).toBe(403);
  });

  test("allows same-origin browser reads even when Origin is present", async () => {
    const { url } = await start();
    const response = await fetch(url + "/api/v1/sessions", { headers: { Origin: url } });
    expect(response.status).toBe(200);
  });

  test("allows write-only Chrome extension ingestion", async () => {
    const { url } = await start();
    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const session = metadata();
    const value = event(session.id, "marker", { timestamp: 1, offsetMs: 0, label: "extension" });
    expect((await fetch(url + "/api/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ events: [value], sessionMetadata: session }),
    })).status).toBe(200);
    expect((await fetch(url + "/api/v1/sessions", { headers: { Origin: origin } })).status).toBe(403);
  });

  test("enforces payload limits", async () => {
    const { url } = await start({ maxBatchBytes: 200 });
    const response = await fetch(url + "/api/v1/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [], padding: "x".repeat(500) }),
    });
    expect(response.status).toBe(413);
  });

  test("requires a token for non-loopback operation", async () => {
    const sidecar = createSidecar({ port: 0, host: "0.0.0.0" });
    expect(sidecar.start()).rejects.toThrow("requires an explicit token");
  });
});
