import type { NextConfig } from "next";
import { withAgentReplay } from "@boe-ventures/agent-replay/next";

const nextConfig: NextConfig = {};

export default withAgentReplay(nextConfig);
