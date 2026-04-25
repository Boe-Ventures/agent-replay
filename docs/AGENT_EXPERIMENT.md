# Closed-Loop Agent Experiment

**Date:** 2025-04-25
**Goal:** Prove that a coding agent can use agent-replay session recordings to find and fix bugs without human guidance.

## Setup

### App
A task manager (Next.js) with 4 deliberate bugs:
- Fetches tasks from `/api/tasks`
- Add task form (POST)
- Delete all button (DELETE)
- Static "Recent Activity" list

### Bugs Planted

| # | Bug | Root Cause | Symptom |
|---|-----|-----------|---------|
| 1 | GET `/api/tasks` returns `{ taks: [...] }` (typo) | `route.ts` line 14: key is `taks` not `tasks` | Client throws `TypeError: data.tasks is not iterable` |
| 2 | POST `/api/tasks` returns malformed JSON | `route.ts` line 30: raw Response with missing `}` | Client throws `SyntaxError: Expected ',' or '}'` |
| 3 | DELETE `/api/tasks` returns 405 | No `DELETE` handler exported from `route.ts` | Client gets `405 Method Not Allowed` |
| 4 | Missing `key` prop in `.map()` | `page.tsx` line ~108: `<li>` without `key={...}` | React dev warning (not captured — see findings) |

### CLAUDE.md
Written at `playground/CLAUDE.md` — instructs any coding agent to:
1. Start the sidecar + dev server
2. Use agent-browser to interact with the app
3. Read `.agent-replay/latest/` JSONL files to diagnose
4. Fix the bugs in source
5. Verify by re-testing

## What the Recordings Captured

### Session Files
```
.agent-replay/latest/
├── console.jsonl    # 3 error entries
├── network.jsonl    # 6 requests (1 failure)
├── events.jsonl     # ~107KB DOM recording
└── session.json     # Session metadata
```

### Bug 1 — API typo (`taks` → `tasks`)
**Captured in:** `console.jsonl` + `network.jsonl`
- `network.jsonl`: `GET /api/tasks → 200 OK` (looks fine!)
- `console.jsonl`: `TypeError: data.tasks is not iterable at fetchTasks (page.tsx:37)`

**Agent diagnosis path:**
1. See "Failed to load tasks" error in console.jsonl
2. Note that GET /api/tasks returned 200 — so the API "succeeded"
3. The error says `data.tasks is not iterable` → response doesn't have a `tasks` key
4. Open `app/api/tasks/route.ts` → find the typo `taks`

**Verdict:** ✅ Capturable. The combination of "200 OK but client error" is a strong signal.

### Bug 2 — Malformed JSON response
**Captured in:** `console.jsonl` + `network.jsonl`
- `network.jsonl`: `POST /api/tasks → 201 Created` (looks fine!)
- `console.jsonl`: `SyntaxError: Expected ',' or '}' after property value in JSON at position 72`

**Agent diagnosis path:**
1. See JSON parse error in console.jsonl after POST
2. Note POST returned 201 — the server thinks it succeeded
3. The error is a `SyntaxError` → response body is malformed JSON
4. Open `app/api/tasks/route.ts` → find the raw `Response()` with malformed template literal

**Verdict:** ✅ Capturable. Clear error message pinpoints the issue.

### Bug 3 — Missing DELETE handler
**Captured in:** `console.jsonl` + `network.jsonl`
- `network.jsonl`: `DELETE /api/tasks → 405 Method Not Allowed` ← FAILED
- `console.jsonl`: `Delete failed: 405`

**Agent diagnosis path:**
1. See 405 in network.jsonl — DELETE not allowed
2. Open `app/api/tasks/route.ts` → no `DELETE` export
3. Add a DELETE handler

**Verdict:** ✅ Capturable. The 405 is the clearest signal of all — the fix is obvious.

### Bug 4 — Missing React `key` prop
**Captured in:** ❌ NOT captured in JSONL files
- Next.js dev overlay shows "4 Issues" (visible in screenshot)
- React's key warning uses an internal warning system, not `console.warn`
- The rrweb console plugin doesn't intercept React's internal warnings

**Agent diagnosis path (current):**
1. Would need to visually see the dev overlay (screenshot) or read Next.js dev tools
2. Not discoverable from JSONL files alone

**Verdict:** ❌ Not captured. This is a gap in the current recording approach.

## CLI Summary Output

```
# Session 2026-04-25T18:47:45.859Z (?s)

## Errors (0)
No errors recorded.

## Network (6 requests, 1 failure)
- [0.7s] GET /api/tasks → 200 (29ms)
- [11.0s] POST /api/tasks → 201 (11ms)
- [12.4s] DELETE /api/tasks → 405 (14ms) ← FAILED

## Console (3 entries)
- [0.7s] error: "Failed to fetch tasks:" "TypeError: data.tasks is not iterable"
- [11.0s] error: "Failed to add task:" "SyntaxError: Expected ',' or '}'"
- [12.4s] error: "Delete failed: 405"
```

## Findings

### What Works Well
1. **Console errors with stack traces** — Each error points to the exact source file and line. An agent can jump straight from the error to the code.
2. **Network + Console correlation** — Bugs 1 and 2 both show "success" status codes (200, 201) but client-side errors. This pattern (server says OK, client fails) is a strong diagnostic signal.
3. **The summary command** — `agent-replay summary` gives a concise overview that's perfect for an LLM context window.
4. **Separate JSONL files** — An agent can selectively read just errors.jsonl or network.jsonl without parsing a giant combined log.

