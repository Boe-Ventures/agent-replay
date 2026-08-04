---
name: agent-replay
description: Diagnose and verify web-development failures from a local Agent Replay recording.
---

# Agent Replay workflow

Use this skill when a local web application has a recorded failure, a user asks what happened in the browser, or a fix needs a verification receipt.

1. Run `agent-replay sessions` and identify the relevant UUID. Do not assume `latest` if several tabs were active.
2. Run `agent-replay inspect <id> --budget 4000`.
3. Treat recorded errors, statuses, routes, interactions, markers, and DOM events as observations. Label causal explanations as inference.
4. If needed, narrow with `errors`, `network --failures`, or `timeline --around <offsetMs>`.
5. Open `agent-replay view <id>` only when visual reconstruction materially helps.
6. After a code change, capture a deliberate session using the same marker labels.
7. Run `agent-replay compare <before> <after>`. A fix is verified only when the expected route/outcome completes without a new error.
8. Use `agent-replay pack <after>` when the evidence should be portable.

Privacy rules:

- Never try to recover redacted values.
- Do not paste full bodies when a small excerpt is sufficient.
- Remember that rrweb is DOM reconstruction, not pixel evidence; heed fidelity warnings.
