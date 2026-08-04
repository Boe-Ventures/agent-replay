import { expect, test, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { createSidecar } from "../src/server/sidecar.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSION = path.join(ROOT, "extension", ".output", "chrome-mv3");
const BASE_DIR = path.join(ROOT, ".agent-replay-extension-e2e");
const FIXTURE_PORT = 3899;

let context: BrowserContext;
let stopSidecar: () => Promise<void>;
let fixture: http.Server;
let profile: string;
let extensionWorker: Worker;

async function waitFor<T>(read: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for extension evidence");
}

function firstSession(): string | undefined {
  const sessions = path.join(BASE_DIR, "sessions");
  if (!fs.existsSync(sessions)) return undefined;
  return fs.readdirSync(sessions)[0];
}

async function waitForExtensionSession(page: import("@playwright/test").Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await waitFor(firstSession, 10_000).catch(() => undefined);
    if (session) return session;
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  throw new Error("Extension content scripts did not register after three page loads");
}

function html(provider = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Extension fixture</title>${provider ? "<script>window.__AGENT_REPLAY_ACTIVE__=true</script>" : ""}</head><body>
    <h1>${provider ? "Provider owns capture" : "Extension capture fixture"}</h1>
    <button id="run">Run incident</button><a href="/next">Next route</a>
    <script>document.querySelector('#run').onclick=async()=>{console.error('extension fixture failure');const until=performance.now()+90;while(performance.now()<until){}const response=await fetch('/api/failure');history.pushState({},'', '/client-route');document.body.dataset.status=String(response.status)}</script>
  </body></html>`;
}

test.describe("Chrome MV3 extension", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chrome extension acceptance runs in Chromium only");

  test.beforeAll(async () => {
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
    const sidecar = createSidecar({ port: 3700, host: "127.0.0.1", writerConfig: { baseDir: BASE_DIR } });
    await sidecar.start();
    stopSidecar = sidecar.stop;
    fixture = http.createServer((request, response) => {
      if (request.url === "/api/failure") {
        response.writeHead(500, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: "Extension fixture failed", debugToken: "extension-secret-never-on-disk" }));
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html(request.url === "/provider"));
    });
    await new Promise<void>((resolve, reject) => {
      fixture.once("error", reject);
      fixture.listen(FIXTURE_PORT, "127.0.0.1", () => resolve());
    });
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-extension-"));
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    extensionWorker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  });

  test.afterAll(async () => {
    await context?.close();
    if (fixture) await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await stopSidecar?.();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  });

  test("captures main-world evidence and keeps identity through navigation", async () => {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${FIXTURE_PORT}/`);
    const started = await waitForExtensionSession(page);
    await page.locator("#run").click();
    await expect.poll(() => page.locator("body").getAttribute("data-status")).toBe("500");

    const first = await waitFor(() => {
      for (const entry of fs.existsSync(path.join(BASE_DIR, "sessions")) ? fs.readdirSync(path.join(BASE_DIR, "sessions")) : []) {
        const network = path.join(BASE_DIR, "sessions", entry, "network.jsonl");
        if (fs.existsSync(network) && fs.readFileSync(network, "utf8").includes('"status":500')) return entry;
      }
      return undefined;
    });
    expect(first).toBe(started);
    const firstManifest = JSON.parse(fs.readFileSync(path.join(BASE_DIR, "sessions", first, "manifest.json"), "utf8")) as { pages: Array<{ id: string }> };
    expect(firstManifest.pages).toHaveLength(1);
    const errors = fs.readFileSync(path.join(BASE_DIR, "sessions", first, "errors.jsonl"), "utf8");
    expect(errors).toContain("returned 500");
    expect(errors).not.toContain("DataCloneError");
    expect(fs.readFileSync(path.join(BASE_DIR, "sessions", first, "console.jsonl"), "utf8")).toContain("extension fixture failure");
    expect(fs.readFileSync(path.join(BASE_DIR, "sessions", first, "network.jsonl"), "utf8")).not.toContain("extension-secret-never-on-disk");

    await page.goto(`http://127.0.0.1:${FIXTURE_PORT}/next`);
    await page.waitForTimeout(3_800);
    const manifest = JSON.parse(fs.readFileSync(path.join(BASE_DIR, "sessions", first, "manifest.json"), "utf8")) as { pages: Array<{ id: string }> };
    expect(new Set(manifest.pages.map((entry) => entry.id)).size).toBeGreaterThanOrEqual(2);
    const timeline = fs.readFileSync(path.join(BASE_DIR, "sessions", first, "timeline.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { sequence: number });
    expect(timeline.map((entry) => entry.sequence)).toEqual(timeline.map((_, index) => index));
    expect(fs.readdirSync(path.join(BASE_DIR, "sessions"))).toEqual([first]);
    await page.close();
  });

  test("defers to an in-page provider", async () => {
    const before = fs.existsSync(path.join(BASE_DIR, "sessions")) ? fs.readdirSync(path.join(BASE_DIR, "sessions")) : [];
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${FIXTURE_PORT}/provider`);
    await page.waitForTimeout(2_500);
    await page.locator("#run").click();
    await page.waitForTimeout(2_500);
    const after = fs.existsSync(path.join(BASE_DIR, "sessions")) ? fs.readdirSync(path.join(BASE_DIR, "sessions")) : [];
    expect(after).toEqual(before);
    await page.close();
  });

  test("records true tab pixels through the offscreen document across navigation", async () => {
    test.skip(true, "Chrome requires a real extension-action invocation; covered by scripts/extension-demo-harness.mjs and the release QA checklist.");
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${FIXTURE_PORT}/`);
    await page.waitForTimeout(1_800);
    await page.bringToFront();
    const tabId = await extensionWorker.evaluate(async (fixturePort) => {
      const api = (globalThis as unknown as { chrome: { tabs: { query: (query: object) => Promise<Array<{ id?: number; url?: string }>> } } }).chrome;
      const tabs = await api.tabs.query({});
      return tabs.find((tab) => tab.url?.startsWith(`http://127.0.0.1:${fixturePort}/`))?.id;
    }, FIXTURE_PORT);
    expect(tabId).toBeDefined();
    const extensionId = new URL(extensionWorker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.bringToFront();
    const started = await extensionPage.evaluate(async (id) => {
      const api = (globalThis as unknown as { chrome: { runtime: { sendMessage: (message: object) => Promise<{ error?: string }> } } }).chrome;
      return api.runtime.sendMessage({ type: "START_DEMO", tabId: id });
    }, tabId!);
    expect(started?.error).toBeUndefined();
    await page.waitForTimeout(1_500);
    await page.goto(`http://127.0.0.1:${FIXTURE_PORT}/next`);
    await page.waitForTimeout(1_500);
    const stopped = await extensionPage.evaluate(async (id) => {
      const api = (globalThis as unknown as { chrome: { runtime: { sendMessage: (message: object) => Promise<{ error?: string }> } } }).chrome;
      return api.runtime.sendMessage({ type: "STOP_DEMO", tabId: id });
    }, tabId!);
    expect(stopped?.error).toBeUndefined();

    const media = await waitFor(() => {
      const sessions = path.join(BASE_DIR, "sessions");
      if (!fs.existsSync(sessions)) return undefined;
      for (const session of fs.readdirSync(sessions)) {
        const directory = path.join(sessions, session, "media");
        if (!fs.existsSync(directory)) continue;
        const file = fs.readdirSync(directory).find((entry) => entry.endsWith(".webm"));
        if (file) return path.join(directory, file);
      }
      return undefined;
    });
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-show_entries", "format=duration", "-of", "json", media], { encoding: "utf8" });
    expect(probe.status).toBe(0);
    const details = JSON.parse(probe.stdout) as { streams: Array<{ codec_name: string; width: number; height: number }>; format: { duration: string } };
    expect(["vp8", "vp9"]).toContain(details.streams[0]?.codec_name);
    expect(details.streams[0]?.width).toBeGreaterThanOrEqual(800);
    expect(details.streams[0]?.height).toBeGreaterThanOrEqual(600);
    expect(Number(details.format.duration)).toBeGreaterThan(2);
    await extensionPage.close();
    await page.close();
  });
});
