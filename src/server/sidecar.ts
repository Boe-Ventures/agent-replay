import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTransportPayload, isUuid } from "../core/schema.js";
import { sanitizeEvent, sanitizePageMetadata, sanitizeSessionMetadata } from "../core/privacy.js";
import { isIncidentTrigger } from "../core/retention.js";
import type { AgentReplayEvent, PrivacyPreset, SessionMetadata, SidecarConfig } from "../core/types.js";
import { generateSummary } from "./summarizer.js";
import { SessionWriter } from "./writer.js";

const DEFAULT_PORT = 3700;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_BATCH_BYTES = 5 * 1024 * 1024;
const DEFAULT_EVENT_COUNT = 5_000;
const DEFAULT_MEDIA_CHUNK = 8 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function originAllowed(origin: string | undefined, configured: string[]): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, "");
  return isLocalOrigin(origin)
    || /^chrome-extension:\/\/[a-p]{32}$/i.test(normalized)
    || configured.includes(normalized);
}

function cors(origin?: string): Record<string, string> {
  return origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Replay-Token, X-Agent-Replay-Session, X-Agent-Replay-Capture, X-Agent-Replay-Final",
    "Access-Control-Max-Age": "600",
    "Access-Control-Allow-Private-Network": "true",
    "Vary": "Origin",
  } : {};
}

function json(res: http.ServerResponse, status: number, value: unknown, origin?: string): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...cors(origin),
  });
  res.end(body);
}

