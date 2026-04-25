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
 * Wrap your Next.js config to proxy agent-replay requests to the sidecar.
 *
 * ```ts
 * // next.config.ts
 * import { withAgentReplay } from "@boe-ventures/agent-replay/next";
 * export default withAgentReplay(nextConfig);
 * ```
 */
export function withAgentReplay(
  nextConfig: NextConfig = {},
  options: { sidecarPort?: number } = {}
): NextConfig {
  const port = options.sidecarPort ?? DEFAULT_SIDECAR_PORT;

  // Only modify in development
  if (process.env.NODE_ENV !== "development") {
    return nextConfig;
  }

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
