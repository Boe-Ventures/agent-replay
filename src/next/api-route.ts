import { parseTransportPayload } from "../core/schema.js";
import { sanitizeEvent } from "../core/privacy.js";
import { SessionWriter } from "../server/writer.js";
import { generateSummary } from "../server/summarizer.js";

const writer = new SessionWriter();

interface NextRequest {
  url?: string;
  json: () => Promise<unknown>;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const payload = parseTransportPayload(await request.json());
    const sessionId = payload.events[0]?.sessionId ?? payload.sessionMetadata?.id;
    if (!sessionId) return Response.json({ error: "At least one event is required" }, { status: 400 });
    const metadata = payload.sessionMetadata ?? {
      id: sessionId,
      startedAt: new Date(payload.events[0]?.timestamp ?? Date.now()).toISOString(),
      status: "active" as const,
      mode: "rolling" as const,
      privacyPreset: "safe" as const,
      url: "",
      userAgent: "",
      viewport: { width: 0, height: 0 },
    };
    writer.initSession(sessionId, metadata, payload.pageMetadata);
    writer.writeEvents(payload.events.map((event) =>
      sanitizeEvent(event, { privacyPreset: metadata.privacyPreset ?? "safe" }, metadata.url),
    ));
    generateSummary(writer, sessionId);
    return Response.json({ ok: true, received: payload.events.length, sessionId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    schemaVersion: 1,
    latestSession: writer.getLatestSessionId(),
  });
}
