# Changelog

## 0.3.0 (2026-07-15)

Agent Replay returns as a local, model-agnostic flight recorder for web
development: capture once, debug with any agent, replay for humans, and export
as video.

### Added

- Session-addressed, UUID-based event storage with rolling and explicit modes.
- Safe, diagnostic, and demo privacy presets with unconditional secret redaction.
- Versioned replay capsules, local reports, legacy loading, and explicit migration.
- Synchronized local viewer with live tailing, filtering, exact-time deep links,
  privacy state, clip points, and correlated evidence lanes.
- Deterministic `inspect --budget`, fix receipts, comparison outputs, and a small
  MCP interface for coding agents and local models.
- rrweb replay export, Playwright verification receipts, and true Chrome tab
  capture with navigation-safe chunk streaming. Tab audio is opt-in beta.
- MP4, GIF, poster, storyboard, square, vertical, and launch-format processing
  through a locally detected FFmpeg installation.
- Bun workspace development while retaining Node.js 18+ package compatibility.
- GitHub Pages product site, deterministic demo fixtures, integration guides,
  reusable agent skills, and self-generated public release artifacts.

### Changed

- Repositioned the project around passive retrospective evidence instead of
  competing with the live browser-control capabilities now built into agents.
- Replaced mutable shared writes with isolated sessions and atomic manifests.
- Bound the sidecar to loopback by default and versioned the local API at
  `/api/v1`; v0.2 routes remain deprecated aliases throughout v0.3.
- Replaced the old zero-configuration Next.js claim with explicit provider and
  development-route setup.

### Preserved

- Tagged the pre-revival source as `v0.2.1`.
- Archived the exact v0.2.1 README and design, and documented the original and
  current visions without silently rewriting project history.

## 0.2.1 (2026-04-25)

- Historical preservation release for the pre-revival implementation. See
  `docs/archive/` and `docs/ORIGINAL_VISION.md`.

## 0.1.0 (2026-04-25)

### Features
- Core session recording engine (rrweb + console plugin)
- Network interception with request/response body capture (fetch, XHR, WebSocket)
- PerformanceObserver integration for timing data
- React `<AgentReplayProvider>` component (dev-only, auto-disables in production)
- Next.js adapter (`withAgentReplay()` config plugin + API route handler)
- Sidecar HTTP server (port 3700, CORS-enabled)
- Separate JSONL output files per signal type (events, console, network, errors, websocket)
- Session summarizer (Markdown output)
- CLI: `agent-replay dev`, `summary`, `errors`, `network`, `sessions`
- Subpath exports: `./react`, `./next`, `./server`, `./cli`

### Documentation
- GitHub Pages site
- DESIGN.md with architecture diagrams
- Network interception research (PostHog/Sentry patterns)
- Mobile E2E learnings
- Agent experiment with planted bugs
