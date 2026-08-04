# Agent Replay

> Capture once. Debug with any agent. Replay for humans. Export as video.

Agent Replay is the local, model-agnostic flight recorder for web development.

The browser remembers what a coding agent missed. Agent Replay passively records a bounded, privacy-safe history of a development session and turns it into three useful outputs:

1. **Agent evidence** — deterministic summaries and correlated console, network, error, route, interaction, WebSocket, and DOM evidence.
2. **Human replay** — a synchronized local viewer and portable HTML report.
3. **Video** — after-the-fact replay exports, Playwright verification receipts, and faithful Chrome tab recordings for demos.

## Product contract

- Local by default: loopback receiver, files on disk, no account, cloud, telemetry, or proprietary model.
- Model agnostic: flat files and the CLI are canonical; MCP is a small convenience layer.
- Retrospective: rolling capture preserves the useful minutes before a failure, not just the state after an agent starts looking.
- Portable: a redacted `.areplay` capsule can be opened, inspected, replayed, and shared without a hosted service.
- Trustworthy: every event has stable identity and ordering; sessions cannot cross-write; secret redaction is unconditional.
- Honest: DOM reconstruction is not pixel capture. Canvas, WebGL, maps, video, and cross-origin embeds are called out and true tab capture is recommended.
- Verification oriented: compare broken and fixed sessions and emit a durable fix receipt.

## What Agent Replay is not

It is not another browser controller, production analytics product, hosted observability backend, or autonomous debugger. Native Codex and Claude browser tools are often the best way to inspect what is happening now. Agent Replay preserves what already happened and packages that evidence for any tool that comes next.

## Release boundary

v0.3.0 is a public beta of the artifact contract. The capsule becomes 1.0 only after three real incidents, three clean fix receipts, and successful legacy-session loading. React internals and OTLP correlation remain evidence-gated future work.

The [original April 2026 vision](./docs/ORIGINAL_VISION.md) is preserved alongside this one.
