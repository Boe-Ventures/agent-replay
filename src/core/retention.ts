import type { AgentReplayEvent, RetentionPolicy, TriggerPolicy } from "./types.js";

export const DEFAULT_RETENTION: Required<RetentionPolicy> = {
  rollingWindowMs: 5 * 60 * 1000,
  checkpointIntervalMs: 30 * 1000,
  preTriggerMs: 2 * 60 * 1000,
  postTriggerMs: 15 * 1000,
  maxPinnedSessions: 20,
  pinnedMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  preserve: false,
};

export const DEFAULT_TRIGGERS: Required<TriggerPolicy> = {
  uncaughtErrors: true,
  rejectedPromises: true,
  serverErrors: true,
  networkFailures: true,
  manualMarkers: true,
  clientErrors: false,
};

export function resolveRetention(policy: RetentionPolicy = {}): Required<RetentionPolicy> {
  return { ...DEFAULT_RETENTION, ...policy };
}

export function isIncidentTrigger(event: AgentReplayEvent, policy: TriggerPolicy = {}): boolean {
  const resolved = { ...DEFAULT_TRIGGERS, ...policy };
  if (event.type === "marker") return resolved.manualMarkers && (event.data as { triggerIncident?: boolean }).triggerIncident === true;
  if (event.type === "error") {
    const type = (event.data as { type?: string }).type;
    if (type === "unhandledrejection") return resolved.rejectedPromises;
    if (type === "network") return resolved.serverErrors || resolved.networkFailures;
    return resolved.uncaughtErrors;
  }
  if (event.type === "network") {
    const status = (event.data as { status?: number | null }).status;
    if (status == null) return resolved.networkFailures;
    if (status >= 500) return resolved.serverErrors;
    return false;
  }
  return false;
}

export function selectRollingWindow(
  events: AgentReplayEvent[],
  now: number,
  policy: RetentionPolicy = {},
): AgentReplayEvent[] {
  const resolved = resolveRetention(policy);
  const cutoff = now - resolved.rollingWindowMs;
  return events.filter((event) => event.timestamp >= cutoff);
}

export function selectIncidentWindow(
  events: AgentReplayEvent[],
  triggerAt: number,
  policy: RetentionPolicy = {},
): AgentReplayEvent[] {
  const resolved = resolveRetention(policy);
  return events.filter((event) =>
    event.timestamp >= triggerAt - resolved.preTriggerMs
    && event.timestamp <= triggerAt + resolved.postTriggerMs,
  );
}
