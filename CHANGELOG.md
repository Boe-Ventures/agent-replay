# Changelog

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
