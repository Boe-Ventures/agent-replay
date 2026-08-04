# Homi dogfood — Agent Replay v0.3

Date: July 15, 2026

This is release evidence for the revived implementation. It complements, and
does not replace or modify, the historical
`docs/HOMI_INTEGRATION_FINDINGS.md` report.

## Isolation

- Homi ran from the dedicated `homi-extension-qa` worktree.
- Agent Replay used a dedicated recording directory.
- Homi used port `3977`; no active user server or port was reused.
- The Agent Replay receiver remained loopback-only at `127.0.0.1:3700`.

## Real application result

The Chrome extension preserved one recording session across four full Homi
navigations:

1. `/tos` — 200, “Terms of Service | Homi”
2. `/about` — 200, “About | Homi”
3. `/product` — 200, “Product | Homi”
4. `/contact` — 200, “Contact Us | Homi”

Session `20624219-6545-4bfc-bbb9-8c1783df99f8` contained four page identities,
52.1 seconds of bounded safe-mode history, rrweb, routes, console, network,
errors, performance, and WebSocket streams. It packed successfully as a
portable capsule. Replay export produced an H.264 MP4 at 1920×1080, 53.28
seconds, verified with FFprobe. The complete dogfood directory was 8.6 MiB.

## Bugs found and closed

Homi's modern performance entries exposed two non-cloneable nested browser
objects (`PerformanceTimingConfidence` and `TaskAttributionTiming`). The
main-world relay now reduces performance detail to plain JSON before
`postMessage`, preventing Agent Replay from creating its own `DataCloneError`.

The run also proved that extension page-local sequence counters restarted on
full navigation. The sidecar now assigns the canonical monotonically increasing
session sequence at ingestion, including after process restart.

Both fixes are covered by the headed Chrome extension test: it deliberately
creates a long task, asserts that no `DataCloneError` reaches disk, navigates,
and asserts a gapless session sequence. The writer also has a direct regression
test for page-local sequence reset.

## Environment note

The isolated Homi development worktree initially caused Next.js 16 to infer the
outer Boe Ventures directory because both roots contain lockfiles. An explicit
QA-only root allowed the real routes to run; that temporary override was
removed after the capture. Later hot-reload attempts were dominated by Homi's
existing file-watcher exhaustion and multi-minute cache compaction, so the
post-fix serialization proof was completed in the deterministic headed Chrome
fixture rather than represented as a second Homi product incident.
