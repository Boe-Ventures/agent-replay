# Agent Instructions

This is a Next.js playground app for testing `@boe-ventures/agent-replay`.

The app is a simple task manager with deliberate bugs. Your job is to find and fix them using session recordings.

## Session Recordings

When the app is running with the agent-replay sidecar, session recordings are captured to `.agent-replay/` in the **repo root** (one level up from this playground).

After navigating the app or triggering actions, check these files for debugging info:

- `.agent-replay/latest/errors.jsonl` — Runtime errors with stack traces (**CHECK THIS FIRST**)
- `.agent-replay/latest/network.jsonl` — All fetch/XHR requests with status codes and timing
- `.agent-replay/latest/console.jsonl` — Console logs, warnings, errors
- `.agent-replay/latest/summary.md` — Human-readable overview of the session

You can also use the CLI:
```bash
node dist/cli/index.js summary     # Pretty-printed session summary
node dist/cli/index.js errors      # Just the errors
node dist/cli/index.js network --failures  # Failed network requests
```

## Dev Setup

- **Sidecar server:** port 3700 — start with `node ../dist/cli/index.js dev` from this directory (or `node dist/cli/index.js dev` from repo root)
- **Next.js app:** port 3800 — start with `PORT=3800 pnpm dev` in this directory
- **Browser automation:** `agent-browser` is available globally for headless interaction

## Your Task

The app has several bugs. Use the session recordings to identify and fix them.

### Workflow

1. **Start servers** (if not already running):
   ```bash
   # From repo root
   node dist/cli/index.js dev &
   cd playground && PORT=3800 pnpm dev &
   ```

2. **Trigger the bugs** — use agent-browser to interact with the app:
   ```bash
   agent-browser open http://localhost:3800
   agent-browser wait --load networkidle
   agent-browser snapshot -i --json
   # Fill in the task input and click Add Task
   # Click Delete All Tasks
   ```

3. **Read the recordings**:
   ```bash
   cat ../.agent-replay/latest/errors.jsonl
   cat ../.agent-replay/latest/network.jsonl
   cat ../.agent-replay/latest/console.jsonl
   ```

4. **Diagnose from recordings** — errors.jsonl will contain runtime errors with stack traces pointing to source files. network.jsonl will show failed requests with status codes. console.jsonl will show React warnings.

5. **Fix the bugs** in `app/page.tsx` and `app/api/tasks/route.ts`

6. **Verify** by re-running the app and checking that recordings are clean.

## Architecture

```
playground/
├── app/
│   ├── layout.tsx          # Root layout with AgentReplayProvider
│   ├── page.tsx            # Task list UI (client component)
│   └── api/
│       └── tasks/
│           └── route.ts    # GET, POST handlers for tasks
├── CLAUDE.md               # This file
└── package.json
```

The `AgentReplayProvider` in layout.tsx automatically captures DOM changes, console output, network requests, and errors — sending them to the sidecar on port 3700.
