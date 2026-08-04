import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentReplayProvider enabled sidecarUrl={import.meta.env.VITE_AGENT_REPLAY_URL ?? "http://127.0.0.1:3700/api/v1"} config={{ recordingMode: "session", privacyPreset: "safe", metadata: { fixture: "CrashCafe" } }}>
      <App />
    </AgentReplayProvider>
  </StrictMode>
);