function text(res: http.ServerResponse, status: number, body: string, contentType: string, origin?: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...cors(origin),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function tokenFrom(req: http.IncomingMessage): string | undefined {
  const explicit = req.headers["x-agent-replay-token"];
  if (typeof explicit === "string") return explicit;
  const authorization = req.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

function staticViewerPath(pathname: string): string | null {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../viewer");
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/(?:assets\/)?/, (value) => value.includes("assets") ? "assets/" : "");
  const resolved = path.resolve(root, requested);
  return resolved.startsWith(root + path.sep) || resolved === path.join(root, "index.html") ? resolved : null;
}

export function createSidecar(config: SidecarConfig = {}) {
  const writer = new SessionWriter(config.writerConfig);
  const allowedOrigins = (config.corsOrigins ?? []).map((value) => value.replace(/\/$/, ""));
  const maxBatchBytes = config.maxBatchBytes ?? DEFAULT_BATCH_BYTES;
  const maxEvents = config.maxEventsPerBatch ?? DEFAULT_EVENT_COUNT;
  const maxMediaChunk = config.maxMediaChunkBytes ?? DEFAULT_MEDIA_CHUNK;
  const subscribers = new Set<http.ServerResponse>();

  const publish = (events: AgentReplayEvent[]): void => {
    if (subscribers.size === 0) return;
    const payload = "data: " + JSON.stringify(events) + "\n\n";
    for (const subscriber of subscribers) subscriber.write(payload);
  };

  const server = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin.replace(/\/$/, "") : undefined;
    const requestOrigin = `http://${req.headers.host ?? "localhost"}`;
    const requestIsCrossOrigin = Boolean(origin && origin !== requestOrigin);
    const configuredHost = config.host ?? DEFAULT_HOST;
    const requiresToken = !LOOPBACK.has(configuredHost) || Boolean(config.token);
    const authenticated = !requiresToken || (Boolean(config.token) && tokenFrom(req) === config.token);

    if (req.method === "OPTIONS") {
      if (!originAllowed(origin, allowedOrigins)) return json(res, 403, { error: "Origin not allowed" });
      res.writeHead(204, cors(origin));
      return res.end();
    }
    if (!originAllowed(origin, allowedOrigins)) return json(res, 403, { error: "Origin not allowed" });
    if (requiresToken && !authenticated) return json(res, 401, { error: "A valid Agent Replay token is required" }, origin);

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const isWrite = req.method === "POST";
    if (requestIsCrossOrigin && !isWrite && pathname !== "/api/v1/health" && pathname !== "/health") {
      return json(res, 403, { error: "Cross-origin access is write-only" }, origin);
    }

    try {
      if (req.method === "POST" && ["/api/v1/events", "/events"].includes(pathname)) {
        const raw = await readBody(req, maxBatchBytes);
        const payload = parseTransportPayload(JSON.parse(raw.toString("utf8")));
        if (payload.events.length > maxEvents) return json(res, 413, { error: "Too many events in batch" }, origin);
        const sessionId = payload.events[0]?.sessionId ?? payload.sessionMetadata?.id;
        if (!sessionId) return json(res, 400, { error: "At least one event is required" }, origin);
        if (payload.events.some((event) => event.sessionId !== sessionId)) {
          return json(res, 400, { error: "A batch may contain only one session" }, origin);
        }
        const rawMetadata: SessionMetadata = payload.sessionMetadata ?? {
          id: sessionId,
          startedAt: new Date(payload.events[0]?.timestamp ?? Date.now()).toISOString(),
          status: "active",
          mode: "rolling",
          privacyPreset: "safe",
          url: "",
          userAgent: "",
          viewport: { width: 0, height: 0 },
        };
        const preset: PrivacyPreset = rawMetadata.privacyPreset ?? "safe";
        const redaction = undefined;
        const metadata = sanitizeSessionMetadata(rawMetadata, redaction);
        const pageMetadata = sanitizePageMetadata(payload.pageMetadata, redaction);
        writer.initSession(sessionId, metadata, pageMetadata);
        const sanitized = payload.events.map((event) => sanitizeEvent(event, { privacyPreset: preset, redaction }, metadata.url));
        writer.writeEvents(sanitized);
        if (sanitized.some((event) => isIncidentTrigger(event))) {
          const trigger = sanitized.find((event) => isIncidentTrigger(event));
          writer.markPinned(sessionId, trigger?.type === "marker" ? "manual marker" : "captured failure");
        }
        generateSummary(writer, sessionId);
        publish(sanitized);
        return json(res, 200, { ok: true, received: sanitized.length, sessionId }, origin);
      }

      if (req.method === "POST" && pathname === "/api/v1/media") {
        const sessionId = String(req.headers["x-agent-replay-session"] ?? "");
        const captureId = String(req.headers["x-agent-replay-capture"] ?? "");
        if (!isUuid(sessionId) || !isUuid(captureId)) return json(res, 400, { error: "Valid session and capture UUID headers are required" }, origin);
        const chunk = await readBody(req, maxMediaChunk);
        writer.appendMediaChunk(sessionId, captureId, chunk);
        const final = req.headers["x-agent-replay-final"] === "true";
        const output = final ? writer.finalizeMedia(sessionId, captureId) : undefined;
        return json(res, 200, { ok: true, bytes: chunk.byteLength, final, output }, origin);
      }

      if (req.method === "POST" && pathname === "/api/v1/mark") {
        const raw = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8")) as {
          sessionId: string; pageId: string; label: string; metadata?: Record<string, unknown>; triggerIncident?: boolean;
        };
        if (!isUuid(raw.sessionId) || !isUuid(raw.pageId) || !raw.label) return json(res, 400, { error: "sessionId, pageId, and label are required" }, origin);
        const manifest = writer.readManifest(raw.sessionId);
        const started = new Date(manifest?.session.startedAt ?? Date.now()).getTime();
        const event: AgentReplayEvent = {
          id: crypto.randomUUID(), type: "marker", sequence: Date.now(), timestamp: Date.now(),
          offsetMs: Math.max(0, Date.now() - started), sessionId: raw.sessionId, pageId: raw.pageId,
          data: { timestamp: Date.now(), offsetMs: Math.max(0, Date.now() - started), label: raw.label, metadata: raw.metadata, triggerIncident: raw.triggerIncident },
        };
        writer.writeEvents([event]);
        if (raw.triggerIncident) writer.markPinned(raw.sessionId, raw.label);
        generateSummary(writer, raw.sessionId);
        publish([event]);
        return json(res, 200, { ok: true, event }, origin);
      }

      if (req.method === "GET" && ["/api/v1/health", "/health"].includes(pathname)) {
        return json(res, 200, { status: "ok", schemaVersion: 1, latestSession: writer.getLatestSessionId() }, origin);
      }
      if (req.method === "GET" && ["/api/v1/sessions", "/sessions"].includes(pathname)) {
        return json(res, 200, { sessions: writer.listSessions() }, origin);
      }

      const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-f-]+)(?:\/(summary|timeline|errors|network|manifest|report))?$/i);
      if (req.method === "GET" && sessionMatch) {
        const sessionId = sessionMatch[1]!;
        if (!isUuid(sessionId)) return json(res, 400, { error: "Invalid session ID" }, origin);
        const resource = sessionMatch[2] ?? "manifest";
        if (resource === "summary") {
          const markdown = generateSummary(writer, sessionId);
          return markdown ? text(res, 200, markdown, "text/markdown; charset=utf-8", origin) : json(res, 404, { error: "Session not found" }, origin);
        }
        if (resource === "timeline") return json(res, 200, { events: writer.readJsonl("timeline.jsonl", sessionId) }, origin);
        if (resource === "errors") return json(res, 200, { errors: writer.readJsonl("errors.jsonl", sessionId) }, origin);
        if (resource === "network") return json(res, 200, { network: writer.readJsonl("network.jsonl", sessionId) }, origin);
        if (resource === "report") {
          const file = path.join(writer.getSessionDir(sessionId), "report.html");
          return fs.existsSync(file) ? text(res, 200, fs.readFileSync(file, "utf8"), "text/html; charset=utf-8", origin) : json(res, 404, { error: "Report not generated" }, origin);
        }
        const manifest = writer.readManifest(sessionId);
        return manifest ? json(res, 200, manifest, origin) : json(res, 404, { error: "Session not found" }, origin);
      }

      if (req.method === "GET" && ["/api/v1/watch", "/stream"].includes(pathname)) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...cors(origin) });
        res.write(": agent-replay live stream\n\n");
        subscribers.add(res);
        req.on("close", () => subscribers.delete(res));
        return;
      }

      const legacyMatch = pathname.match(/^\/sessions\/(latest|[0-9a-f-]+)\/(summary|errors|network)$/i);
      if (req.method === "GET" && legacyMatch) {
        const sessionId = legacyMatch[1] === "latest" ? writer.getLatestSessionId() : legacyMatch[1];
        if (!sessionId || !isUuid(sessionId)) return json(res, 404, { error: "Session not found", deprecated: true }, origin);
        res.setHeader("Deprecation", "true");
        res.setHeader("Link", `</api/v1/sessions/${sessionId}/${legacyMatch[2]}>; rel="successor-version"`);
        if (legacyMatch[2] === "summary") return text(res, 200, generateSummary(writer, sessionId) ?? "", "text/markdown; charset=utf-8", origin);
        return json(res, 200, { [legacyMatch[2]]: writer.readJsonl(legacyMatch[2] + ".jsonl", sessionId), deprecated: true }, origin);
      }

      if (req.method === "GET") {
        const viewerFile = staticViewerPath(pathname);
        if (viewerFile && fs.existsSync(viewerFile) && fs.statSync(viewerFile).isFile()) {
          const extension = path.extname(viewerFile);
          const contentType = extension === ".html" ? "text/html; charset=utf-8"
            : extension === ".js" ? "text/javascript; charset=utf-8"
              : extension === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
          return text(res, 200, fs.readFileSync(viewerFile, "utf8"), contentType, origin);
        }
      }
      return json(res, 404, { error: "Not found" }, origin);
    } catch (error) {
      const status = typeof error === "object" && error && "statusCode" in error ? Number((error as { statusCode: number }).statusCode) : 400;
      return json(res, status, { error: error instanceof Error ? error.message : "Request failed" }, origin);
    }
  });

  return {
    server,
    writer,
    start: () => new Promise<void>((resolve, reject) => {
      const host = config.host ?? DEFAULT_HOST;
      if (!LOOPBACK.has(host) && !config.token) return reject(new Error("Non-loopback operation requires an explicit token"));
      server.once("error", reject);
      server.listen(config.port ?? DEFAULT_PORT, host, () => {
        server.off("error", reject);
        console.log(`[agent-replay] http://${host}:${config.port ?? DEFAULT_PORT}`);
        resolve();
      });
    }),
    stop: () => new Promise<void>((resolve, reject) => {
      for (const session of writer.listSessions().filter((candidate) => candidate.metadata?.status === "active")) {
        generateSummary(writer, session.id);
        writer.closeSession(session.id);
      }
      for (const subscriber of subscribers) subscriber.end();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
