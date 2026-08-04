import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AGENT_REPLAY_DIR,
  BUGBOARD_URL,
  CRASH_CAFE_URL,
  ROOT,
  SIDECAR_URL,
  buildPackage,
  cleanAgentReplay,
  dataOf,
  listSessions,
  readSignal,
  runCli,
  sessionContains,
  sessionDir,
  startBugBoard,
  startCrashCafe,
  startSidecar,
  waitForNewSession,
  waitForNewSessionWithSignal,
  waitForSignal,
} from "./helpers.js";

let stopSidecar: () => void;
let stopBugBoard: () => void;
let stopCrashCafe: () => void;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  buildPackage();
  cleanAgentReplay();
  stopSidecar = await startSidecar();
  stopBugBoard = await startBugBoard();
  stopCrashCafe = await startCrashCafe();
});

test.afterAll(() => {
  stopCrashCafe?.();
  stopBugBoard?.();
  stopSidecar?.();
});

test("captures a coherent BugBoard failure and keeps secrets off disk", async ({ browser }) => {
  const known = new Set((await listSessions()).map((session) => session.id));
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BUGBOARD_URL);
  await page.getByRole("button", { name: "Run broken triage" }).click();
  await expect(page.getByText("Captured failure")).toBeVisible();

  const { sessionId, events: network } = await waitForNewSessionWithSignal(
    known,
    "network.jsonl",
    (events) => events.some((event) => dataOf(event).status === 500),
  );
  const errors = await waitForSignal(sessionId, "errors.jsonl", (events) => events.length > 0);
  const markers = await waitForSignal(sessionId, "markers.jsonl", (events) => events.some((event) => dataOf(event).label === "triage-sync"));

  const failedRequest = network.map(dataOf).find((event) => event.status === 500);
  expect(failedRequest?.method).toBe("POST");
  expect(String(failedRequest?.url)).toContain("/api/triage");
  expect(errors.map(dataOf).some((event) => event.source === "network" && String(event.message).includes("returned 500"))).toBe(true);
  await expect(page.getByText("Cannot read properties of undefined (reading 'assignee')")).toBeVisible();
  expect(markers.map(dataOf).some((event) => event.label === "triage-sync")).toBe(true);
  expect(sessionContains(sessionId, "fixture-secret-never-on-disk")).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(sessionDir(sessionId), "manifest.json"), "utf8")).session.pinned).toBe(true);
  expect(fs.existsSync(path.join(sessionDir(sessionId), "events.jsonl"))).toBe(true);
  await context.close();
});

test("compares the broken and fixed BugBoard flows as a fix receipt", async ({ browser }) => {
  const sessionsBeforeBroken = new Set((await listSessions()).map((session) => session.id));
  const brokenContext = await browser.newContext();
  const brokenPage = await brokenContext.newPage();
  await brokenPage.goto(BUGBOARD_URL);
  await brokenPage.getByRole("button", { name: "Run broken triage" }).click();
  await expect(brokenPage.getByText("Captured failure")).toBeVisible();
  const { sessionId: beforeId } = await waitForNewSessionWithSignal(
    sessionsBeforeBroken,
    "network.jsonl",
    (events) => events.some((event) => dataOf(event).status === 500),
  );
  await brokenContext.close();

  const sessionsBeforeFixed = new Set((await listSessions()).map((session) => session.id));
  const fixedContext = await browser.newContext();
  const fixedPage = await fixedContext.newPage();
  await fixedPage.goto(BUGBOARD_URL);
  await fixedPage.getByRole("button", { name: "Run clean triage" }).click();
  await expect(fixedPage.getByText("Triage completed")).toBeVisible();
  const { sessionId: afterId } = await waitForNewSessionWithSignal(
    sessionsBeforeFixed,
    "network.jsonl",
    (events) => events.some((event) => dataOf(event).status === 200),
  );
  await fixedContext.close();

  const outputDirectory = path.join(ROOT, ".agent-replay-e2e-artifacts", "receipt");
  const result = JSON.parse(runCli(["receipt", beforeId, afterId, "--output", outputDirectory])) as {
    result: { alignment: string; resolvedErrors: string[]; newErrors: string[]; changedNetwork: Array<{ beforeStatus: number; afterStatus: number }> };
  };
  expect(result.result.alignment).toBe("markers");
  expect(result.result.resolvedErrors.length).toBeGreaterThan(0);
  expect(result.result.newErrors).toHaveLength(0);
  expect(result.result.changedNetwork).toContainEqual(expect.objectContaining({ beforeStatus: 500, afterStatus: 200 }));
  expect(fs.existsSync(path.join(outputDirectory, "fix-receipt.json"))).toBe(true);
  expect(fs.existsSync(path.join(outputDirectory, "fix-receipt.md"))).toBe(true);
  expect(fs.existsSync(path.join(outputDirectory, "fix-receipt.html"))).toBe(true);

  const capsule = JSON.parse(runCli(["pack", beforeId, "--output", path.join(ROOT, ".agent-replay-e2e-artifacts", "broken.areplay")])) as { output: string };
  expect(fs.statSync(capsule.output).size).toBeGreaterThan(1_000);
  expect(fs.readFileSync(capsule.output).subarray(0, 2).toString()).toBe("PK");
  expect(fs.existsSync(path.join(sessionDir(beforeId), "report.html"))).toBe(true);
});

