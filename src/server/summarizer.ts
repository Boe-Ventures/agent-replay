import * as fs from "node:fs";
import type {
  SessionMetadata,
  ConsoleEntry,
  NetworkEntry,
  ErrorEntry,
  SessionSummary,
} from "../core/types.js";
import { SessionWriter } from "./writer.js";

/** Build a SessionSummary from files on disk */
export function buildSessionSummary(
  writer: SessionWriter,
  sessionId?: string
): SessionSummary | null {
  const resolvedId = sessionId ?? writer.getLatestSessionId();
  if (!resolvedId) return null;

  const dir = writer.getSessionDir(resolvedId);
  const metadataPath = `${dir}/session.json`;

  let session: SessionMetadata;
  try {
    session = JSON.parse(
      fs.readFileSync(metadataPath, "utf-8")
    ) as SessionMetadata;
  } catch {
    // Construct minimal metadata
    session = {
      id: resolvedId,
      startedAt: resolvedId,
      url: "",
      userAgent: "",
      viewport: { width: 0, height: 0 },
    };
  }

  const errors = writer.readJsonl<ErrorEntry>("errors.jsonl", resolvedId);
  const network = writer.readJsonl<NetworkEntry>("network.jsonl", resolvedId);
  const consoleEntries = writer.readJsonl<ConsoleEntry>("console.jsonl", resolvedId);

  return {
    session,
    errors,
    network,
    console: consoleEntries,
    interactions: [],
    routeChanges: [],
  };
}

/** Render a SessionSummary to markdown (DESIGN.md format) */
export function renderSummaryMarkdown(summary: SessionSummary): string {
  const { session, errors, network, console: consoleEntries } = summary;
  const durationSec = session.durationMs
    ? (session.durationMs / 1000).toFixed(1)
    : "?";

  const lines: string[] = [];

  lines.push(`# Session ${session.startedAt} (${durationSec}s)`);
  lines.push("");

  // Errors
  lines.push(`## Errors (${errors.length})`);
  if (errors.length === 0) {
    lines.push("No errors recorded.");
  } else {
    for (const err of errors) {
      const offset = (err.offsetMs / 1000).toFixed(1);
      const location = err.source && err.line
        ? ` at ${err.source}:${err.line}`
        : "";
      lines.push(`- [${offset}s] ${err.message}${location}`);
    }
  }
  lines.push("");

  // Network
  const failures = network.filter(
    (n) => n.status === null || n.status >= 400
  );
  lines.push(
    `## Network (${network.length} requests, ${failures.length} failure${failures.length !== 1 ? "s" : ""})`
  );
  if (network.length === 0) {
    lines.push("No network requests recorded.");
  } else {
    for (const req of network) {
      const offset = (req.offsetMs / 1000).toFixed(1);
      const status = req.status ?? "ERR";
      const duration = `${req.durationMs}ms`;
      const failed =
        req.status === null || req.status >= 400 ? " ← FAILED" : "";
      lines.push(
        `- [${offset}s] ${req.method} ${req.url} → ${status} (${duration})${failed}`
      );
    }
  }
  lines.push("");

  // Console
  lines.push(`## Console (${consoleEntries.length} entries)`);
  if (consoleEntries.length === 0) {
    lines.push("No console output recorded.");
  } else {
    for (const entry of consoleEntries) {
      const offset = (entry.offsetMs / 1000).toFixed(1);
      const args = entry.args
        .map((a) =>
          typeof a === "string" ? a : JSON.stringify(a)
        )
        .join(" ");
      lines.push(`- [${offset}s] ${entry.level}: ${JSON.stringify(args)}`);
    }
  }
  lines.push("");

  // Interactions
  if (summary.interactions.length > 0) {
    lines.push(`## Interactions (${summary.interactions.length})`);
    for (const i of summary.interactions) {
      const offset = (i.offsetMs / 1000).toFixed(1);
      const detail = i.value ? ` → ${JSON.stringify(i.value)}` : "";
      lines.push(
        `- [${offset}s] ${i.type}: ${i.target ?? "unknown"}${detail}`
      );
    }
    lines.push("");
  }

  // Route changes
  if (summary.routeChanges.length > 0) {
    lines.push("## Route changes");
    for (const r of summary.routeChanges) {
      const offset = (r.offsetMs / 1000).toFixed(1);
      lines.push(`- [${offset}s] ${r.from} → ${r.to}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Generate and write summary for a session */
export function generateSummary(
  writer: SessionWriter,
  sessionId?: string
): string | null {
  const summary = buildSessionSummary(writer, sessionId);
  if (!summary) return null;
  const markdown = renderSummaryMarkdown(summary);
  writer.writeSummary(markdown);
  return markdown;
}
