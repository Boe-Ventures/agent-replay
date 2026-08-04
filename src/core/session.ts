import type { AgentReplayEvent, AgentReplayEventData, AgentReplayEventType, PageMetadata, RecordingMode, SessionMetadata } from "./types.js";

const STORAGE_KEY = "__agent_replay_session_v1__";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface PersistedSession {
  metadata: SessionMetadata;
  mode: RecordingMode;
  lastSeenAt: number;
  sequence: number;
}

let currentSession: PersistedSession | null = null;
let currentPage: PageMetadata | null = null;

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function readPersisted(): PersistedSession | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as PersistedSession | null;
  } catch {
    return null;
  }
}

function persist(value: PersistedSession | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be disabled. In-memory continuity still works.
  }
}

function createSession(mode: RecordingMode, overrideId?: string): PersistedSession {
  const now = Date.now();
  const metadata: SessionMetadata = {
    id: overrideId ?? randomUuid(),
    schemaVersion: 1,
    startedAt: new Date(now).toISOString(),
    status: "active",
    mode,
    privacyPreset: "safe",
    url: typeof location === "undefined" ? "" : location.href,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    viewport: typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  };
  return { metadata, mode, lastSeenAt: now, sequence: 0 };
}

export function getOrCreateSession(
  overrideId?: string,
  mode: RecordingMode = "rolling",
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SessionMetadata {
  if (currentSession && (!overrideId || currentSession.metadata.id === overrideId) && currentSession.mode === mode) {
    currentSession.lastSeenAt = Date.now();
    persist(currentSession);
    return currentSession.metadata;
  }

  const saved = readPersisted();
  const now = Date.now();
  const reusable = saved
    && now - saved.lastSeenAt <= timeoutMs
    && saved.mode === mode
    && (!overrideId || saved.metadata.id === overrideId);

  currentSession = reusable ? saved : createSession(mode, overrideId);
  currentSession.lastSeenAt = now;
  currentSession.metadata.url = typeof location === "undefined" ? currentSession.metadata.url : location.href;
  currentSession.metadata.mode = mode;
  persist(currentSession);
  return currentSession.metadata;
}

export function getOrCreatePage(): PageMetadata {
  if (currentPage) return currentPage;
  currentPage = {
    id: randomUuid(),
    url: typeof location === "undefined" ? "" : location.href,
    title: typeof document === "undefined" ? undefined : document.title,
    startedAt: new Date().toISOString(),
  };
  return currentPage;
}

export function createEvent(
  type: AgentReplayEventType,
  data: AgentReplayEventData,
): AgentReplayEvent {
  const activeMode = currentSession?.mode ?? readPersisted()?.mode ?? "rolling";
  const session = getOrCreateSession(undefined, activeMode);
  const page = getOrCreatePage();
  const timestamp = Date.now();
  const startedAt = new Date(session.startedAt).getTime();
  const active = currentSession ?? createSession(session.mode ?? "rolling", session.id);
  currentSession = active;
  const normalizedData = data && typeof data === "object"
    ? { ...data, timestamp, offsetMs: Math.max(0, timestamp - startedAt) }
    : data;
  const event: AgentReplayEvent = {
    id: randomUuid(),
    type,
    sequence: active.sequence++,
    timestamp,
    offsetMs: Math.max(0, timestamp - startedAt),
    sessionId: session.id,
    pageId: page.id,
    data: normalizedData as AgentReplayEventData,
  };
  active.lastSeenAt = timestamp;
  persist(active);
  return event;
}

export function endSession(): SessionMetadata | null {
  if (!currentSession) {
    const saved = readPersisted();
    if (!saved) return null;
    currentSession = saved;
  }
  const endedAt = new Date().toISOString();
  const metadata: SessionMetadata = {
    ...currentSession.metadata,
    endedAt,
    status: "closed",
    durationMs: new Date(endedAt).getTime() - new Date(currentSession.metadata.startedAt).getTime(),
  };
  currentSession = null;
  currentPage = null;
  persist(null);
  return metadata;
}

export function getCurrentSession(): SessionMetadata | null {
  return currentSession?.metadata ?? readPersisted()?.metadata ?? null;
}

export function getCurrentPage(): PageMetadata | null {
  return currentPage;
}

export function rotateSession(mode?: RecordingMode): SessionMetadata {
  const previousMode = currentSession?.mode ?? readPersisted()?.mode ?? "rolling";
  endSession();
  return getOrCreateSession(undefined, mode ?? previousMode);
}

export function touchSession(): void {
  if (!currentSession) return;
  currentSession.lastSeenAt = Date.now();
  persist(currentSession);
}
