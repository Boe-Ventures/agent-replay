import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  dev: {
    server: {
      port: 3301,
    },
  },
  manifest: {
    name: "Agent Replay",
    description:
      "Zero-config session recording for localhost — captures DOM, console, network for AI coding agents.",
    permissions: ["activeTab", "storage"],
    host_permissions: [
      "http://localhost:*/*",
      "http://127.0.0.1:*/*",
    ],
  },
});
