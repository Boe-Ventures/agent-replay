import * as crypto from "node:crypto";
import type { AgentReplayEvent, SessionMetadata } from "../core/types.js";
import { SessionWriter } from "../server/writer.js";

const writer = new SessionWriter();
const activeSessions = new Set<string>();

interface NextRequest {
  method: string;
  json: () => Promise<unknown>;
}

/**
 * Next.js App Router API route handler for receiving agent-replay events.
 *
 * Usage in `app/api/__agent-replay/events/route.ts`:
 * ```ts
 * export { POST } from "@boe-ventures/agent-replay/next";
 * ```
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const payload = (await request.json()) as {
      events: AgentReplayEvent[];
      sessionMetadata?: SessionMetadata;
    };

    if (payload.events.length > 0) {
      let sessionId = payload.events[0]!.sessionId;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        for (const event of payload.events) {
          event.sessionId = sessionId;
        }
      }

      if (!activeSessions.has(sessionId)) {
        writer.initSession(sessionId);
        activeSessions.add(sessionId);
        if (payload.sessionMetadata) {
          writer.writeMetadata(payload.sessionMetadata);
        }
      }

      writer.writeEvents(payload.events);
    }

    return new Response(
      JSON.stringify({ ok: true, received: payload.events.length }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Health check endpoint for the Next.js API route.
 *
 * Usage in `app/api/__agent-replay/health/route.ts`:
 * ```ts
 * export { GET } from "@boe-ventures/agent-replay/next";
 * ```
 */
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: "ok",
      activeSessions: activeSessions.size,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
