import type { NextConfig } from "next";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { withAgentReplay } from "@boe-ventures/agent-replay/next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};

export default withAgentReplay(nextConfig);
