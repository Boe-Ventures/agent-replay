# Agent Replay

[![npm version](https://img.shields.io/npm/v/@boe-ventures/agent-replay.svg)](https://www.npmjs.com/package/@boe-ventures/agent-replay)
[![CI](https://github.com/Boe-Ventures/agent-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/Boe-Ventures/agent-replay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> Capture once. Debug with any agent. Replay for humans. Export as video.

Agent Replay is a local, model-agnostic flight recorder for web development. It passively remembers a bounded history of DOM changes, console output, errors, requests, WebSockets, routes, interactions, performance, and markers—then turns that history into:

- deterministic evidence a coding agent or local model can inspect;
- a synchronized replay a human can browse;
- a portable `.areplay` capsule, fix receipt, or video.

**The browser remembers what your coding agent missed.**

v0.3.0 is a public beta of the artifact contract. There is no account, cloud backend, production analytics service, proprietary AI dependency, or new browser controller.

## Install

```bash
npm install @boe-ventures/agent-replay
npx agent-replay dev
```

The local receiver and viewer run at `http://127.0.0.1:3700`. It binds to loopback, writes to `.agent-replay/`, and uses safe privacy defaults.

### React

```tsx
import { AgentReplayProvider } from "@boe-ventures/agent-replay/react";

export function App() {
  return (
    <AgentReplayProvider>
      <YourApp />
    </AgentReplayProvider>
  );
}
```

The provider auto-disables outside development unless `enabled` is explicitly set.

### Next.js

Next.js setup is deliberately explicit: one provider component and one catch-all development route.

```tsx
// app/providers.tsx
"use client";
export { AgentReplayProvider as Providers } from "@boe-ventures/agent-replay/react";
```

```ts
// app/api/__agent-replay/[...agentReplay]/route.ts
export { GET, POST } from "@boe-ventures/agent-replay/next";
```

Wrap the body in `<Providers>` in the root layout. The provider sends to the local catch-all route. For a standalone sidecar instead, configure `withAgentReplay(nextConfig, { mode: "sidecar" })`.

### Framework-agnostic Chrome extension

The release extension records localhost applications without changing application code. Structured instrumentation runs in the page's main JavaScript world while an isolated relay owns extension transport. The background worker keeps session identity across navigations.

It also includes **Record polished demo**, a user-initiated Chrome `tabCapture` path that streams true tab pixels into a local WebM across navigation. Tab audio is opt-in beta. The source ZIP is distributed through GitHub Releases in v0.3.

## Default recording model

Rolling mode is the default:

- five minutes of unpinned history;
- rrweb checkpoints every 30 seconds;
- incident triggers for uncaught errors, rejected promises, 5xx responses, network failures, and manual incident markers;
- ordinary 4xx responses do not trigger incidents;
- pinned recordings are retained for seven days, up to 20 by default.

Use `recordingMode: "session"` for deliberate demos and complete end-to-end recordings, or `"demo"` with the demo privacy preset.

Every normalized event has an event UUID, monotonic sequence, stable session ID, page ID, timestamp, and session offset. Writes are always session-addressed; concurrent tabs cannot switch a shared destination.

## Privacy presets

Redaction runs before transport and again at ingestion. Authorization, cookies, passwords, credentials, secrets, tokens, API keys, session identifiers, and configured field names are removed regardless of preset.

| Preset | Form values | Headers | Same-origin text bodies |
| --- | --- | --- | --- |
| `safe` (default) | masked | redacted | up to 16 KiB |
| `diagnostic` | ordinary non-secret values | redacted | up to 64 KiB |
| `demo` | visible non-secret interactions | none stored | none stored |

The receiver enforces allowed origins, UUID-only path components, batch and media limits, session/disk quotas, atomic metadata writes, and write-only cross-origin ingestion. Binding outside loopback requires an explicit token.

## Agent workflow

```bash
agent-replay sessions
agent-replay inspect --budget 4000
agent-replay timeline --around 18400
agent-replay errors
agent-replay network --failures
agent-replay watch
```

`inspect --budget` ranks evidence deterministically. It does not invoke an AI model. Flat files and the CLI remain the canonical integration for Codex, Claude Code, OpenHands, Continue, Ollama, and other shell-capable agents.

The optional MCP server intentionally exposes only:

- `list_sessions`
- `inspect_session`
- `get_timeline`
- `compare_sessions`
- `export_session`

```bash
agent-replay mcp
```

Copy-ready agent integrations live in [docs/integrations](./docs/integrations/README.md).

## Viewer

```bash
agent-replay view
```

The local React/Vite viewer includes session and incident browsing, live tailing, rrweb replay, console/network/WebSocket/error/route/interaction/marker lanes, search, signal filters, event detail, privacy state, clip in/out points, and timestamp deep links.

Every packed capsule includes a standalone `report.html` that works locally without a cloud service.

## Portable capsules

Schema v1 stores a manifest, normalized timeline, per-signal JSONL, summary, markers, media, exports, and the compatibility `events.jsonl` rrweb stream.

```bash
agent-replay pack [session-id]
agent-replay pack [session-id] --no-media
```

This writes a ZIP-compatible `.areplay` archive. v0.2 directories are read non-destructively and migrate only when requested:

```bash
agent-replay migrate                 # list legacy sessions
agent-replay migrate <legacy-id>
agent-replay migrate --all
```

## Fix receipts

```bash
agent-replay compare <before> <after>
agent-replay receipt <before> <after> --video
```

Comparison aligns matching markers first, Playwright steps second, and route/action sequences third. It reports resolved and new errors, changed network outcomes, route completion, timing deltas, and final reconstructed state in JSON, Markdown, and HTML.

## Three video paths

### Retrospective replay export

```bash
agent-replay export <session> --format mp4 --preset launch
agent-replay export <session> --format gif
agent-replay export <session> --format poster
agent-replay export <session> --format storyboard
```

Agent Replay opens the local viewer in Playwright, replays stored rrweb events, and records with Playwright screencasting.

### Playwright verification receipts

```ts
import { test, expect } from "@boe-ventures/agent-replay/playwright";

test("checkout", async ({ page, agentReplay }) => {
  await agentReplay.step("Open checkout", () => page.goto("/checkout"));
  await agentReplay.step("Place order", () => page.getByRole("button", { name: "Place order" }).click());
  await expect(page.getByText("Order confirmed")).toBeVisible();
});
```

Steps become chapters and a structured trace is stored beside the WebM.

### Faithful Chrome tab recording

Use **Record polished demo** in the extension. Chrome's user-initiated tab stream survives page navigation and is written in chunks through an MV3 offscreen document.

```bash
agent-replay export <session> --source tab --format mp4 --preset vertical --audio
```

WebM remains the source. Detected system FFmpeg creates H.264 MP4, GIF, posters, storyboards, and padded debug/16:9/square/vertical layouts. Run `agent-replay doctor` for exact Chrome, Playwright, FFmpeg, and ffprobe status.

## Limitations

rrweb reconstructs the DOM; it does not record pixels. Canvas, WebGL, maps, video, animation-heavy UI, and cross-origin embeds may be incomplete. Export warns when these signals appear and recommends true tab capture.

v0.3 does not include microphone narration, cloud storage, a hosted backend, production analytics, React-internal snapshots, OTLP backend correlation, or another browser controller. React state and OTLP remain evidence-gated follow-ons.

Native Codex, Claude, Playwright, and Chrome tooling are often better for active inspection of what is happening now. Agent Replay is for what already happened and for moving that evidence between tools.

## CLI

`dev`, `view`, `sessions`, `inspect`, `timeline`, `errors`, `network`, `watch`, `mark`, `pack`, `export`, `compare`, `receipt`, `doctor`, `migrate`, `clean`, and `mcp`.

The local HTTP API is versioned under `/api/v1`. v0.2 routes remain deprecated aliases throughout v0.3.

## Project history

- [Current vision](./VISION.md)
- [Original April 2026 vision, with context](./docs/ORIGINAL_VISION.md)
- [Exact v0.2.1 README](./docs/archive/README-v0.2.1.md)
- [Exact v0.2.1 design](./docs/archive/DESIGN-v0.2.1.md)
- [Unchanged Homi dogfood findings](./docs/HOMI_INTEGRATION_FINDINGS.md)

## Development

```bash
bun install
bun run typecheck
bun run test:unit
bun run build
bun run --cwd extension typecheck
bun run --cwd extension build
```

Node 18+ remains supported for package consumers. The repository itself is a Bun workspace.

MIT — [Boe Ventures](https://boe.ventures)
