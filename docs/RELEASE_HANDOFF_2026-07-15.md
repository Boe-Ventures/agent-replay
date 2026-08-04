# Agent Replay v0.3 release handoff — 2026-07-15

## Stop point

The revival implementation, public site, npm package, extension bundle, generated evidence, and boe.ventures case study are complete in isolated worktrees. Nothing from the revival or portfolio worktrees has been committed, merged, tagged, or published yet. The original Agent Replay worktree and the user's unrelated Homi work remain untouched.

## Worktrees and branches

- Agent Replay revival: `/Users/kristianeboe/Developer/boe-ventures/agent-replay-revival` on `codex/agent-replay-revival`
- Portfolio case study: `/Users/kristianeboe/Developer/boe-ventures/boe-ventures-agent-replay` on `codex/agent-replay-case-study`
- Original Agent Replay: `/Users/kristianeboe/Developer/boe-ventures/agent-replay` on `main`; preserve its untracked Homi findings
- Homi QA handoff: `/Users/kristianeboe/Developer/boe-ventures/homi-extension-qa`; preserve its existing dirty QA documentation

The historical `v0.2.1` annotated tag has already been pushed at commit `8af4912`. The separate Homi and Hydra Chrome-extension QA handoff branches were also pushed earlier.

## Verified release state

- TypeScript, 21 unit tests, package build, viewer build, extension build, and extension ZIP have passed.
- The public Vite site and boe.ventures case study passed desktop/mobile visual QA.
- The packed npm artifact passed clean React 18/19, Next.js 14/15/16, Vite, Node 18, CLI, export, and `doctor` checks.
- Real Chrome tab capture across navigation produced a valid VP9 WebM. Real Homi dogfood produced one coherent multi-route safe-mode session, a capsule, and a valid H.264 replay export.
- Public artifacts are tracked under `site/public/artifacts/` and mirrored into the portfolio case study.
- npm authentication and GitHub CLI authentication are valid. npm `0.3.0` is not published.
- No development listeners should be left running after this handoff.

## One remaining test gate

The complete 27-test browser run passed all 19 applicable product tests across Chromium, Firefox, and WebKit except for one intermittent Chrome MV3 startup race: on a cold persistent profile, the first fixture page can open before Chrome finishes registering the unpacked extension's content scripts.

The test harness now retries/reloads that first page up to three times in `tests/extension.spec.ts` via `waitForExtensionSession`. A three-repeat validation run was started but intentionally stopped when the user ended the session. Resume by validating the extension spec repeatedly, then run the complete suite once. This is a harness readiness issue; repeated standalone extension runs and the manual true-tab-capture acceptance test already passed.

The recording comparison test also had a resolved harness race: it now selects the newly created session containing the expected network evidence instead of the first new UUID. The targeted Chromium recording suite passed all six tests afterward.

## Resume checklist

1. Run the Chrome extension integration test repeatedly and confirm the new registration retry is stable.
2. Run the full browser suite once; require a clean result.
3. Re-run typecheck, unit tests, package build, site build, extension build/ZIP, `git diff --check`, and a final packed-artifact smoke install.
4. Re-run the boe.ventures production build and `git diff --check`.
5. Confirm no leftover listeners and review both worktree diffs/statuses.
6. Commit the Agent Replay revival and portfolio case study independently, then push both branches.
7. Fast-forward the Agent Replay branch to `main`, push `main`, create and push annotated `v0.3.0`, and watch the Pages and Release workflows.
8. Verify npm `@boe-ventures/agent-replay@0.3.0`, GitHub release assets, and the live GitHub Pages site. If the release workflow's npm token fails, publish manually with provenance and create/update the GitHub release.
9. Fast-forward the portfolio case-study branch to its `main`, verify the production deployment at `/work/agent-replay`, and visually smoke-test both live sites.
10. Only then mark the Agent Replay revival goal complete.

## Product caveats to keep honest

- Tab audio is opt-in beta and defaults off because Chrome may emit an Opus/WebM warning.
- React state snapshots and OTLP correlation remain evidence-gated future work, not v0.3 features.
- The post-fix deterministic extension test validates the two Homi dogfood fixes: plain performance payloads (no `DataCloneError`) and server-canonical gapless session sequences across navigation.
