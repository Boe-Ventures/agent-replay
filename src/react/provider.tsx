"use client";

import { useEffect, useRef } from "react";
import type { RecorderConfig, ConsoleEntry, NetworkEntry, ErrorEntry } from "../core/types.js";
import { startRecording, stopRecording } from "../core/recorder.js";
import { PostTransport } from "../core/transport.js";
import { getOrCreateSession } from "../core/session.js";

export interface AgentReplayProviderProps {
  children?: React.ReactNode;
  /** Enable recording. Default: true in development */
  enabled?: boolean;
  /**
   * Sidecar URL. Default behavior:
   * - In Next.js: `/api/__agent-replay` (uses the app's own API route, no sidecar needed)
   * - Otherwise: `http://localhost:3700` (requires sidecar: `npx agent-replay dev`)
   */
  sidecarUrl?: string;
  /** Capture console logs. Default: true */
  captureConsole?: boolean;
  /** Capture network requests. Default: true */
  captureNetwork?: boolean;
  /** Override session ID */
  sessionId?: string;
  /** Additional recorder config */
  config?: Partial<RecorderConfig>;
  /** Filter console entries before sending. Return false to skip, or mutate the entry. */
  filterConsole?: (entry: ConsoleEntry) => boolean;
  /** Filter network entries before sending. Return false to skip, or mutate the entry (e.g. truncate bodies). */
  filterNetwork?: (entry: NetworkEntry) => boolean;
  /** Filter error entries before sending. Return false to skip. */
  filterError?: (entry: ErrorEntry) => boolean;
  /** Max body size in bytes for network request/response bodies. Default 4096. Bodies exceeding this are truncated with ...[truncated] */
  maxBodySize?: number;
}

declare global {
  interface Window {
    __AGENT_REPLAY_ACTIVE__?: boolean;
    __NEXT_DATA__?: unknown;
  }
}

/** Detect if we're running inside a Next.js app */
function isNextJs(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.__NEXT_DATA__ !== "undefined";
}

/** Resolve the endpoint URL based on environment */
function resolveEndpointUrl(sidecarUrl: string | undefined): string {
  if (sidecarUrl) return sidecarUrl;
  if (isNextJs()) return "/api/__agent-replay";
  return "http://localhost:3700";
}

export function AgentReplayProvider({
  children,
  enabled,
  sidecarUrl,
  captureConsole = true,
  captureNetwork = true,
  sessionId,
  config = {},
  filterConsole,
  filterNetwork,
  filterError,
  maxBodySize,
}: AgentReplayProviderProps) {
  const initialized = useRef(false);

  // Auto-disable in production
  const isEnabled =
    enabled ?? process.env.NODE_ENV === "development";

  useEffect(() => {
    if (!isEnabled) return;
    if (initialized.current) return;
    initialized.current = true;

    const resolvedUrl = resolveEndpointUrl(sidecarUrl);
    const eventsUrl = `${resolvedUrl}/events`;
    const transport = new PostTransport(eventsUrl);
    const session = getOrCreateSession(sessionId);

    // Signal to chrome extension that provider is active
    window.__AGENT_REPLAY_ACTIVE__ = true;

    // Health check before starting — buffers silently if endpoint is down
    let recordingStarted = false;

    const initRecording = async () => {
      // Perform initial health check
      const healthy = await transport.checkHealth();

      // Start health monitoring for reconnection
      transport.startHealthMonitor();

      // Intercept first send to include session metadata
      const originalSend = transport.send.bind(transport);
      let metadataSent = false;
      transport.send = async (events) => {
        if (!metadataSent) {
          metadataSent = true;
          const body = JSON.stringify({
            events,
            sessionMetadata: session,
          });
          try {
            await fetch(eventsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            });
          } catch {
            // Silently buffer — transport handles retry
          }
          return;
        }
        return originalSend(events);
      };

      // Start recording regardless — transport buffers events when endpoint is down
      await startRecording(
        {
          ...config,
          captureConsole,
          captureNetwork,
          sessionId: session.id,
          sidecarUrl: resolvedUrl,
          ignoreNetworkPatterns: [
            ...(config.ignoreNetworkPatterns ?? []),
            resolvedUrl,
            "__agent-replay",
          ],
          filters: {
            ...config.filters,
            ...(filterConsole && { filterConsole }),
            ...(filterNetwork && { filterNetwork }),
            ...(filterError && { filterError }),
            ...(maxBodySize != null && { maxBodySize }),
          },
        },
        transport
      );
      recordingStarted = true;
    };

    void initRecording();

    return () => {
      window.__AGENT_REPLAY_ACTIVE__ = false;
      void transport.close();
      if (recordingStarted) {
        void stopRecording();
      }
      initialized.current = false;
    };
  }, [isEnabled, sidecarUrl, captureConsole, captureNetwork, sessionId, config]);

  return <>{children}</>;
}
