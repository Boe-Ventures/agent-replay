#!/usr/bin/env node

import { SessionWriter } from "../server/writer.js";
import { createSidecar } from "../server/sidecar.js";
import { generateSummary } from "../server/summarizer.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const writer = new SessionWriter();

async function main(): Promise<void> {
  switch (command) {
    case "dev": {
      const port = parseInt(getFlag("port") ?? "3700", 10);
      const sidecar = createSidecar({ port });

      process.on("SIGINT", async () => {
        console.log("\n[agent-replay] Shutting down...");
        await sidecar.stop();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        await sidecar.stop();
        process.exit(0);
      });

      await sidecar.start();
      console.log(
        `[agent-replay] Sidecar ready. Events will be written to .agent-replay/`
      );
      console.log(`[agent-replay] Press Ctrl+C to stop.`);
      break;
    }

    case "summary": {
      const sessionId = getFlag("session") ?? undefined;
      const markdown = generateSummary(writer, sessionId);
      if (markdown) {
        process.stdout.write(markdown);
      } else {
        console.error(
          "[agent-replay] No session found. Start recording first."
        );
        process.exit(1);
      }
      break;
    }

    case "errors": {
      const sessionId = getFlag("session") ?? undefined;
      const id = sessionId ?? writer.getLatestSessionId();
      if (!id) {
        console.error(
          "[agent-replay] No session found. Start recording first."
        );
        process.exit(1);
        return;
      }
      const errors = writer.readJsonl("errors.jsonl", id);
      if (errors.length === 0) {
        console.log("[agent-replay] No errors in session.");
      } else {
        for (const err of errors) {
          console.log(JSON.stringify(err));
        }
      }
      break;
    }

    case "network": {
      const sessionId = getFlag("session") ?? undefined;
      const id = sessionId ?? writer.getLatestSessionId();
      if (!id) {
        console.error(
          "[agent-replay] No session found. Start recording first."
        );
        process.exit(1);
        return;
      }
      const network = writer.readJsonl<{ status?: number | null }>("network.jsonl", id);
      const failuresOnly = hasFlag("failures");
      const filtered = failuresOnly
        ? network.filter(
            (n) => n.status === null || (n.status ?? 0) >= 400
          )
        : network;

      if (filtered.length === 0) {
        console.log(
          failuresOnly
            ? "[agent-replay] No network failures in session."
            : "[agent-replay] No network requests in session."
        );
      } else {
        for (const entry of filtered) {
          console.log(JSON.stringify(entry));
        }
      }
      break;
    }

    case "sessions": {
      const sessions = writer.listSessions();
      if (sessions.length === 0) {
        console.log("[agent-replay] No sessions found.");
      } else {
        const latest = writer.getLatestSessionId();
        for (const s of sessions) {
          const marker = s.id === latest ? " ← latest" : "";
          const url = s.metadata?.url ?? "";
          const duration = s.metadata?.durationMs
            ? `${(s.metadata.durationMs / 1000).toFixed(1)}s`
            : "active";
          console.log(`  ${s.id}  ${duration}  ${url}${marker}`);
        }
      }
      break;
    }

    default:
      console.log(`agent-replay — Local session recording for AI-assisted development

Usage:
  agent-replay dev [--port 3700]         Start the sidecar server
  agent-replay summary [--session ID]    Print summary of latest session
  agent-replay errors [--session ID]     Print errors from latest session
  agent-replay network [--failures]      Print network log
  agent-replay sessions                  List all sessions

Options:
  --port <number>     Sidecar port (default: 3700)
  --session <id>      Target a specific session
  --failures          Show only failed network requests
`);
      if (command && command !== "help" && command !== "--help") {
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error("[agent-replay] Fatal:", err);
  process.exit(1);
});
