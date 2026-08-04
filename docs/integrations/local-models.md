# Ollama and local models

Local models benefit most from deterministic context budgeting:

```bash
agent-replay inspect --budget 1800 > /tmp/replay-context.md
```

Prompt:

> Diagnose the web failure using only the attached Agent Replay evidence. Cite event IDs and offsets. Separate observed facts from inference. Ask for one targeted live check only if the evidence is insufficient.

Use lower budgets for small models. The ranking prioritizes errors, incident markers, failed requests, routes, and interactions without an AI preprocessing call.
