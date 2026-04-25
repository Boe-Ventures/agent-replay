import type { SessionMetadata } from "./types.js";

let currentSession: SessionMetadata | null = null;
const HMR_SESSION_KEY = "__agent_replay_session_id__";

// Typed window access for HMR session persistence
function getWindowProp(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as Record<string, unknown>)[key] as string | undefined;
}

function setWindowProp(key: string, value: string): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)[key] = value;
}

function deleteWindowProp(key: string): void {
  if (typeof window === "undefined") return;
  delete (window as unknown as Record<string, unknown>)[key];
}

/** Generate a timestamp-based session ID */
function generateSessionId(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Get or create a session, preserving across HMR */
export function getOrCreateSession(
  overrideId?: string
): SessionMetadata {
  if (currentSession) return currentSession;

  // Check for existing HMR session
  const existingId = getWindowProp(HMR_SESSION_KEY);
  const id = overrideId ?? existingId ?? generateSessionId();

  // Store for HMR continuity
  setWindowProp(HMR_SESSION_KEY, id);

  currentSession = {
    id,
    startedAt: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport:
      typeof window !== "undefined"
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 0, height: 0 },
  };

  return currentSession;
}

/** End the current session */
export function endSession(): SessionMetadata | null {
  if (!currentSession) return null;
  const session = { ...currentSession };
  session.endedAt = new Date().toISOString();
  session.durationMs =
    new Date(session.endedAt).getTime() -
    new Date(session.startedAt).getTime();
  currentSession = null;

  // Clear HMR key on explicit end
  deleteWindowProp(HMR_SESSION_KEY);

  return session;
}

/** Get the current session without creating one */
export function getCurrentSession(): SessionMetadata | null {
  return currentSession;
}

/** Force a new session (e.g., on full page reload detection) */
export function rotateSession(): SessionMetadata {
  endSession();
  // Clear HMR key so we don't reuse
  deleteWindowProp(HMR_SESSION_KEY);
  return getOrCreateSession();
}
