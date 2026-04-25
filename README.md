# @boe-ventures/agent-replay

[![npm version](https://img.shields.io/npm/v/@boe-ventures/agent-replay.svg)](https://www.npmjs.com/package/@boe-ventures/agent-replay)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![GitHub stars](https://img.shields.io/github/stars/Boe-Ventures/agent-replay.svg?style=social)](https://github.com/Boe-Ventures/agent-replay)

Local session recording for AI-assisted development. Gives coding agents the same observability into a running web app that a human developer gets — console errors, network requests, DOM state, React component tree — but structured, programmatic, and cheap.

## Why

AI coding agents today debug web apps by taking screenshots and feeding them to a vision model. That's expensive, slow, and lossy — you can't see network errors, console logs, or timing from a screenshot.

Session recording captures *everything* that happens inside the app. The agent gets structured data instead of pixels. The human developer gets a video-like replay for review.

## How it works

```
Agent writes code → Dev server reloads
                         ↓
            AgentReplayProvider captures:
            • DOM mutations (rrweb)
            • Console logs/errors
            • Network requests/responses
            • React component tree + state
            • User interactions (clicks, inputs, navigation)
                         ↓
            Events written to .agent-replay/
                         ↓
    ┌────────────────────┴────────────────────┐
    │                                         │
Agent reads structured events            Human views replay
(file, CLI, or MCP tool)                (npx agent-replay view)
```

## Quick start

```bash
npm install @boe-ventures/agent-replay
```

### React (Next.js, Vite, Remix)

```tsx
// app/layout.tsx
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";

export default function Layout({ children }) {
  return (
    <html>
      <body>
        <AgentReplayProvider>
          {children}
        </AgentReplayProvider>
      </body>
    </html>
  );
}
```

The provider auto-disables in production. Only records in development.

### Sidecar server (framework-agnostic)

```bash
# Run alongside your dev server
npx agent-replay dev

# Or with a specific port
npx agent-replay dev --port 3700
```

The sidecar receives events from the browser and writes them to `.agent-replay/`.

### Next.js optimized

```ts
// next.config.ts
import { withAgentReplay } from "@boe-ventures/agent-replay/next";

export default withAgentReplay(nextConfig);
```

Auto-injects the provider and API route. Zero config.

## Agent consumption

### Flat files (works with any agent)

```
.agent-replay/
  sessions/
    2026-04-25T1430Z/
      events.jsonl       # Full rrweb event stream
      console.jsonl      # Console logs/errors only
      network.jsonl      # Network requests/responses only
      errors.jsonl       # Errors only (highest signal)
      react-tree.json    # React component tree snapshot
      summary.md         # LLM-friendly text summary
  latest -> sessions/2026-04-25T1430Z/
```

Tell the agent: "Check `.agent-replay/latest/errors.jsonl` for recent errors" or "Read `.agent-replay/latest/summary.md` for a session overview."

Separate files so the agent can choose what to look at without exhausting context.

### CLI

```bash
# Get a text summary of the last session
npx agent-replay summary

# Get just errors
npx agent-replay errors

# Get network failures
npx agent-replay network --failures

# Watch for new events (streaming)
npx agent-replay watch
```

### MCP tool (future)

```json
{
  "tool": "agent_replay_session",
  "description": "Get the latest session recording events",
  "parameters": {
    "type": { "enum": ["summary", "errors", "network", "console", "all"] }
  }
}
```

## What gets captured

| Signal | Source | File | Agent value |
|--------|--------|------|-------------|
| DOM mutations | rrweb | events.jsonl | Full page reconstruction |
| Console logs | rrweb console plugin | console.jsonl | Errors, warnings, debug output |
| Network requests | rrweb network plugin | network.jsonl | API failures, slow responses |
| Errors | window.onerror + unhandledrejection | errors.jsonl | **Highest signal — read this first** |
| User interactions | rrweb | events.jsonl | Clicks, inputs, navigation |
| React tree | React DevTools hook | react-tree.json | Component state, props, context |
| Route changes | Next.js router / History API | console.jsonl | Navigation flow |

## Video replay

Recordings can be converted to video for human review:

```bash
# Generate video from a session
npx agent-replay video .agent-replay/latest

# Or decompose into frames (for vision model analysis via vidgrid)
npx agent-replay frames .agent-replay/latest --fps 1
```

## Design principles

- **Local-first.** No cloud, no accounts, no telemetry. Files on disk.
- **Dev-only.** Auto-disabled in production. Zero runtime cost when off.
- **Agent-first, human-friendly.** Structured data for agents, visual replay for humans.
- **Separate files per signal.** Agent picks what it needs. No context exhaustion.
- **Framework-agnostic core.** Next.js adapter for convenience. Works with Vite, Remix, CRA.
- **Composable with agent-browser.** Agent-browser gives the outside view (accessibility tree, element refs). Agent-replay gives the inside view (errors, network, state). Together they're complete.

## Interplay with agent-browser / Puppeteer

```
agent-browser ←→ Browser ←→ agent-replay
   (outside)                   (inside)

agent-browser: "Click button @e3"
               "Snapshot accessibility tree"
               "Get page title"

agent-replay:  "Console error at checkout.tsx:47"
               "POST /api/checkout returned 500"
               "React state: cart.items = []"
```

Agent-browser drives the browser. Agent-replay observes what happens inside. The agent uses both.

## License

MIT — [Boe Ventures](https://github.com/Boe-Ventures)
