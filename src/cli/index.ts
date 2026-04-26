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
      const maxSessions = getFlag("max-sessions") ? parseInt(getFlag("max-sessions")!, 10) : undefined;
      const maxAgeHours = getFlag("max-age") ? parseInt(getFlag("max-age")!, 10) : undefined;
      const preserveLogs = hasFlag("preserve-logs");
      const sidecar = createSidecar({
        port,
        cleanupConfig: (maxSessions != null || maxAgeHours != null || preserveLogs)
          ? { maxSessions, maxAgeHours, preserveLogs }
          : { maxSessions: 5, maxAgeHours: 24 },
      });

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

    case "clean": {
      if (hasFlag("all")) {
        const { deleted } = writer.cleanAll();
        console.log(`[agent-replay] Deleted all ${deleted.length} session(s).`);
      } else {
        const keep = getFlag("keep") ? parseInt(getFlag("keep")!, 10) : 5;
        const maxAge = getFlag("max-age") ? parseInt(getFlag("max-age")!, 10) : 24;
        const { deleted } = writer.cleanup({ maxSessions: keep, maxAgeHours: maxAge });
        if (deleted.length === 0) {
          console.log("[agent-replay] Nothing to clean up.");
        } else {
          console.log(`[agent-replay] Cleaned up ${deleted.length} session(s):`);
          for (const id of deleted) {
            console.log(`  - ${id}`);
          }
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
  agent-replay clean [--keep 5]          Clean up old sessions
  agent-replay clean --all               Delete all sessions

Options:
  --port <number>        Sidecar port (default: 3700)
  --session <id>         Target a specific session
  --failures             Show only failed network requests
  --keep <number>        Max sessions to keep (default: 5)
  --max-age <hours>      Max session age in hours (default: 24)
  --max-sessions <n>     Max sessions for dev auto-cleanup (default: 5)
  --preserve-logs        Never auto-delete sessions in dev mode
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
