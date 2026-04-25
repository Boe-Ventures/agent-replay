# Competition & Landscape

_Last updated: 2026-04-25_

## Direct competitors / adjacent tools

### Replay.io
- **What:** Deterministic browser recording via custom Chromium fork. Time-travel debugging.
- **AI pivot (2025):** "Replay Simulation" re-runs recordings with modified code. "Replay Flow" instruments runtime for agent tool calling. Integrated with OpenHands.
- **Pricing:** Enterprise, cloud-focused
- **Our edge:** Local-first, lightweight (rrweb not custom browser), structured output for any agent, zero infrastructure
- **Links:** https://replay.io, https://blog.replay.io/learning-to-debug

### Kernel (onkernel.com)
- **What:** Browsers-as-a-service with video session replays
- **Tech:** True screen capture (not rrweb DOM reconstruction), open source Apache 2.0
- **Quote:** "rrweb can be lossy and often miss key transitions"
- **Our edge:** Local dev focus, structured data not just video, captures console/network/state
- **Links:** https://onkernel.com, https://blog.onkernel.com/p/introducing-browser-session-replays

### Agent Logger (agentlogger.com)
- **What:** Chrome extension bridging browser → terminal AI via MCP
- **Features:** Screenshots, console errors, network failures. AI can click/type/scroll back.
- **Our edge:** Continuous session recording, not snapshots. npm package for deep integration. Structured event logs.
- **Links:** https://agentlogger.com

### CarpetAI rrweb-recorder
- **What:** React component wrapping rrweb. `@carpetai/rrweb-recorder` + Next.js wrapper.
- **Cloud-focused:** Sends to CarpetAI backend. Excludes localhost by default (!!)
- **Our edge:** Built FOR localhost. Agent consumption, not analytics.
- **Links:** https://github.com/CarpetAI/carpetai-rrwebrecorder

### AgentStreamRecorder (agent-stream)
- **What:** Records AI agent SSE streams as JSONL. CLI replay at variable speed.
- **Scope:** Server-side only — records what the agent outputs, not what the browser does.
- **Our edge:** Browser-side recording. We capture what happened in the app.
- **Links:** pip install agent-event-stream

### AgentOps
- **What:** Observability for autonomous AI agents. Time-travel debugging, session waterfalls.
- **Scope:** LLM call tracing, tool invocation tracking. Agent-level, not browser-level.
- **Our edge:** Complementary — we're browser/app-level, they're agent-level.
- **Links:** https://agentops.ai

### Decipher AI (YC)
- **What:** Vision LMs analyze session recordings to find bugs and patterns.
- **Scope:** Production analytics. AI watches replays for you.
- **Our edge:** Local dev, agent consumption, not production analytics.

### PostHog / Amplitude / FullStory / Sentry
- **What:** Production session recording + analytics
- **Shared tech:** All use rrweb or rrweb-forks under the hood
- **Our edge:** Local-first (no cloud), dev-only, structured output for agents not dashboards

## The gap we fill

Nobody has built: **local-first session recording → structured events → agent consumption** as a dev tool.

Existing tools are either:
- Production analytics (PostHog, Amplitude, FullStory) — wrong context
- Cloud infrastructure (Replay.io, Kernel) — too heavy for local dev
- Agent observability (AgentOps, LangSmith) — records the agent, not the app
- Chrome extensions (Agent Logger) — snapshots, not continuous recording

We sit at the intersection: recording the app (like PostHog) but locally (like a dev tool) and outputting for agents (like no one else).

## Threads to watch

- [ ] Replay.io's OpenHands integration — are they moving toward local dev?
- [ ] Kernel open-sourcing more of their replay infra
- [ ] Agent Logger adding continuous recording
- [ ] PostHog / Sentry adding agent-facing APIs for their recordings
- [ ] Any new "dev tools for AI agents" startups
