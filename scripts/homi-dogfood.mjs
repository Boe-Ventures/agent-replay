import { chromium } from "playwright";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "extension", ".output", "chrome-mv3");
const baseDir = path.resolve(process.env.AGENT_REPLAY_DIR ?? path.join(root, ".agent-replay-homi-dogfood"));
const homiUrl = process.env.HOMI_URL ?? "http://127.0.0.1:3977";
const routes = (process.env.HOMI_ROUTES ?? "/,/product,/directory,/blog").split(",");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-homi-"));

async function waitFor(read, timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for Agent Replay evidence");
}

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const visited = [];
  for (const route of routes) {
    const response = await page.goto(homiUrl + route, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(1_500);
    visited.push({ route, status: response?.status() ?? null, title: await page.title() });
  }

  const sessionId = await waitFor(() => {
    const sessions = path.join(baseDir, "sessions");
    if (!fs.existsSync(sessions)) return undefined;
    return fs.readdirSync(sessions).find((entry) => fs.existsSync(path.join(sessions, entry, "manifest.json")));
  });
  await page.waitForTimeout(2_000);
  await page.close();
  await context.close();
  context = undefined;

  const sessionDir = path.join(baseDir, "sessions", sessionId);
  const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
  const files = fs.readdirSync(sessionDir).map((file) => ({ file, bytes: fs.statSync(path.join(sessionDir, file)).size }));
  process.stdout.write(JSON.stringify({ sessionId, visited, pages: manifest.pages.length, files }, null, 2) + "\n");
} finally {
  await context?.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
