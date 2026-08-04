# DESIGN.md — Agent Replay

## Problem

AI coding agents debug web apps by taking screenshots → feeding to vision model. This is:
- **Expensive** — vision model per screenshot
- **Slow** — screenshot → upload → inference → response
- **Lossy** — can't see console errors, network failures, timing, state

Session recording tools (PostHog, Amplitude, Sentry) already capture everything, but they're:
- Cloud-only (data leaves your machine)
- Production-focused (not designed for dev loops)
- Human-oriented (video replay, not structured data for agents)

## Solution

A local dev package that captures session recordings and outputs them in formats agents can consume directly.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                            │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  AgentReplayProvider (React)                 │    │
│  │  ┌──────────┐ ┌────────┐ ┌───────────────┐  │    │
│  │  │ rrweb    │ │console │ │ network       │  │    │
│  │  │ recorder │ │plugin  │ │ plugin        │  │    │
│  │  └────┬─────┘ └───┬────┘ └──────┬────────┘  │    │
│  │       └────────────┴─────────────┘           │    │
│  │                    │                         │    │
│  │            Event buffer                      │    │
│  └────────────────────┼─────────────────────────┘    │
│                       │                              │
│                       ▼                              │
│            ┌──────────────────┐                      │
│            │  Transport layer │                      │
│            │  (POST or WS)   │                      │
│            └────────┬─────────┘                      │
└─────────────────────┼───────────────────────────────┘
                      │
                      ▼
        ┌─────────────────────────┐
        │  Receiver               │
        │  Option A: API route    │  ← Next.js /api/__agent-replay
        │  Option B: Sidecar      │  ← agent-replay dev (port 3700)
        │  Option C: Both         │
        └────────────┬────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │  .agent-replay/         │  ← gitignored, project root
        │   sessions/             │
        │     <timestamp>/        │
        │       events.jsonl      │  full rrweb stream
        │       console.jsonl     │  console logs/errors
        │       network.jsonl     │  XHR/fetch requests
        │       errors.jsonl      │  errors only
        │       react-tree.json   │  component tree snapshot
        │       summary.md        │  LLM-friendly text summary
        │   latest -> <timestamp> │
        └─────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
    Agent reads files     Human views replay
    (or CLI / MCP)        (npx agent-replay view)
```

## Package structure

```
@boe-ventures/agent-replay
├── src/
│   ├── core/
│   │   ├── recorder.ts       # Core recording engine (rrweb + plugins)
│   │   ├── transport.ts       # Event transport (POST, WS, or direct file write)
│   │   ├── session.ts         # Session management (start, stop, rotate)
│   │   ├── summarizer.ts      # Compress events → LLM-friendly text
│   │   └── types.ts           # Shared types
│   ├── react/
│   │   ├── provider.tsx       # <AgentReplayProvider> React component
│   │   └── index.ts
│   ├── next/
│   │   ├── plugin.ts          # withAgentReplay(nextConfig) 
│   │   ├── api-route.ts       # API route handler for receiving events
│   │   └── index.ts
│   ├── server/
│   │   ├── sidecar.ts         # Standalone sidecar server (Vite-style)
│   │   ├── writer.ts          # Write events to .agent-replay/
│   │   └── index.ts
│   ├── cli/
│   │   ├── index.ts           # CLI entry (dev, summary, errors, watch, video, frames)
│   │   └── commands/
│   └── index.ts               # Core exports
├── bin/
│   └── agent-replay.ts        # CLI binary
└── package.json
```

## Transport decisions

### Option A: Next.js API route
- Pro: Zero extra process, lives inside the app
- Pro: Shares the app's auth/middleware context
- Con: Framework-coupled
- Con: Must be careful not to affect app behavior

### Option B: Sidecar server
- Pro: Framework-agnostic
- Pro: Can run on a stable port (3700 default, configurable)
- Pro: Agent can interact with it directly (query events, stream, etc.)
- Con: Extra process to manage
- Con: Need CORS handling for browser → sidecar

### Option C: Both (chosen approach)
- Core transport is agnostic — just needs a URL to POST to
- Next.js adapter provides the API route
- Sidecar provides a standalone receiver
- Browser component doesn't care which is listening

## Sidecar server

- Runs on port 3700 by default (avoids 3000, 3001, 4000, 5000, 5173, 8000, 8080)
- Can be started by human (`npx agent-replay dev`) or by agent (spawns it as background process)
- Built with Hono or bare http — minimal dependencies
- Endpoints:
  - `POST /events` — receive batched events
  - `GET /sessions` — list recorded sessions
  - `GET /sessions/latest` — get latest session
  - `GET /sessions/:id/summary` — get LLM-friendly summary
  - `GET /sessions/:id/errors` — get errors only
  - `GET /sessions/:id/network` — get network log
  - `WS /stream` — real-time event stream

## File output strategy

Separate files per signal type. Rationale:
- Agent reads only what it needs (errors first, then network if needed, then full events as last resort)
- Avoids context window exhaustion
- Easy for any tool to consume (cat, jq, read)

### summary.md format
```markdown
# Session 2026-04-25T14:30:00Z (12.3s)

