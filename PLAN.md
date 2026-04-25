# PLAN.md — Agent Replay Development Plan

_Orion orchestrates. Sub-agents execute. Kristian reviews when ready._

## Current Sprint: Get to v0.1.0 publishable

### Workstream 1: End-to-end validation ✅ DONE
- [x] Start sidecar + playground, click all 4 buttons, verify events land in `.agent-replay/`
- [x] Verify separate JSONL files (console, network, errors) are correct
- [x] Fixed: playground port, summary persistence bug
- [x] CLI summary/errors/network all work

### Workstream 2: Network interception deep-dive ✅ DONE
- [x] Research: PostHog (custom rrweb plugin, fetch/XHR patching + PerformanceObserver), Sentry (breadcrumb hooks), no official rrweb network plugin exists
- [x] Implemented: fetch + XHR + WebSocket interception with full request/response body capture
- [x] PerformanceObserver integration for timing data (transferSize, initiatorType)
- [x] Handles: streaming responses (500ms timeout), FormData/Blob/ArrayBuffer bodies, all xhr.responseType values
- [x] Sidecar URL excluded from capture
- [x] Re-ran experiment: all 3 API bugs now have response bodies visible in network.jsonl
- [x] Bug 1 (typo): `{"taks":[...]}` directly visible in response body
- [x] Docs: NETWORK_RESEARCH.md + AGENT_EXPERIMENT.md updated

### Workstream 3: Vite playground ✅ DONE
- [x] Created `playground-vite/` — Vite 6 + React 19 + TypeScript strict
- [x] 4 test scenarios: counter, error, fetch 200, fetch 404
- [x] Provider works without Next.js adapter — just needs sidecarUrl prop
- [x] Runs on port 3801

### Workstream 4: Testing ✅ DONE
- [x] Playwright e2e tests: 6/6 passing in 27s
- [x] Tests: console capture, error capture, network with bodies, failed requests, CLI summary, file structure
- [x] Helpers: startSidecar(), startPlayground(), readSessionFile(), cleanAgentReplay()
- [ ] Unit tests for summarizer, writer, session management (deferred — e2e covers the critical path)

### Workstream 5: npm + GitHub marketing ✅ DONE
- [x] npm SEO: description, keywords, repository, homepage in package.json
- [x] GitHub: description, 9 topics, homepage
- [x] GitHub Pages site live at boe-ventures.github.io/agent-replay/
- [x] README badges (npm version, license, TypeScript, stars)

### Workstream 6: Themed playgrounds
- [ ] Next.js playground: "BugBoard" — fake kanban/project mgmt app
- [ ] Vite playground: "CrashCafe" — fake coffee ordering app where every drink breaks differently
- [ ] Each looks like a real product for compelling screenshots/demos

### Workstream 7: Polish for publish
- [ ] Ensure `pnpm pack` produces clean tarball
- [ ] Verify subpath exports work from a consuming project
- [ ] Add bin entry for CLI (`npx agent-replay dev`)
- [ ] CHANGELOG.md
- [ ] Publish v0.1.0 to npm under @boe-ventures scope

## Decisions (locked)
- Subpath exports, single package
- pnpm for packages, bun for scripts/tests
- Port 3700 sidecar default
- Playgrounds committed to repo (not gitignored)
- Chrome extension is Phase 2 (after v0.1.0)
- No AI dependencies in the package itself
- `docs/COMPETITION.md` gitignored (private intel)

## Checkpoints (escalate to Kristian)
- Network interception approach (show research before implementing)
- Package structure changes
- Before npm publish
- Any new heavy dependencies
- Marketing site content/design

## Architecture reminders
- Browser code: `src/core/recorder.ts`, `src/react/`, `src/next/`
- Node code: `src/server/`, `src/cli/`
- Shared types: `src/core/types.ts`
- Output dir: `.agent-replay/sessions/<id>/` with separate JSONL per signal
- Extension coordination: `window.__AGENT_REPLAY_ACTIVE__`
