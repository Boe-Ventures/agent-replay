import { type ChildProcess, spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

const ROOT = path.resolve(import.meta.dirname, "..");
const AGENT_REPLAY_DIR = path.join(ROOT, ".agent-replay");
const LATEST_DIR = path.join(AGENT_REPLAY_DIR, "latest");

/** Wait until a URL returns 200 */
async function waitForReady(
  url: string,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        http
          .get(url, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          })
          .on("error", () => resolve(false));
      });
      if (ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** Kill a child process tree */
function killTree(child: ChildProcess): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
  }
}

/** Start the sidecar server on port 3700 */
export async function startSidecar(): Promise<() => void> {
  const child = spawn("node", ["dist/cli/index.js", "dev", "--port", "3700"], {
    cwd: ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env },
  });
  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString();
    if (!msg.includes("[agent-replay]")) console.error("[sidecar stderr]", msg);
  });

  await waitForReady("http://localhost:3700/health");
  return () => killTree(child);
}

/** Start the Next.js playground on port 3800 */
export async function startPlayground(): Promise<() => void> {
  const child = spawn("pnpm", ["dev"], {
    cwd: path.join(ROOT, "playground"),
    stdio: "pipe",
    detached: true,
    env: { ...process.env },
  });
  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString();
    if (msg.includes("Error") || msg.includes("error"))
      console.error("[playground stderr]", msg);
  });

  await waitForReady("http://localhost:3800", 45_000);
  return () => killTree(child);
}

/**
 * Read and parse a JSONL file from `.agent-replay/latest/`.
 * Returns parsed JSON objects per line, skipping empty lines.
 */
export function readSessionFile<T = Record<string, unknown>>(
  filename: string,
): T[] {
  const filePath = path.join(LATEST_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** Check if a file exists in `.agent-replay/latest/` */
export function sessionFileExists(filename: string): boolean {
  return fs.existsSync(path.join(LATEST_DIR, filename));
}

/** Get the resolved path of the `latest` symlink */
export function getLatestTarget(): string | null {
  const latestLink = path.join(AGENT_REPLAY_DIR, "latest");
  if (!fs.existsSync(latestLink)) return null;
  return fs.readlinkSync(latestLink);
}

/** Remove `.agent-replay/` directory for a fresh start */
export function cleanAgentReplay(): void {
  if (fs.existsSync(AGENT_REPLAY_DIR)) {
    fs.rmSync(AGENT_REPLAY_DIR, { recursive: true, force: true });
  }
}

/** Build the package (ensures dist/ is fresh) */
export function buildPackage(): void {
  execSync("pnpm build", { cwd: ROOT, stdio: "pipe" });
}