## Errors (2)
- [0.5s] TypeError: Cannot read properties of undefined (reading 'map') at CheckoutPage.tsx:47
- [3.2s] Unhandled promise rejection: POST /api/checkout returned 500

## Network (5 requests, 1 failure)
- [0.1s] GET /api/user → 200 (45ms)
- [0.3s] GET /api/cart → 200 (120ms)
- [1.1s] POST /api/checkout → 500 (340ms) ← FAILED
- [2.0s] GET /api/products → 200 (89ms)
- [4.5s] GET /_next/image?url=... → 200 (12ms)

## Console (8 entries)
- [0.1s] log: "App mounted"
- [0.4s] warn: "Deprecated prop `size` on Button"
- [0.5s] error: "TypeError: Cannot read properties of undefined (reading 'map')"
- [3.2s] error: "Unhandled promise rejection: ..."

## Interactions (4)
- [0.8s] Click: button "Add to cart"
- [1.0s] Click: link "Checkout"
- [2.5s] Input: input[name="email"] → "test@example.com"
- [3.0s] Click: button "Place order"

## Route changes
- [0.0s] / → /products
- [1.0s] /products → /checkout
```

## React component tree capture

Use React DevTools global hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) to traverse the fiber tree and extract:
- Component names and hierarchy
- Props (serializable subset)
- State values
- Context values

Written to `react-tree.json` on session end or periodically. Expensive to serialize, so:
- Snapshot on demand (when errors occur, or on interval)
- Not continuous like DOM recording
- Agent reads this only when debugging state-related issues

## Video generation

Two paths:
1. **rrweb → video**: Use `rrweb-player` in a headless browser to replay events and capture as video. Works offline, no extra dependencies at record time.
2. **Puppeteer screen recording**: If the agent is already driving Puppeteer/agent-browser, it can record the screen directly. Higher fidelity but requires the agent to opt in.

Video is Phase 2. Phase 1 focuses on structured data.

## Relationship with agent-browser

Agent-browser provides the **control plane** — navigating, clicking, filling forms, reading the accessibility tree.

Agent-replay provides the **observation plane** — what happened inside the app as a result of those actions.

They don't depend on each other but are designed to be used together:
```
Agent loop:
  1. agent-browser open http://localhost:3000/checkout
  2. agent-browser fill @email "test@example.com"
  3. agent-browser click @submit
  4. Read .agent-replay/latest/errors.jsonl → "POST /api/checkout returned 500"
  5. Read .agent-replay/latest/network.jsonl → see the 500 response body
  6. Agent knows the bug is in the checkout API, not the UI
```

## Chrome Extension

A Chrome extension provides the zero-config entry point — no package install, no provider component, no code changes.

### How it works
1. Extension detects `localhost:*` pages
2. Content script injects rrweb + console/network recording
3. Events stream to the sidecar server (if running) or buffer locally in extension storage
4. Extension popup shows active recording status, recent sessions
5. Can work standalone (saves to extension storage) or paired with sidecar (saves to `.agent-replay/`)

### Architecture
```
┌──────────────────────────────────────────────┐
│  Chrome Extension                            │
│  ┌────────────┐  ┌─────────────┐             │
│  │ Background  │  │ Popup UI    │             │
│  │ Worker      │  │ (status,    │             │
│  │ (session    │  │  sessions,  │             │
│  │  mgmt,      │  │  settings)  │             │
│  │  transport) │  └─────────────┘             │
│  └──────┬──────┘                              │
│         │                                     │
│  ┌──────┴──────┐                              │
│  │ Content     │  ← injected on localhost:*   │
│  │ Script      │                              │
│  │ (rrweb +    │                              │
│  │  plugins)   │                              │
│  └──────┬──────┘                              │
└─────────┼────────────────────────────────────┘
          │
          ▼
   ┌──────────────┐
   │ Sidecar      │  ← if running
   │ (port 3700)  │
   └──────────────┘
          │
          ▼
   .agent-replay/
