import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentReplayProvider sidecarUrl="http://localhost:3700">
      <App />
    </AgentReplayProvider>
  </StrictMode>
);
