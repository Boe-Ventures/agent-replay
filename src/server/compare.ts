import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentReplayEvent, ComparisonResult, ErrorEntry, NetworkEntry } from "../core/types.js";
import { SessionWriter } from "./writer.js";

function unwrap<T>(event: AgentReplayEvent | T): T {
  return event && typeof event === "object" && "data" in (event as object) ? (event as AgentReplayEvent).data as T : event as T;
}

function errorKey(error: ErrorEntry): string {
  return error.fingerprint ?? crypto.createHash("sha1").update(error.message + "\n" + (error.stack ?? "")).digest("hex");
}

function networkMap(writer: SessionWriter, id: string): Map<string, NetworkEntry> {
  return new Map(writer.readJsonl<AgentReplayEvent | NetworkEntry>("network.jsonl", id).map(unwrap<NetworkEntry>).map((entry) => [entry.method + " " + entry.url, entry]));
}

function alignment(writer: SessionWriter, before: string, after: string): ComparisonResult["alignment"] {
  const common = (file: string, field: string) => {
    const values = (id: string) => new Set(writer.readJsonl<AgentReplayEvent>(file, id).map((event) => String((event.data as Record<string, unknown>)[field] ?? "")));
    const left = values(before); const right = values(after);
    return [...left].some((value) => value && right.has(value));
  };
  if (common("markers.jsonl", "label")) return "markers";
  if (common("playwright-steps.jsonl", "title")) return "playwright-steps";
  if (common("routes.jsonl", "to") || common("interactions.jsonl", "target")) return "routes-actions";
  return "timestamps";
}

export function compareSessions(writer: SessionWriter, before: string, after: string): ComparisonResult {
  const beforeErrors = writer.readJsonl<AgentReplayEvent | ErrorEntry>("errors.jsonl", before).map(unwrap<ErrorEntry>);
  const afterErrors = writer.readJsonl<AgentReplayEvent | ErrorEntry>("errors.jsonl", after).map(unwrap<ErrorEntry>);
  const beforeErrorMap = new Map(beforeErrors.map((error) => [errorKey(error), error.message]));
  const afterErrorMap = new Map(afterErrors.map((error) => [errorKey(error), error.message]));
  const beforeNetwork = networkMap(writer, before);
  const afterNetwork = networkMap(writer, after);
  const changedNetwork = [...new Set([...beforeNetwork.keys(), ...afterNetwork.keys()])]
    .filter((key) => beforeNetwork.get(key)?.status !== afterNetwork.get(key)?.status)
    .map((key) => ({ key, beforeStatus: beforeNetwork.get(key)?.status ?? null, afterStatus: afterNetwork.get(key)?.status ?? null }));
  const routes = (id: string) => writer.readJsonl<AgentReplayEvent>( "routes.jsonl", id).map((event) => String((event.data as { to?: string }).to ?? ""));
  const beforeRoutes = new Set(routes(before));
  const afterRoutes = new Set(routes(after));
  const timings: ComparisonResult["timingChanges"] = [];
  for (const [key, beforeEntry] of beforeNetwork) {
    const afterEntry = afterNetwork.get(key);
    if (afterEntry) timings.push({ key, beforeMs: beforeEntry.durationMs, afterMs: afterEntry.durationMs, deltaMs: afterEntry.durationMs - beforeEntry.durationMs });
  }
  const finalHash = (id: string) => {
    const events = writer.readJsonl<unknown>("events.jsonl", id);
    return crypto.createHash("sha1").update(JSON.stringify(events.at(-1) ?? null)).digest("hex");
  };
  return {
    beforeSessionId: before, afterSessionId: after, alignment: alignment(writer, before, after),
    resolvedErrors: [...beforeErrorMap].filter(([key]) => !afterErrorMap.has(key)).map(([, message]) => message),
    newErrors: [...afterErrorMap].filter(([key]) => !beforeErrorMap.has(key)).map(([, message]) => message),
    changedNetwork,
    completedRoutes: [...afterRoutes].filter((route) => !beforeRoutes.has(route)),
    missingRoutes: [...beforeRoutes].filter((route) => !afterRoutes.has(route)),
    timingChanges: timings,
    finalStateChanged: finalHash(before) !== finalHash(after),
  };
}

export function renderComparisonMarkdown(result: ComparisonResult): string {
  const lines = [
    "# Agent Replay fix receipt", "",
    `Before: ${result.beforeSessionId}`,
    `After: ${result.afterSessionId}`,
    `Alignment: ${result.alignment}`, "",
    `## Resolved errors (${result.resolvedErrors.length})`,
    ...result.resolvedErrors.map((value) => "- " + value),
    "", `## New errors (${result.newErrors.length})`,
    ...result.newErrors.map((value) => "- " + value),
    "", `## Changed network outcomes (${result.changedNetwork.length})`,
    ...result.changedNetwork.map((value) => `- ${value.key}: ${value.beforeStatus ?? "ERR"} → ${value.afterStatus ?? "ERR"}`),
    "", `## Route completion`,
    ...result.completedRoutes.map((value) => "- Completed: " + value),
    ...result.missingRoutes.map((value) => "- Missing: " + value),
    "", `Final visual state changed: ${result.finalStateChanged ? "yes" : "no"}`, "",
  ];
  return lines.join("\n");
}

export function writeComparison(
  writer: SessionWriter,
  before: string,
  after: string,
  outputDirectory: string,
): { json: string; markdown: string; html: string; result: ComparisonResult } {
  const result = compareSessions(writer, before, after);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const jsonFile = path.join(outputDirectory, "fix-receipt.json");
  const markdownFile = path.join(outputDirectory, "fix-receipt.md");
  const htmlFile = path.join(outputDirectory, "fix-receipt.html");
  const markdown = renderComparisonMarkdown(result);
  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(markdownFile, markdown);
  fs.writeFileSync(htmlFile, "<!doctype html><meta charset=utf-8><title>Agent Replay fix receipt</title><style>body{max-width:800px;margin:40px auto;font:16px/1.6 system-ui;background:#0b1020;color:#edf2f7}pre{white-space:pre-wrap}</style><pre>" + markdown.replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</pre>");
  return { json: jsonFile, markdown: markdownFile, html: htmlFile, result };
}
