# Local-model inspection example

This output was produced deterministically by Agent Replay with:

```sh
agent-replay inspect 21204cae-13dd-4037-bb6c-f016d3cb055e --budget 4000
```

No AI model was called to prepare the evidence.

## Failure

- At 0.4 seconds, `POST /api/triage` returned `500`.
- The response was `TRIAGE_OWNER_MISSING`: the fixture attempted to read an
  undefined `assignee`.
- The matching click was **Run broken triage**, followed by marker
  `triage-sync`.
- The console recorded `[BugBoard] Triage sync failed` at the same moment.
- Request fields named like API keys and response fields named like tokens were
  written as `[REDACTED]` under the safe privacy preset.

## Correlated path

```text
route load
→ click “Run broken triage”
→ marker “triage-sync”
→ POST /api/triage
→ 500 TRIAGE_OWNER_MISSING
→ console error
→ error result rendered in the DOM
```

The paired clean run changes the same request from `500` to `200`, introduces
no new errors, and is aligned by the `triage-sync` marker in the included fix
receipt.
