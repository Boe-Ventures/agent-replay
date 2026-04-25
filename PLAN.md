# PLAN.md — Agent Replay Development Plan

_Orion orchestrates. Sub-agents execute. Kristian reviews when ready._

## Current Sprint: Get to v0.1.0 publishable

### Workstream 1: End-to-end validation ✅ DONE
- [x] Start sidecar + playground, click all 4 buttons, verify events land in `.agent-replay/`
- [x] Verify separate JSONL files (console, network, errors) are correct
- [x] Fixed: playground port, summary persistence bug
- [x] CLI summary/errors/network all work

### Workstream 2: Network interception deep-dive
- [ ] Research PostHog/Sentry/Amplitude source code for how they intercept fetch/XHR
- [ ] Handle: request/response bodies, headers, timing, status codes, streaming responses
- [ ] Handle: failed requests (network errors, CORS failures, timeouts)
- [ ] Ensure sidecar's own requests are excluded from capture
- [ ] Test against real apps (Homi localhost)

### Workstream 3: Vite playground
- [ ] Add `playground/vite/` — minimal Vite + React app
- [ ] Same test scenarios as Next.js playground
- [ ] Verify the provider works without Next.js adapter

### Workstream 4: Testing
- [ ] Playwright tests: start sidecar → open playground → click buttons → assert files exist
- [ ] Unit tests for summarizer, writer, session management
- [ ] Use bun for running tests

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
