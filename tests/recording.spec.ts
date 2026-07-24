import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import * as path from "node:path";
import {
  startSidecar,
  startPlayground,
  readSessionFile,
  sessionFileExists,
  getLatestTarget,
  cleanAgentReplay,
  buildPackage,
} from "./helpers.js";

const ROOT = path.resolve(import.meta.dirname, "..");

let stopSidecar: () => void;
let stopPlayground: () => void;

test.beforeAll(async () => {
  buildPackage();
  cleanAgentReplay();
  stopSidecar = await startSidecar();
  stopPlayground = await startPlayground();
});

test.afterAll(async () => {
  stopPlayground?.();
  stopSidecar?.();
});

test("captures console logs", async ({ page }) => {
  await page.goto("/");
  // The page auto-fetches /api/tasks on mount which triggers console.error
  // due to the "taks" typo bug. Wait for events to flush to sidecar.
  await page.waitForTimeout(3000);

  const console_entries = readSessionFile<{ level?: string; args?: unknown[] }>(
    "console.jsonl",
  );
  expect(console_entries.length).toBeGreaterThan(0);

  // The recorded entry has to carry the console call's own arguments — an
  // agent reads `args`, not the level. Asserting only on `level` passes even
  // when every payload is dropped, which is the failure this guards.
  const withArgs = console_entries.filter(
    (e) => Array.isArray(e.args) && e.args.length > 0,
  );
  expect(withArgs.length).toBeGreaterThan(0);
  expect(
    withArgs.some((e) =>
      JSON.stringify(e.args).toLowerCase().includes("failed to fetch tasks"),
    ),
  ).toBe(true);
});

test("captures errors", async ({ page }) => {
  await page.goto("/");
  // The page auto-triggers an error: "data.tasks is not iterable"
  await page.waitForTimeout(3000);

  // Errors may be in errors.jsonl or console.jsonl as error-level entries
  const errors = readSessionFile<{ message?: string; stack?: string }>(
    "errors.jsonl",
  );
  const consoleEntries = readSessionFile<{ level?: string; args?: unknown[] }>(
    "console.jsonl",
  );

  const errorPayloads = [
    ...errors.map((e) => JSON.stringify([e.message, e.stack])),
    ...consoleEntries
      .filter((e) => e.level === "error")
      .map((e) => JSON.stringify(e.args)),
  ];

  expect(errorPayloads.length).toBeGreaterThan(0);

  // The planted `taks` typo throws "data.tasks is not iterable". Matching the
  // thrown message is the whole point — an entry that only proves an error
  // happened, without carrying what broke, is useless to an agent. Match on
  // "iterable" alone: a looser predicate that also accepts "error" is
  // satisfied by the serialized `level: "error"` field and can never fail.
  expect(
    errorPayloads.some((payload) =>
      payload.toLowerCase().includes("iterable"),
    ),
  ).toBe(true);
});

test("captures network requests with response bodies", async ({ page }) => {
  await page.goto("/");
  // Page auto-fetches GET /api/tasks on mount
  await page.waitForTimeout(3000);

  const network = readSessionFile<{
    url?: string;
    method?: string;
    status?: number;
    responseBody?: string;
  }>("network.jsonl");

  expect(network.length).toBeGreaterThan(0);

  // Find the GET /api/tasks request
  const tasksReq = network.find(
    (n) =>
      n.url?.includes("/api/tasks") &&
      (n.method === "GET" || !n.method), // method may not be set for GET
  );
  expect(tasksReq).toBeDefined();
  expect(tasksReq!.status).toBe(200);

  // Response body should contain the "taks" typo (the planted bug)
  const bodyStr =
    typeof tasksReq!.responseBody === "string"
      ? tasksReq!.responseBody
      : JSON.stringify(tasksReq!.responseBody);
  expect(bodyStr).toContain("taks");
});

test("captures failed network requests", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  // Click "Delete All Tasks" — triggers DELETE /api/tasks → 405
  const deleteBtn = page.locator("button", { hasText: "Delete All Tasks" });
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();
  await page.waitForTimeout(3000);

  const network = readSessionFile<{
    url?: string;
    method?: string;
    status?: number;
  }>("network.jsonl");

  const deleteReq = network.find(
    (n) => n.method === "DELETE" && n.url?.includes("/api/tasks"),
  );
  expect(deleteReq).toBeDefined();
  expect(deleteReq!.status).toBe(405);
});

test("CLI summary works", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(3000);

  const output = execSync("node dist/cli/index.js summary", {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 10_000,
  });

  // The summary is what an agent actually reads, so it has to carry the
  // recorded evidence, not just the section headings — it must name the failing
  // request and quote the console error that the session captured.
  expect(output).toContain("/api/tasks");
  expect(output.toLowerCase()).toContain("failed to fetch tasks");
});

test("separate JSONL files are created", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(3000);

  // Verify expected files exist
  expect(sessionFileExists("events.jsonl")).toBe(true);
  expect(sessionFileExists("console.jsonl")).toBe(true);
  expect(sessionFileExists("network.jsonl")).toBe(true);
  expect(sessionFileExists("session.json")).toBe(true);

  // Verify the latest symlink resolves
  const target = getLatestTarget();
  expect(target).not.toBeNull();
  expect(target).toContain("sessions/");
});
