import type { Metadata } from "next";
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BugBoard — Agent Replay fixture",
  description: "A deterministic incident fixture for Agent Replay",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidecarUrl = process.env.NEXT_PUBLIC_AGENT_REPLAY_URL ?? "http://127.0.0.1:3700/api/v1";
  return (
    <html lang="en">
      <body>
        <AgentReplayProvider enabled sidecarUrl={sidecarUrl} config={{ recordingMode: "session", privacyPreset: "safe", metadata: { fixture: "BugBoard" } }}>
          {children}
        </AgentReplayProvider>
      </body>
    </html>
  );
}
