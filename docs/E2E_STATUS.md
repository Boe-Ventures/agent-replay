# E2E Validation Status

**Date:** 2026-04-25  
**Validated by:** Orion (subagent)  
**Verdict:** ✅ All 4 test scenarios pass end-to-end

## Setup

- **Sidecar:** `node dist/cli/index.js dev` on port 3700
- **Playground:** Next.js 15.5.15 on port 3800
- **Browser:** agent-browser (headless Chrome 147)
- **Package build:** `pnpm build` (tsc) — clean, zero errors

## What Works

### All 4 test scenarios captured correctly:

| Button | Event Type | Captured In | Verified |
|--------|-----------|-------------|----------|
| 📝 Log to Console | console.log + console.warn | console.jsonl | ✅ |
| 💥 Throw Error | window error + stack trace | errors.jsonl | ✅ |
| ✅ Fetch /api/test (200) | GET 200 OK | network.jsonl | ✅ |
| ❌ Fetch /api/error (500) | GET 500 + auto error entry | network.jsonl + errors.jsonl | ✅ |

### Infrastructure working:
- Session directory created: `.agent-replay/sessions/<timestamp>/`
- `latest` symlink correctly points to active session
- Separate JSONL files: `events.jsonl`, `console.jsonl`, `network.jsonl`, `errors.jsonl`
- `session.json` metadata captured (URL, viewport, userAgent, timestamps)
- rrweb DOM recording: 53 events captured in events.jsonl
- CLI `summary` command produces clean markdown output
- CLI `errors` and `network --failures` commands work
- CORS between playground (3800) and sidecar (3700) works out of the box
- Sidecar health endpoint returns session count

### Summary output (from `agent-replay summary`):
```
# Session 2026-04-25T18:23:24.239Z (?s)
## Errors (2)
- [15.5s] Uncaught Error: Intentional test error from playground at page.tsx:15
- [21.7s] GET /api/error returned 500
## Network (6 requests, 1 failure)
- [20.6s] GET /api/test → 200 (360ms)
- [21.7s] GET /api/error → 500 (159ms) ← FAILED
## Console (9 entries)
- [10.5s] log: "User clicked the log button"
- [10.5s] warn: "This is a warning from the playground"
...
```

## What Broke and How It Was Fixed

### 1. Package exports missing `default` condition (already fixed in HEAD)
- **Problem:** `next.config.ts` loads via CJS `require()`, but exports only had `import` condition
- **Fix:** Flattened exports to `{ types, import, default }` pattern (was already done in HEAD)

### 2. Playground hardcoded to port 3100
- **Problem:** `package.json` had `--port 3100`, needed 3800 per port plan
- **Fix:** Changed to `--port 3800`

### 3. `generateSummary` didn't persist `summary.md` to disk
- **Problem:** CLI's `summary` command printed to stdout but `writer.writeSummary()` silently no-op'd because `sessionDir` was null (fresh `SessionWriter` without `initSession`)
- **Fix:** In `summarizer.ts`, call `writer.initSession(resolvedId)` before `writeSummary()` so the writer knows where to write. Safe for existing sessions since `mkdirSync({ recursive: true })` is idempotent.

## What Still Needs Work

1. **Network noise filtering:** Next.js HMR requests (`__nextjs_original-stack-frames`, webpack hot-update) pollute network.jsonl. Consider adding default ignore patterns for common dev server internals.

2. **Session duration:** Summary shows `(?s)` for duration because `endedAt` is only set when `endSession()` is called explicitly. The sidecar's shutdown hook calls it, but if the browser just closes, duration stays unknown.

3. **Console args serialization:** Console entries have double-quoted strings inside arrays (e.g., `"\"User clicked the log button\""`) — the rrweb console plugin serializes args as JSON strings. Could be cleaned up for readability.

4. **5xx auto-error:** When `GET /api/error` returns 500, it creates an entry in errors.jsonl with `source: "network"` — but the `console.error()` from the page also creates a console.jsonl entry. Could consider deduplication or clear provenance.

5. **`sessions` CLI command:** Not tested but code looks correct.

## Files Changed

- `playground/package.json` — port 3100 → 3800
- `src/server/summarizer.ts` — fix `generateSummary` to persist summary.md
- `playground/pnpm-lock.yaml` — generated from install
- `playground/tsconfig.json` — Next.js auto-added `.next/types` include
- `playground/next-env.d.ts` — Next.js auto-generated