test("keeps a session stable through reload while separating concurrent tabs", async ({ browser }) => {
  const known = new Set((await listSessions()).map((session) => session.id));
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(BUGBOARD_URL);
  const firstId = await waitForNewSession(known);
  await first.reload();
  await first.getByRole("button", { name: "Run clean triage" }).click();
  await waitForSignal(firstId, "markers.jsonl", (events) => events.some((event) => dataOf(event).label === "triage-complete"));

  const afterFirst = new Set((await listSessions()).map((session) => session.id));
  const second = await context.newPage();
  await second.goto(BUGBOARD_URL);
  const secondId = await waitForNewSession(afterFirst);
  expect(secondId).not.toBe(firstId);
  const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir(firstId), "manifest.json"), "utf8")) as { pages: Array<{ id: string }> };
  expect(new Set(manifest.pages.map((page) => page.id)).size).toBeGreaterThanOrEqual(2);
  await context.close();
});

test("captures CrashCafe rejection and does not pin an ordinary 404", async ({ browser }) => {
  const known = new Set((await listSessions()).map((session) => session.id));
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(CRASH_CAFE_URL);
  await page.getByRole("button", { name: "Check sold-out item" }).click();
  await expect(page.getByText(/ordinary 404/)).toBeVisible();
  const sessionId = await waitForNewSession(known);
  await waitForSignal(sessionId, "network.jsonl", (events) => events.some((event) => dataOf(event).status === 404));
  let manifest = JSON.parse(fs.readFileSync(path.join(sessionDir(sessionId), "manifest.json"), "utf8")) as { session: { pinned?: boolean } };
  expect(manifest.session.pinned).not.toBe(true);

  await page.getByRole("button", { name: "Place broken order" }).click();
  await waitForSignal(sessionId, "errors.jsonl", (events) => events.length > 0);
  manifest = JSON.parse(fs.readFileSync(path.join(sessionDir(sessionId), "manifest.json"), "utf8")) as { session: { pinned?: boolean } };
  expect(manifest.session.pinned).toBe(true);
  expect(sessionContains(sessionId, "fixture-secret")).toBe(false);
  await context.close();
});

test("serves the viewer and deterministic budgeted inspection", async ({ browser }) => {
  let latest = (await listSessions())[0];
  if (!latest) {
    const known = new Set<string>();
    const fixture = await browser.newPage();
    await fixture.goto(BUGBOARD_URL);
    await fixture.getByRole("button", { name: "Run clean triage" }).click();
    const { sessionId: id } = await waitForNewSessionWithSignal(
      known,
      "network.jsonl",
      (events) => events.some((event) => dataOf(event).status === 200),
    );
    await fixture.close();
    latest = (await listSessions()).find((session) => session.id === id);
  }
  expect(latest).toBeDefined();
  const page = await browser.newPage();
  const response = await page.goto(`${SIDECAR_URL}/?session=${latest!.id}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".brand")).toContainText("Agent Replay");
  const inspection = runCli(["inspect", latest!.id, "--budget", "1000"]);
  expect(inspection).toContain("# Agent Replay session");
  expect(inspection.length).toBeLessThanOrEqual(4_200);
  expect(readSignal(latest!.id, "timeline.jsonl").length).toBeGreaterThan(0);
  await page.close();
});

test("uses only the isolated e2e recording directory", () => {
  expect(AGENT_REPLAY_DIR).toContain(".agent-replay-e2e");
  expect(fs.existsSync(path.join(ROOT, ".agent-replay"))).toBe(false);
});