```

### Extension + npm package synergy
- Extension = zero-config, works on any localhost app, captures DOM + console + network
- npm package (React provider) = deep integration, captures React tree + state, tighter session control
- Both write to the same `.agent-replay/` directory via the sidecar
- Agent reads from one place regardless of which captured it
- Extension can detect when the provider is already active and defer to it (avoid double recording)

### Tech stack
- WXT (same as Homi extension)
- Content script: rrweb injection
- Background worker: session management, sidecar communication
- Popup: React, shows recording status + recent sessions

## Competitive landscape

### Direct competitors / adjacent tools

**Replay.io** — The closest to what we're building, but different angle.
- Deterministic browser recording (custom Chromium fork)
- Time-travel debugging — can inspect variables at any point in recorded session
- Recently pivoted to AI agent tooling: "Replay Simulation" re-runs recordings with modified code
- "Replay Flow" instruments the runtime for agent tool calling
- Integrated with OpenHands AI agent
- Heavy (custom browser), cloud-focused, enterprise pricing
- **Our differentiation**: Local-first, lightweight (rrweb not custom browser), structured output for any agent, zero infrastructure

**Kernel (onkernel.com)** — Browsers-as-a-service with session replays.
- True video recordings (not rrweb DOM reconstruction) of cloud-hosted browsers
- API: start/stop/list/download replays programmatically
- Open source under Apache 2.0
- Explicitly rejected rrweb: "lossy and often miss key transitions"
- **Our differentiation**: Local dev focus (not cloud browsers), structured data not just video, captures console/network/state not just pixels

**Agent Logger (agentlogger.com)** — Chrome extension bridging browser → terminal AI.
- Captures screenshots, console errors, network failures
- Streams to AI coding agent via MCP
- AI can click, type, scroll back via the extension
- **Our differentiation**: Session recording (continuous), not just snapshots. Structured event logs, not just errors. npm package for deep integration.

**CarpetAI rrweb-recorder** — React component wrapping rrweb for analytics.
- `@carpetai/rrweb-recorder` + `@carpetai/rrweb-recorder-nextjs`
- Cloud-focused (sends to CarpetAI backend)
- Excludes localhost by default (!)
- **Our differentiation**: Built FOR localhost. Agent consumption, not analytics.

**AgentStreamRecorder (agent-stream)** — Records AI agent SSE streams as JSONL.
- Wraps async generators, tees each SSE event to file
- CLI replay at variable speed
- Server-side only (records the agent's output, not the browser)
- **Our differentiation**: Browser-side recording. We capture what happened in the app, they capture what the agent said.

**AgentOps** — Observability for autonomous AI agents.
- Time-travel debugging for agent runs
- Session waterfall views
- LLM call tracing
- **Our differentiation**: We're browser/app-level, they're agent-level. Complementary, not competing.

**Decipher AI (YC)** — AI that watches session replays for you.
- Vision LMs analyze session recordings to find bugs and patterns
- Production analytics focused
- **Our differentiation**: Local dev, agent consumption, not production analytics.

### The gap we fill
Nobody has built: **local-first session recording → structured events → agent consumption** as a dev tool.

Existing tools are either:
- Production analytics (PostHog, Amplitude, FullStory) — wrong context
- Cloud infrastructure (Replay.io, Kernel) — too heavy for local dev
- Agent observability (AgentOps, LangSmith) — records the agent, not the app
- Chrome extensions (Agent Logger) — snapshots, not continuous recording

We sit at the intersection: recording the app (like PostHog) but locally (like a dev tool) and outputting for agents (like no one else).

## Open questions

- **Session boundaries**: When does a session start/stop? Options: page load, explicit start/stop, configurable timeout, HMR-aware (continue session across hot reloads, new session on full reload).
- **Event batching**: Buffer events and POST every N seconds, or stream via WebSocket? Start with batched POST, add WS for real-time streaming.
- **Max session size**: Cap at N MB or N minutes to prevent disk bloat. Configurable, sensible defaults.
- **Hot reload handling**: Next.js HMR causes a partial page reload. Default: continue current session. Full reload: new session.
- **Extension ↔ Provider coordination**: How does the extension know the npm package is already recording? Use a global flag (`window.__AGENT_REPLAY_ACTIVE__`) that the provider sets and the extension checks.
- **Mobile (React Native)**: Possible via a custom rrweb-like recorder for RN. Big opportunity, Phase 3.
- **Sidecar auto-discovery**: Browser component needs to find the sidecar. Default port 3700, configurable. Provider can also accept a URL prop.

## Phases

### Phase 1: Core recording + agent consumption
- React provider component (rrweb + console + network plugins)
- Sidecar server (receives events, writes to `.agent-replay/`)
- Separate files per signal type
- Summary generation (events → LLM-friendly text)
- CLI: `agent-replay dev`, `agent-replay summary`, `agent-replay errors`
- Next.js adapter (`withAgentReplay`)

### Phase 2: Chrome extension + viewer
- Chrome extension (WXT, content script injection, sidecar communication)
- Local viewer UI (`npx agent-replay view` or extension popup)
- Video generation from rrweb events
- Frame extraction for vidgrid/vision model analysis

### Phase 3: Deep integrations
- React tree + state capture
- MCP tool for real-time agent querying
- Mobile (React Native) support
- Integration with agent-browser (coordinated recording + control)
- Streaming event consumption (WS-based, for live debugging loops)
