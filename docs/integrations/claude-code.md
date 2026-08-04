# Claude Code

Add this instruction to `CLAUDE.md`:

> For browser regressions, inspect Agent Replay first: `agent-replay inspect --budget 4000`, then errors and failed network. Use the local viewer only for the exact deep-linked timestamp. Mark the reproduction and fixed flow with the same label, then generate a fix receipt.

Claude's Chrome integration is useful for live DOM/network work. Agent Replay is the durable retrospective evidence layer.