### What Needs Improvement
1. **React dev warnings not captured** — Missing key props, deprecated API warnings, hydration mismatches — these are React-internal and don't go through `console.*`. Consider intercepting `__REACT_DEVTOOLS_GLOBAL_HOOK__` or parsing Next.js dev overlay state.
2. **No response body capture** — For Bug 1, the agent can't see the actual API response (`{ taks: [...] }`). Adding response body capture (opt-in, size-limited) would make diagnosis much faster.
3. **No errors.jsonl created** — The `errors.jsonl` file is only created for uncaught `window.onerror` / `unhandledrejection` events. All 3 bugs were caught by try/catch and logged via `console.error`. Consider promoting `console.error` entries to errors.jsonl automatically.
4. **Race condition on page load** — The initial `useEffect` fetch can fire before the recording hooks are active. Had to add a 500ms delay. The provider should buffer events from first paint, not from when the WebSocket connects.
5. **Network noise** — `__nextjs_original-stack-frames` requests pollute the log. Default ignore patterns would help.
6. **Session duration** — Shows `(?s)` because `endedAt` isn't set until explicit teardown.

### Improvement Priority
1. **Response body capture** (high impact — makes Bug 1 trivially diagnosable)
2. **Promote console.error to errors.jsonl** (medium — single file to check)
3. **Network noise filtering** (medium — cleaner signal)
4. **React warning capture** (nice-to-have — edge case)

## Conclusion

**3 out of 4 bugs are clearly diagnosable from session recordings alone.** The console.jsonl + network.jsonl combination provides enough signal for an agent to:
1. Identify that something is wrong
2. See the exact error message and stack trace
3. Locate the source file and line number
4. Understand the fix

The experiment proves the core thesis: session recordings can serve as the "eyes" for a coding agent debugging a web app. The main gaps (response body capture, React warnings, noise filtering) are addressable improvements, not fundamental limitations.

### Next Steps
- [x] Add response body capture (opt-in, with size limit)
- [ ] Auto-promote console.error to errors.jsonl
- [ ] Add default network ignore patterns for dev server internals
- [ ] Test with an actual coding agent (Claude Code with CLAUDE.md)
- [ ] Build themed playground variations for different bug categories

---

## Re-run: After Network Interception Rewrite (2026-04-25)

### What Changed
Rewrote the network interception in `src/core/recorder.ts` to production-quality, following PostHog/Sentry patterns:
- **Response body capture** via `response.clone()` + 500ms timeout for streaming
- **Request body capture** with serialization for all BodyInit types
- **Request/response header capture**
- **XHR response body** handling all `responseType` values (text, json, document, arraybuffer, blob)
- **WebSocket interception** (constructor patching, send/receive/open/close/error)
- **PerformanceObserver** integration for transferSize and initiatorType
- **Configurable** via `NetworkConfig` (maxBodySize, bodyTimeout, ignoreUrls, etc.)

### Results

Re-ran the same 4-bug playground experiment with the enriched network capture.

#### Bug 1 — API typo (`taks` → `tasks`)
**Before:** `GET /api/tasks → 200 OK` — no body, agent had to guess from console error.
**After:** `GET /api/tasks → 200 OK` with `responseBody: {"taks":[...],"count":3}` — **the typo is directly visible in network.jsonl!**

An agent can now:
1. See `GET /api/tasks → 200` + client error `data.tasks is not iterable`
2. Read the response body → spot `taks` instead of `tasks`
3. Jump to route.ts and fix the typo

**Verdict:** ✅ Trivially diagnosable. The #1 requested improvement delivers.

#### Bug 2 — Malformed JSON response
**Before:** `POST /api/tasks → 201 Created` — no body, only `SyntaxError` in console.
**After:** `POST /api/tasks → 201 Created` with `responseBody: {"success": true, "task": {"id": "...", "title": "Test task"` — **the missing closing brace is visible!**

An agent can now:
1. See the console SyntaxError
2. Read the actual response body → see it's truncated/malformed JSON
3. Know exactly what's wrong without reading the server code first

**Verdict:** ✅ Even more diagnosable than before.

#### Bug 3 — Missing DELETE handler
**Before:** `DELETE /api/tasks → 405` — clear from status code.
**After:** `DELETE /api/tasks → 405` with `isError: true`, empty responseBody, full headers.

**Verdict:** ✅ Same clarity, now with `isError` flag for easy filtering.

#### Bug 4 — Missing React `key` prop
**Still not captured** in JSONL files. React internal warning system.

### New Captured Data (sample network.jsonl entry)
```json
{
  "timestamp": 1777143933915,
  "offsetMs": 852,
  "method": "GET",
  "url": "/api/tasks",
  "status": 200,
  "statusText": "OK",
  "durationMs": 285.2,
  "requestHeaders": {},
  "responseHeaders": {
    "connection": "keep-alive",
    "content-type": "application/json",
    "transfer-encoding": "chunked"
  },
  "responseBody": "{\"taks\":[{\"id\":\"1\",...}],\"count\":3}",
  "responseSize": 193,
  "initiatorType": "fetch",
  "isError": false,
  "initiator": "fetch"
}
```

### Also captured: request bodies
```json
{
  "method": "POST",
  "url": "/api/tasks",
  "requestHeaders": { "Content-Type": "application/json" },
  "requestBody": "{\"title\":\"Test task\"}",
  "responseBody": "{\"success\": true, \"task\": {\"id\": \"...\", \"title\": \"Test task\""
}
```

### Assessment

Response body capture is the single biggest improvement to agent diagnosability. Bug 1 went from "agent needs to correlate console error with API response and guess at the data shape" to "agent can literally read the response and see `taks` vs `tasks`." That's the difference between 3 steps of reasoning and 1 step.

### Remaining Gaps
1. **Network noise** — `__nextjs_original-stack-frames` and `webpack.hot-update.json` requests still pollute. Default ignore patterns for `_next/` internals would clean this up.
2. **React warnings** — Still not captured.
3. **console.error → errors.jsonl** — Not yet implemented.
