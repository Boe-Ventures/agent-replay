# Agent integrations

Agent Replay is intentionally shell-first. Every integration follows the same evidence order:

1. `agent-replay inspect --budget 4000`
2. `agent-replay errors`
3. `agent-replay network --failures`
4. `agent-replay timeline --around <milliseconds>`
5. open `agent-replay view` only when visual reconstruction helps

The files under `.agent-replay/sessions/<uuid>/` are canonical. MCP is optional.

- [Codex](./codex.md)
- [Claude Code](./claude-code.md)
- [OpenHands](./openhands.md)
- [Continue](./continue.md)
- [Ollama and local models](./local-models.md)
- [Generic shell agents](./generic.md)

The reusable [Agent Replay skill](../../skills/agent-replay/SKILL.md) can be copied into an agent's project-local skills folder.
