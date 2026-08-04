import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "playwright";
import { createSidecar } from "../dist/server/sidecar.js";

const root = path.resolve(import.meta.dirname, "..");
const extension = path.join(root, "extension", ".output", "chrome-mv3");
const baseDir = path.join(root, ".agent-replay-tab-capture-qa");
fs.rmSync(baseDir, { recursive: true, force: true });

const sidecar = createSidecar({ port: 3700, host: "127.0.0.1", writerConfig: { baseDir } });
await sidecar.start();
let control = async () => ({ error: "Harness is not ready" });
const fixture = http.createServer(async (request, response) => {
  if (["/__control/open", "/__control/start", "/__control/stop", "/__control/status"].includes(request.url ?? "")) {
    const messageType = request.url?.endsWith("open") ? "OPEN_POPUP"
      : request.url?.endsWith("start") ? "START_DEMO"
        : request.url?.endsWith("status") ? "GET_DEMO_STATUS" : "STOP_DEMO";
    const result = await control(messageType);
    response.writeHead(result?.error ? 500 : 200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(result));
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Agent Replay tab capture QA</title><style>body{margin:0;background:#0b1020;color:#f7fafc;font:20px system-ui}.top{padding:24px 40px;border-bottom:1px solid #334155}.hero{padding:90px 9vw}.badge{color:#67e8f9;font:13px monospace;letter-spacing:.15em}.hero h1{font-size:72px;line-height:1;margin:24px 0}.card{margin-top:50px;background:#151e2e;border:1px solid #334155;padding:30px;border-radius:16px;max-width:720px}a{display:inline-block;background:white;color:#0b1020;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700}</style></head><body><div class="top">● Agent Replay · true tab capture QA</div><main class="hero"><div class="badge">LOCAL / NAVIGATION-SAFE / WEBM</div><h1>${request.url === "/next" ? "The recording survived navigation." : "Capture pixels, not promises."}</h1><p>This deterministic local page exists only to verify the Chrome extension's user-initiated recording path.</p><div class="card"><p>Step 1: start <b>Record polished demo</b> from the extension.</p><p>Step 2: navigate while recording.</p><a href="${request.url === "/next" ? "/" : "/next"}">${request.url === "/next" ? "Return to first page" : "Navigate to second page"}</a></div></main></body></html>`);
});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(3899, "127.0.0.1", resolve);
});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agent-replay-tab-capture-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: false,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
const page = context.pages()[0] ?? await context.newPage();
await page.goto("http://127.0.0.1:3899/");
await page.bringToFront();
control = async (type) => {
  if (type === "OPEN_POPUP") {
    await page.bringToFront();
    return worker.evaluate(async () => { await chrome.action.openPopup(); return { ok: true }; });
  }
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url?.startsWith("http://127.0.0.1:3899/"))?.id;
  });
  if (tabId == null) return { error: "Fixture tab not found" };
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const result = await extensionPage.evaluate(async ({ resolvedTabId, messageType }) => chrome.runtime.sendMessage({ type: messageType, tabId: resolvedTabId }), { resolvedTabId: tabId, messageType: type });
  await extensionPage.close();
  await page.bringToFront();
  return result;
};
process.stdout.write(`READY chrome-extension://${new URL(worker.url()).host}/popup.html\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await context.close();
  await new Promise((resolve) => fixture.close(resolve));
  await sidecar.stop();
  fs.rmSync(profile, { recursive: true, force: true });
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
