import type {
  AgentReplayEvent,
  ConsoleEntry,
  ErrorEntry,
  InteractionEntry,
  MarkerEntry,
  NetworkEntry,
  RouteChangeEntry,
  SessionMetadata,
  SessionSummary,
} from "../core/types.js";
import { budgetTimeline, correlateTimeline } from "./correlation.js";
import { SessionWriter } from "./writer.js";

function dataOf<T>(value: T | AgentReplayEvent): T {
  return value && typeof value === "object" && "data" in (value as object)
    ? (value as AgentReplayEvent).data as T
    : value as T;
}

export function buildSessionSummary(writer: SessionWriter, sessionId?: string): SessionSummary | null {
  const id = sessionId ?? writer.getLatestSessionId();
  if (!id) return null;
  const manifest = writer.readManifest(id);
  const session: SessionMetadata = manifest?.session ?? {
    id, startedAt: new Date(0).toISOString(), url: "", userAgent: "", viewport: { width: 0, height: 0 },
  };
  const timeline = writer.readJsonl<AgentReplayEvent>("timeline.jsonl", id);
  return {
    session,
    errors: writer.readJsonl<AgentReplayEvent | ErrorEntry>("errors.jsonl", id).map(dataOf<ErrorEntry>),
    network: writer.readJsonl<AgentReplayEvent | NetworkEntry>("network.jsonl", id).map(dataOf<NetworkEntry>),
    console: writer.readJsonl<AgentReplayEvent | ConsoleEntry>("console.jsonl", id).map(dataOf<ConsoleEntry>),
    interactions: writer.readJsonl<AgentReplayEvent | InteractionEntry>("interactions.jsonl", id).map(dataOf<InteractionEntry>),
    routeChanges: writer.readJsonl<AgentReplayEvent | RouteChangeEntry>("routes.jsonl", id).map(dataOf<RouteChangeEntry>),
    markers: writer.readJsonl<AgentReplayEvent | MarkerEntry>("markers.jsonl", id).map(dataOf<MarkerEntry>),
    incidents: correlateTimeline(timeline),
  };
}

function seconds(offsetMs: number): string {
  return (offsetMs / 1000).toFixed(1) + "s";
}

function compactBody(value: string | undefined): string {
  if (!value) return "";
  const compact = value.replace(/\s+/g, " ").slice(0, 240);
  return compact ? " — " + compact : "";
}

export function renderSummaryMarkdown(summary: SessionSummary): string {
  const { session } = summary;
  const duration = session.durationMs == null ? "active" : seconds(session.durationMs);
  const lines = [
    "# Agent Replay session",
    "",
    `- Session: ${session.id}`,
    `- Started: ${session.startedAt}`,
    `- Duration: ${duration}`,
    `- Mode: ${session.mode ?? "legacy"}`,
    `- Privacy: ${session.privacyPreset ?? "unknown"}`,
    `- Start URL: ${session.url || "(unknown)"}`,
    "",
    `## Failures (${summary.errors.length})`,
  ];
  if (summary.errors.length === 0) lines.push("No captured errors.");
  for (const error of summary.errors) {
    lines.push(`- [${seconds(error.offsetMs)}] ${error.message}${error.source ? " — " + error.source : ""}`);
  }

  const failures = summary.network.filter((entry) => entry.status == null || entry.status >= 400);
  lines.push("", `## Network (${summary.network.length} requests, ${failures.length} failures)`);
  if (summary.network.length === 0) lines.push("No captured requests.");
  for (const entry of summary.network) {
    const failed = entry.status == null || entry.status >= 400;
    if (failed || summary.network.length <= 20) {
      lines.push(`- [${seconds(entry.offsetMs)}] ${entry.method} ${entry.url} → ${entry.status ?? "ERR"} (${Math.round(entry.durationMs)}ms)${compactBody(entry.responseBody)}`);
    }
  }

  lines.push("", `## Route progression (${summary.routeChanges.length})`);
  if (summary.routeChanges.length === 0) lines.push("No route changes captured.");
  for (const route of summary.routeChanges) lines.push(`- [${seconds(route.offsetMs)}] ${route.from} → ${route.to}`);

  lines.push("", `## Interactions (${summary.interactions.length})`);
  if (summary.interactions.length === 0) lines.push("No semantic interactions captured.");
  for (const interaction of summary.interactions.slice(-40)) {
    lines.push(`- [${seconds(interaction.offsetMs)}] ${interaction.type}: ${interaction.target ?? "unknown"}${interaction.text ? " — " + interaction.text : ""}`);
  }

  lines.push("", `## Markers (${summary.markers.length})`);
  if (summary.markers.length === 0) lines.push("No markers.");
  for (const marker of summary.markers) lines.push(`- [${seconds(marker.offsetMs)}] ${marker.label}`);

  lines.push("", `## Correlated incidents (${summary.incidents.length})`);
  if (summary.incidents.length === 0) lines.push("No incident trigger captured.");
  for (const incident of summary.incidents) {
    lines.push(`- [${seconds(incident.trigger.offsetMs)}] [Open in viewer](http://127.0.0.1:3700/?session=${session.id}&t=${incident.trigger.offsetMs}) — ${incident.summary}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateSummary(writer: SessionWriter, sessionId?: string): string | null {
  const id = sessionId ?? writer.getLatestSessionId();
  if (!id) return null;
  const summary = buildSessionSummary(writer, id);
  if (!summary) return null;
  const markdown = renderSummaryMarkdown(summary);
  writer.writeSummary(id, markdown);
  return markdown;
}

export function inspectSession(writer: SessionWriter, sessionId: string | undefined, tokenBudget = 4_000): string {
  const id = sessionId ?? writer.getLatestSessionId();
  if (!id) throw new Error("No session found");
  const summary = generateSummary(writer, id) ?? "";
  const timeline = budgetTimeline(writer.readJsonl<AgentReplayEvent>("timeline.jsonl", id), tokenBudget);
  const available = Math.max(0, tokenBudget * 4 - summary.length);
  if (available < 256) return summary.slice(0, tokenBudget * 4);
  const evidence = timeline.map((event) => JSON.stringify(event)).join("\n").slice(0, available);
  return summary + "\n## Budgeted evidence\n\n```jsonl\n" + evidence + "\n```\n";
}
