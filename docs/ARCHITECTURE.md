# Architecture

## One timeline, three outputs

```text
page / extension / Playwright
            │
            ▼
  versioned loopback ingestion
            │
            ▼
  session-addressed signal streams
            │
    ┌───────┼──────────────┐
    ▼       ▼              ▼
 inspect  local viewer   video/export
    │       │              │
    └───────┴──────┬───────┘
                   ▼
          portable .areplay capsule
```

The browser envelope is the ordering authority. Each event receives a UUID, monotonically increasing sequence number, stable session ID, page ID, wall-clock timestamp, and session offset before transport. The writer always resolves the destination from the event's session ID; it has no mutable “current session” directory.

## Artifact schema v1

```text
<session>/
  manifest.json
  session.json                 # v0.2 compatibility alias
  events.jsonl                 # rrweb event payloads
  timeline.jsonl               # normalized event envelopes
  console.jsonl
  network.jsonl
  websocket.jsonl
  errors.jsonl
  interactions.jsonl
  routes.jsonl
  markers.jsonl
  performance.jsonl
  summary.md
  report.html
  media/
  exports/
```

`manifest.json` declares schema version, privacy preset, capture mode, pages, timestamps, counts, pin state, fidelity warnings, and file inventory. v0.2 directories remain readable without mutation; `migrate` is explicit.

## Capture modes

- **rolling** (default): keep five minutes of unpinned evidence, create a DOM checkpoint every 30 seconds, and pin two minutes before through 15 seconds after a high-signal trigger.
- **session**: deliberate start/stop for demos, Playwright flows, and complete end-to-end recordings.
- **demo**: session semantics plus the demo privacy preset and optional true tab media.

Uncaught errors, rejected promises, 5xx responses, network failures, and manual markers pin incidents. Ordinary 4xx responses do not.

## Privacy

Redaction occurs in the browser before transport and again at ingestion before disk. Secret header names, cookies, passwords, credentials, tokens, API keys, session identifiers, configured names, sensitive query parameters, and matching JSON keys are always removed.

- **safe**: mask all form values; retain size-limited same-origin text bodies up to 16 KiB.
- **diagnostic**: retain ordinary non-secret input values and same-origin text bodies up to 64 KiB.
- **demo**: retain visible non-secret interactions; store no request/response headers or bodies.

Cross-origin ingestion is write-only. Read APIs and the viewer are loopback-only. Non-loopback binding requires an explicit token.

## Correlation and comparison

Correlation is deterministic. It uses page identity, event sequence, timing windows, route, target/action metadata, request IDs, and initiator metadata to assemble click → request → response → error → DOM-change chains.

Comparison aligns sessions using matching markers first, Playwright steps second, and route/action sequences third. It reports resolved and new errors, network status changes, route completion, timing deltas, and final visual-state differences in JSON, Markdown, HTML, and optional video.

## Video

- rrweb replay export is retrospective and best effort.
- Playwright screencast records automated verification receipts with step chapters.
- Chrome tab capture records faithful pixels and optional tab audio for marketing.

WebM is the source. System FFmpeg produces H.264 MP4, GIF, posters, storyboards, and landscape/square/vertical layouts. Microphone capture is outside v0.3.
