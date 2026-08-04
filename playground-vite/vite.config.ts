import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "crash-cafe-deterministic-api",
      configureServer(server) {
        server.middlewares.use("/mock-api/sold-out.json", (_request, response) => {
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Item is sold out" }));
        });
      },
    },
  ],
  server: {
    port: 3801,
    proxy: {
      "/__agent-replay": {
        target: "http://localhost:3700",
        changeOrigin: true,
      },
    },
  },
});
