# playground-vite

Minimal Vite + React playground for testing `@boe-ventures/agent-replay` without Next.js.

## Setup

```bash
# 1. Build the parent package (if not already)
cd .. && pnpm build

# 2. Install dependencies
cd playground-vite && pnpm install

# 3. Start the sidecar (in a separate terminal)
npx agent-replay dev --port 3700

# 4. Start the dev server
pnpm dev   # → http://localhost:3801
```

## Test scenarios

| Button | What it tests |
|--------|---------------|
| 🔢 Counter | `console.log` capture on each click |
| 💥 Throw Runtime Error | Uncaught error capture (`window.onerror`) |
| ✅ Fetch Mock API (200) | Successful network request capture |
| 🚫 Fetch Non-existent (404) | Failed network request capture |

After interacting, check `.agent-replay/latest/` for:
- `console.jsonl` — console logs
- `errors.jsonl` — runtime errors
- `network.jsonl` — network requests/responses
- `summary.md` — LLM-friendly session summary
