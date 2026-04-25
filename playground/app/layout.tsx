import type { Metadata } from "next";
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";

export const metadata: Metadata = {
  title: "Agent Replay Playground",
  description: "Testing agent-replay session recording",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AgentReplayProvider>
          {children}
        </AgentReplayProvider>
      </body>
    </html>
  );
}
