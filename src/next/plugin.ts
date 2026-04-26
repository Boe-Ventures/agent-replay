interface NextConfig {
  rewrites?: () => Promise<
    | Array<{ source: string; destination: string }>
    | {
        beforeFiles?: Array<{ source: string; destination: string }>;
        afterFiles?: Array<{ source: string; destination: string }>;
        fallback?: Array<{ source: string; destination: string }>;
      }
  >;
  [key: string]: unknown;
}

const DEFAULT_SIDECAR_PORT = 3700;

/**
 * Wrap your Next.js config to enable agent-replay.
 *
 * **Recommended setup (no sidecar needed):**
 *
 * 1. Add the API route files:
 *
 * `app/api/__agent-replay/events/route.ts`:
 * ```ts
 * export { POST } from "@boe-ventures/agent-replay/next";
 * ```
 *
 * `app/api/__agent-replay/health/route.ts`:
 * ```ts
 * export { GET } from "@boe-ventures/agent-replay/next";
 * ```
 *
 * 2. Add the provider to your layout — it auto-detects Next.js and uses `/api/__agent-replay`.
 *
 * **Alternative: sidecar mode**
 *
 * If you prefer the standalone sidecar (`npx agent-replay dev`), pass `{ mode: "sidecar" }`:
 * ```ts
 * export default withAgentReplay(nextConfig, { mode: "sidecar" });
 * ```
 * This adds rewrites to proxy `/__agent-replay/*` to the sidecar.
 *
 * @param nextConfig - Your existing Next.js configuration
 * @param options - Plugin options
 */
export function withAgentReplay(
  nextConfig: NextConfig = {},
  options: {
    /** @deprecated Use mode: "sidecar" instead */
    sidecarPort?: number;
    /** "api-route" (default, no sidecar) or "sidecar" (proxy to standalone sidecar) */
    mode?: "api-route" | "sidecar";
  } = {}
): NextConfig {
  const mode = options.mode ?? (options.sidecarPort ? "sidecar" : "api-route");

  // Only modify in development
  if (process.env.NODE_ENV !== "development") {
    return nextConfig;
  }

  // In api-route mode, no config changes needed — just pass through
  if (mode === "api-route") {
    return nextConfig;
  }

  // Sidecar mode: add rewrites to proxy requests
  const port = options.sidecarPort ?? DEFAULT_SIDECAR_PORT;
  const originalRewrites = nextConfig.rewrites;

  return {
    ...nextConfig,
    rewrites: async () => {
      const agentReplayRewrites = [
        {
          source: "/__agent-replay/:path*",
          destination: `http://localhost:${port}/:path*`,
        },
      ];

      if (!originalRewrites) {
        return agentReplayRewrites;
      }

      const existing = await originalRewrites();

      if (Array.isArray(existing)) {
        return [...existing, ...agentReplayRewrites];
      }

      return {
        ...existing,
        beforeFiles: [
          ...(existing.beforeFiles ?? []),
          ...agentReplayRewrites,
        ],
      };
    },
  };
}
