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
  /** Sidecar URL. Default: http://localhost:3700 */
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
  }
}

export function AgentReplayProvider({
  children,
  enabled,
  sidecarUrl = "http://localhost:3700",
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

    const transport = new PostTransport(`${sidecarUrl}/events`);
    const session = getOrCreateSession(sessionId);

    // Signal to chrome extension that provider is active
    window.__AGENT_REPLAY_ACTIVE__ = true;

    // Send session metadata with first batch
    const originalSend = transport.send.bind(transport);
    let metadataSent = false;
    transport.send = async (events) => {
      if (!metadataSent) {
        metadataSent = true;
        // Wrap to include metadata
        const body = JSON.stringify({
          events,
          sessionMetadata: session,
        });
        await fetch(`${sidecarUrl}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        return;
      }
      return originalSend(events);
    };

    void startRecording(
      {
        ...config,
        captureConsole,
        captureNetwork,
        sessionId: session.id,
        sidecarUrl,
        // Don't intercept requests to the sidecar itself
        ignoreNetworkPatterns: [
          ...(config.ignoreNetworkPatterns ?? []),
          sidecarUrl,
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

    return () => {
      window.__AGENT_REPLAY_ACTIVE__ = false;
      void stopRecording();
      initialized.current = false;
    };
  }, [isEnabled, sidecarUrl, captureConsole, captureNetwork, sessionId, config]);

  return <>{children}</>;
}
