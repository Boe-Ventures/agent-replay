import * as crypto from "node:crypto";
import type { AgentReplayEvent, CorrelatedIncident } from "../core/types.js";

function describe(event: AgentReplayEvent): string {
  const data = event.data as Record<string, unknown>;
  if (event.type === "interaction") return String(data.type ?? "interaction") + (data.target ? " " + data.target : "");
  if (event.type === "network") return String(data.method ?? "GET") + " " + String(data.url ?? "") + " → " + String(data.status ?? "ERR");
  if (event.type === "error") return String(data.message ?? "Error");
  if (event.type === "route-change") return String(data.from ?? "") + " → " + String(data.to ?? "");
  if (event.type === "marker") return String(data.label ?? "Marker");
  return event.type;
}

export function correlateTimeline(events: AgentReplayEvent[]): CorrelatedIncident[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp);
  const triggers = ordered.filter((event) => {
    if (event.type === "error") return true;
    if (event.type === "network") {
      const status = (event.data as { status?: number | null }).status;
      return status == null || status >= 500;
    }
    return event.type === "marker" && (event.data as { triggerIncident?: boolean }).triggerIncident === true;
  });
  return triggers.map((trigger) => {
    const related = ordered.filter((event) =>
      event.pageId === trigger.pageId
      && event.timestamp >= trigger.timestamp - 10_000
      && event.timestamp <= trigger.timestamp + 3_000,
    );
    const sequence = related
      .filter((event) => ["interaction", "network", "error", "route-change", "marker"].includes(event.type))
      .map(describe)
      .join(" → ");
    return {
      id: crypto.createHash("sha1").update(trigger.id).digest("hex").slice(0, 12),
      trigger,
      events: related,
      summary: sequence || describe(trigger),
    };
  });
}

function signalScore(event: AgentReplayEvent): number {
  if (event.type === "error") return 100;
  if (event.type === "marker") return 90;
  if (event.type === "network") {
    const status = (event.data as { status?: number | null }).status;
    if (status == null || status >= 500) return 85;
    if (status >= 400) return 55;
    return 25;
  }
  if (event.type === "route-change") return 50;
  if (event.type === "interaction") return 45;
  if (event.type === "console") {
    const level = (event.data as { level?: string }).level;
    return level === "error" ? 80 : level === "warn" ? 40 : 10;
  }
  return 5;
}

export function budgetTimeline(events: AgentReplayEvent[], tokenBudget: number): AgentReplayEvent[] {
  const characterBudget = Math.max(256, tokenBudget * 4);
  const ranked = [...events].sort((a, b) => signalScore(b) - signalScore(a) || b.timestamp - a.timestamp);
  const selected: AgentReplayEvent[] = [];
  let size = 0;
  for (const event of ranked) {
    const eventSize = JSON.stringify(event).length + 1;
    if (size + eventSize > characterBudget && selected.length > 0) continue;
    selected.push(event);
    size += eventSize;
    if (size >= characterBudget) break;
  }
  return selected.sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp);
}
