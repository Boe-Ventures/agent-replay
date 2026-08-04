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
      "Local flight recorder and true tab video capture for localhost development.",
    permissions: ["activeTab", "storage", "tabCapture", "offscreen"],
    host_permissions: [
      "http://localhost:*/*",
      "http://127.0.0.1:*/*",
    ],
    action: {
      default_title: "Agent Replay",
    },
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+R", mac: "MacCtrl+Shift+R" },
        description: "Open Agent Replay recording controls",
      },
    },
  },
});
