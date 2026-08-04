# The original Agent Replay vision

_Historical note, 15 July 2026._

Agent Replay began in April 2026 with a simple observation: coding agents were trying to debug web applications from screenshots while the browser already contained much richer evidence. The original project proposed a local recorder that exposed DOM history, console output, network activity, errors, interactions, and eventually framework state as files an agent could inspect.

That insight remains valuable. The historical implementation also anticipated visual replay, portable local data, and a clean separation between an agent's browser controller and an application's observation plane.

The ecosystem changed quickly. Codex, Claude Code, Chrome DevTools MCP, and Playwright now provide excellent live browser inspection and control. They superseded the broadest form of the original “better than screenshots” argument and made a new browser controller unnecessary.

What they did not remove is the need for passive history: evidence from before an agent attached, a durable artifact that can move between agents and local models, a replay a human can review, and a trustworthy record that proves a fix.

The exact public documents shipped as v0.2.1 are preserved without edits:

- [README v0.2.1](./archive/README-v0.2.1.md)
- [Design v0.2.1](./archive/DESIGN-v0.2.1.md)
- [Homi integration findings](./HOMI_INTEGRATION_FINDINGS.md)

The current contract lives in [VISION.md](../VISION.md). This file is context, not revisionism: the original words remain part of the project.
