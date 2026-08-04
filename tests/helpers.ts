import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const SIDECAR_PORT = 3797;
export const BUGBOARD_PORT = 3897;
export const CRASH_CAFE_PORT = 3898;
export const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`;
export const BUGBOARD_URL = `http://127.0.0.1:${BUGBOARD_PORT}`;
export const CRASH_CAFE_URL = `http://127.0.0.1:${CRASH_CAFE_PORT}`;
export const AGENT_REPLAY_DIR = path.join(ROOT, ".agent-replay-e2e");

export async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await new Promise<boolean>((resolve) => {
      http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode != null && response.statusCode >= 200 && response.statusCode < 300);
      }).on("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already stopped */ }
  }
}

function reportProcessFailure(name: string, child: ChildProcess): void {
  child.stderr?.on("data", (chunk: Buffer) => {
    const message = chunk.toString();
    if (/\b(error|failed|exception)\b/i.test(message)) process.stderr.write(`[${name}] ${message}`);
  });
}

export async function startSidecar(): Promise<() => void> {
  const child = spawn("node", ["dist/cli/index.js", "dev", "--port", String(SIDECAR_PORT), "--dir", AGENT_REPLAY_DIR, "--no-open"], {
    cwd: ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env },
  });
  reportProcessFailure("sidecar", child);
  try { await waitForReady(`${SIDECAR_URL}/api/v1/health`); }
  catch (error) { killTree(child); throw error; }
  return () => killTree(child);
}

export async function startBugBoard(): Promise<() => void> {
  const child = spawn("node", [path.join(ROOT, "playground", "node_modules", "next", "dist", "bin", "next"), "start", path.join(ROOT, "playground"), "--port", String(BUGBOARD_PORT)], {
    cwd: path.join(ROOT, "playground"),
    stdio: "pipe",
    detached: true,
    env: { ...process.env, NEXT_PUBLIC_AGENT_REPLAY_URL: `${SIDECAR_URL}/api/v1` },
  });
  reportProcessFailure("bugboard", child);
  try { await waitForReady(BUGBOARD_URL); }
  catch (error) { killTree(child); throw error; }
  return () => killTree(child);
}

export async function startCrashCafe(): Promise<() => void> {
  const child = spawn("node", [path.join(ROOT, "playground-vite", "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(CRASH_CAFE_PORT)], {
    cwd: path.join(ROOT, "playground-vite"),
    stdio: "pipe",
    detached: true,
    env: { ...process.env, VITE_AGENT_REPLAY_URL: `${SIDECAR_URL}/api/v1` },
  });
  reportProcessFailure("crash-cafe", child);
  try { await waitForReady(CRASH_CAFE_URL); }
  catch (error) { killTree(child); throw error; }
  return () => killTree(child);
}

export function cleanAgentReplay(): void {
  fs.rmSync(AGENT_REPLAY_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, ".agent-replay-e2e-artifacts"), { recursive: true, force: true });
}

export function buildPackage(): void {
  execFileSync("bun", ["run", "build"], { cwd: ROOT, stdio: "pipe" });
  execFileSync("bun", ["run", "build"], {
    cwd: path.join(ROOT, "playground"),
    stdio: "pipe",
    env: { ...process.env, NEXT_PUBLIC_AGENT_REPLAY_URL: `${SIDECAR_URL}/api/v1` },
  });
}

export async function listSessions(): Promise<Array<{ id: string; metadata: Record<string, unknown> | null }>> {
  const response = await fetch(`${SIDECAR_URL}/api/v1/sessions`);
  if (!response.ok) throw new Error(`Unable to list sessions: ${response.status}`);
  return (await response.json() as { sessions: Array<{ id: string; metadata: Record<string, unknown> | null }> }).sessions;
}

export async function waitForNewSession(previous: Set<string>, timeoutMs = 15_000): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = (await listSessions()).find((candidate) => !previous.has(candidate.id));
    if (session) return session.id;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for a new Agent Replay session");
}

export async function waitForSignal(sessionId: string, filename: string, predicate: (events: Array<Record<string, unknown>>) => boolean, timeoutMs = 15_000): Promise<Array<Record<string, unknown>>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const events = readSignal(sessionId, filename);
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${filename} in ${sessionId}`);
}

export async function waitForNewSessionWithSignal(
  previous: Set<string>,
  filename: string,
  predicate: (events: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 20_000,
): Promise<{ sessionId: string; events: Array<Record<string, unknown>> }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const session of await listSessions()) {
      if (previous.has(session.id)) continue;
      const events = readSignal(session.id, filename);
      if (predicate(events)) return { sessionId: session.id, events };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for a new session containing ${filename}`);
}

export function sessionDir(sessionId: string): string {
  return path.join(AGENT_REPLAY_DIR, "sessions", sessionId);
}

export function readSignal(sessionId: string, filename: string): Array<Record<string, unknown>> {
  const filePath = path.join(sessionDir(sessionId), filename);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function dataOf(event: Record<string, unknown>): Record<string, unknown> {
  return event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : event;
}

export function sessionContains(sessionId: string, needle: string): boolean {
  const visit = (directory: string): boolean => fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(filePath);
    return fs.readFileSync(filePath).includes(needle);
  });
  return visit(sessionDir(sessionId));
}

export function runCli(args: string[]): string {
  return execFileSync("node", ["dist/cli/index.js", ...args, "--dir", AGENT_REPLAY_DIR], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}
