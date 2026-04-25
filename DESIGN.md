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

## Open questions

- **Session boundaries**: When does a session start/stop? Options: page load, explicit start/stop, configurable timeout.
- **Event batching**: Buffer events and POST every N seconds, or stream via WebSocket? Batching is simpler, streaming is lower latency.
- **Max session size**: Cap at N MB or N minutes to prevent disk bloat?
- **Hot reload handling**: Next.js HMR causes a partial page reload. Should that start a new session or continue the current one?
- **Mobile (React Native)**: Possible via a custom rrweb-like recorder for RN. Big opportunity, Phase 3.
