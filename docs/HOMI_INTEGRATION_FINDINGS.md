# Agent Replay Integration — Homi Findings

**Date:** 2026-04-26
**Package:** `@boe-ventures/agent-replay@0.1.0` (linked local)
**Source branch:** `homi/feat/agent-replay-integration` (deleted 2026-05-08; preserved here)
**Original location:** `homi/docs/AGENT_REPLAY_INTEGRATION.md`

> Migrated to the agent-replay project itself because these findings describe agent-replay's behavior when integrated into a real Next.js app, not anything specific to Homi. The branch was deleted after extraction.

## Setup

- Installed via `pnpm add ~/Developer/boe-ventures/agent-replay --filter @acme/nextjs` (local link)
- Added `AgentReplayProvider` to `apps/nextjs/src/app/layout.tsx` (dev-only conditional)
- Sidecar started on port 3700 via direct import (`start-sidecar.mjs`)
- Added `.agent-replay/` to `.gitignore`

## What Worked ✅

### Provider Integration

- Drop-in `<AgentReplayProvider />` component loaded correctly in Next.js 16 + Turbopack
- `"use client"` directive works fine — no SSR issues
- `window.__AGENT_REPLAY_ACTIVE__` flag set correctly for extension detection
- Auto-disables in production via `process.env.NODE_ENV` check

### Data Capture

- **Console logs:** Captured all levels (log, info, warn, error, debug) including:
  - Vercel Analytics debug messages
  - PostHog identify calls
  - tRPC query results with full response data
  - Next.js Image warnings
- **Network requests:** Captured fetch-based requests with:
  - Full URL, method, status, duration
  - tRPC batch queries with response bodies
  - Mapbox API calls
- **DOM events (rrweb):** Recording successfully via rrweb plugin
- **Session management:** Auto-generates timestamp-based session IDs, persists across HMR

### Sidecar

- Writes JSONL files to `.agent-replay/sessions/<id>/`
- Creates `latest` symlink for quick access
- Health endpoint works (`/health`)
- CORS handled correctly for cross-port requests

## Issues Found ⚠️

### 1. Published npm version (0.1.1) has wrong default port

The `npx agent-replay dev` command fetched v0.1.1 from npm which defaults to port 3000 instead of 3700. The `--port` flag is also ignored in the published version. The local source (v0.1.0) correctly defaults to 3700.

**Impact:** CLI unusable from npm, had to use direct import workaround.
**Fix needed:** Publish corrected version with port 3700 default.

### 2. `npx agent-replay summary` crashes

The published version's `summary` command tries to start the sidecar server (on port 3000) instead of just reading files. Works fine when calling the summarizer directly via import.

**Fix needed:** CLI command routing bug — `summary` should only read files, not start server.

### 3. Sidecar crashes on undefined sessionId

When the first event batch has `sessionId: undefined` (can happen if events fire before session init), `SessionWriter.initSession(undefined)` crashes with `ERR_INVALID_ARG_TYPE` on `path.join`.

**Fix needed:** Validate sessionId before calling `initSession()`, generate fallback if missing.

### 4. Session fragmentation with full-page navigations

Each `agent-browser open <url>` creates a new session because the page fully reloads and `getOrCreateSession()` generates a new ID. SPA navigations within a session work fine.

**Impact:** Agent browsing sessions produce many small session files instead of one continuous recording.
**Possible fix:** Accept session ID as a URL parameter or cookie so agent-browser can maintain continuity.

### 5. Console capture is extremely verbose

tRPC's dev logger dumps full query results to console. Agent-replay captures all of it, including massive JSON payloads (full collection data, listing arrays, etc.). A single session of browsing collections produced 65KB of console.jsonl.

**Suggestions:**

- Add `maxConsoleArgSize` config to truncate large console args
- Add console level filtering (e.g., skip `debug` by default)
- Consider deduplication for repeated patterns (tRPC style logs)

### 6. Network response bodies can be huge

tRPC batch responses contain full data payloads. The 64KB `maxBodySize` default helps but still captures large responses.

**Suggestion:** Add URL-pattern-based filtering for response body capture (e.g., skip body for image/font requests, truncate tRPC responses more aggressively).

## Data Volume

From ~5 minutes of browsing (homepage → collections → collection detail → blog):

| File                  | Size       | Lines |
| --------------------- | ---------- | ----- |
| events.jsonl (rrweb)  | ~1.2MB     | 55-74 |
| console.jsonl         | ~65KB      | 21-27 |
| network.jsonl         | ~31KB      | 2-3   |
| session.json          | ~325B      | 1     |
| **Total per session** | **~1.3MB** |       |

Over 6 sessions (mix of real browser + agent-browser): **6.4MB total**

At this rate, a 1-hour dev session would produce ~75MB. The 50MB max file size limit is appropriate but may need per-file-type limits.

### 7. `children` prop is required but shouldn't be

`AgentReplayProviderProps` requires `children: React.ReactNode` but the provider works fine as a standalone component (just injects recording scripts). Had to pass `{null}` as children to satisfy TypeScript.

**Fix needed:** Make `children` optional in the type definition.

## Recommendations for agent-replay

1. **Fix CLI bugs** — port default, summary command, sessionId validation
2. **Add noise reduction** — console arg truncation, tRPC-aware filtering, response body size limits per URL pattern
3. **Session continuity** — support external session ID injection (cookie/URL param) for agent-browser workflows
4. **Add `errors.jsonl`** — currently only captured within events.jsonl, not as a separate file (despite the `/sessions/latest/errors` endpoint existing)
5. **Summary command** — should work offline (just read files), not require running sidecar
6. **Consider sampling** — for high-frequency rrweb events, allow temporal sampling to reduce events.jsonl size

## Files Changed in Homi (now reverted)

- `apps/nextjs/src/app/layout.tsx` — Added `AgentReplayProvider`
- `apps/nextjs/package.json` — Added `@boe-ventures/agent-replay` dependency
- `.gitignore` — Added `.agent-replay/`
- `start-sidecar.mjs` — Workaround script for sidecar startup (temporary)
- `docs/AGENT_REPLAY_INTEGRATION.md` — The original of this file
