import { useState, useEffect } from "react";

interface Recording {
  sessionId: string;
  url: string;
  eventCount: number;
  sidecarConnected: boolean;
  startedAt: number;
}

interface Status {
  recording: Recording | null;
  sidecarAvailable: boolean;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function fetchStatus() {
      chrome.tabs.query(
        { active: true, currentWindow: true },
        (tabs) => {
          const tabId = tabs[0]?.id;
          if (tabId == null) {
            setError("No active tab");
            return;
          }
          chrome.tabs.sendMessage(
            tabId,
            { type: "PING" },
            () => {
              // Just to establish connection, ignore response
              chrome.runtime.lastError; // Clear error
            }
          );
          chrome.runtime.sendMessage(
            { type: "GET_STATUS", tabId },
            (response) => {
              if (chrome.runtime.lastError) {
                setError("Extension not connected");
                return;
              }
              setStatus(response);
            }
          );
        }
      );
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const rec = status?.recording;
  const isLocalhost =
    rec?.url?.startsWith("http://localhost") ||
    rec?.url?.startsWith("http://127.0.0.1");

  return (
    <div className="popup">
      <div className="header">
        <h1>⚡ Agent Replay</h1>
        <span className="version">v0.1.0</span>
      </div>

      <div className="status-grid">
        {/* Recording status */}
        <div className="status-row">
          <span className="label">Recording</span>
          <span className={`badge ${rec ? "badge-active" : "badge-inactive"}`}>
            {rec ? "● Active" : "○ Inactive"}
          </span>
        </div>

        {/* Sidecar connection */}
        <div className="status-row">
          <span className="label">Sidecar</span>
          <span
            className={`badge ${status?.sidecarAvailable ? "badge-connected" : "badge-disconnected"}`}
          >
            {status?.sidecarAvailable ? "● Connected" : "○ Disconnected"}
          </span>
        </div>

        {rec && (
          <>
            {/* Session ID */}
            <div className="status-row">
              <span className="label">Session</span>
              <span className="value mono">
                {rec.sessionId.slice(0, 19)}
              </span>
            </div>

            {/* Events captured */}
            <div className="status-row">
              <span className="label">Events</span>
              <span className="value">
                {rec.eventCount.toLocaleString()}
              </span>
            </div>

            {/* Duration */}
            <div className="status-row">
              <span className="label">Duration</span>
              <span className="value">
                {formatDuration(Date.now() - rec.startedAt)}
              </span>
            </div>

            {/* URL */}
            <div className="status-row">
              <span className="label">URL</span>
              <span className="value url" title={rec.url}>
                {rec.url.length > 40
                  ? rec.url.slice(0, 37) + "…"
                  : rec.url}
              </span>
            </div>
          </>
        )}
      </div>

      {!rec && !error && (
        <div className="hint">
          {isLocalhost === false ? (
            <p>Navigate to a <code>localhost</code> page to start recording.</p>
          ) : (
            <p>Waiting for page to load…</p>
          )}
        </div>
      )}

      {!status?.sidecarAvailable && (
        <div className="hint warning">
          <p>
            Sidecar not running. Start it with:
            <br />
            <code>npx agent-replay dev</code>
          </p>
        </div>
      )}

      {error && (
        <div className="hint error">
          <p>{error}</p>
        </div>
      )}

      <div className="footer">
        <a
          href="http://localhost:3700/sessions"
          target="_blank"
          rel="noopener"
          className="link"
        >
          Sidecar API →
        </a>
      </div>
    </div>
  );
}
