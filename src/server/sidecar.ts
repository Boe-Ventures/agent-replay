import * as http from "node:http";
import * as crypto from "node:crypto";
import type {
  SidecarConfig,
  CleanupConfig,
  AgentReplayEvent,
  SessionMetadata,
} from "../core/types.js";
import { SessionWriter } from "./writer.js";
import { generateSummary } from "./summarizer.js";

const DEFAULT_PORT = 3700;
const DEFAULT_HOST = "0.0.0.0";

interface ParsedRequest {
  method: string;
  pathname: string;
  body: string;
}

function parseUrl(url: string): URL {
  return new URL(url, "http://localhost");
}

function corsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(
  res: http.ServerResponse,
  status: number,
  data: unknown,
  origin?: string
): void {
  const body = JSON.stringify(data);
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

export function createSidecar(config: SidecarConfig = {}): {
  server: http.Server;
  writer: SessionWriter;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const writer = new SessionWriter(config.writerConfig);
  const cleanupConfig = config.cleanupConfig;
  const activeSessions = new Map<string, boolean>();

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? req.headers.referer;
    const originStr = typeof origin === "string" ? origin.replace(/\/$/, "") : undefined;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(originStr));
      res.end();
      return;
    }

    const parsed = parseUrl(req.url ?? "/");
    const pathname = parsed.pathname;

    try {
      // POST /events — receive batched events
      if (req.method === "POST" && pathname === "/events") {
        const body = await readBody(req);
        const payload = JSON.parse(body) as {
          events: AgentReplayEvent[];
          sessionMetadata?: SessionMetadata;
        };

        if (payload.events.length > 0) {
          // Validate/generate sessionId
          let sessionId = payload.events[0]!.sessionId;
          if (!sessionId) {
            sessionId = crypto.randomUUID();
            // Backfill sessionId on all events in the batch
            for (const event of payload.events) {
              event.sessionId = sessionId;
            }
          }

          // Initialize session dir if new
          if (!activeSessions.has(sessionId)) {
            writer.initSession(sessionId);
            activeSessions.set(sessionId, true);
            if (payload.sessionMetadata) {
              writer.writeMetadata(payload.sessionMetadata);
            }
            // Auto-cleanup old sessions
            if (cleanupConfig) {
              try { writer.cleanup(cleanupConfig); } catch { /* best effort */ }
            }
          }

          writer.writeEvents(payload.events);
        }

        json(res, 200, { ok: true, received: payload.events.length }, originStr);
        return;
      }

      // GET /sessions — list sessions
      if (req.method === "GET" && pathname === "/sessions") {
        const sessions = writer.listSessions();
        json(res, 200, { sessions }, originStr);
        return;
      }

      // GET /sessions/latest/summary
      if (
        req.method === "GET" &&
        pathname === "/sessions/latest/summary"
      ) {
        const markdown = generateSummary(writer);
        if (markdown) {
          res.writeHead(200, {
            "Content-Type": "text/markdown",
            ...corsHeaders(originStr),
          });
          res.end(markdown);
        } else {
          json(res, 404, { error: "No session found" }, originStr);
        }
        return;
      }

      // GET /sessions/latest/errors
      if (
        req.method === "GET" &&
        pathname === "/sessions/latest/errors"
      ) {
        const errors = writer.readJsonl("errors.jsonl");
        json(res, 200, { errors }, originStr);
        return;
      }

      // GET /sessions/latest/network
      if (
        req.method === "GET" &&
        pathname === "/sessions/latest/network"
      ) {
        const network = writer.readJsonl("network.jsonl");
        json(res, 200, { network }, originStr);
        return;
      }

      // GET /health
      if (req.method === "GET" && pathname === "/health") {
        json(
          res,
          200,
          {
            status: "ok",
            activeSessions: activeSessions.size,
            latestSession: writer.getLatestSessionId(),
          },
          originStr
        );
        return;
      }

      // 404
      json(res, 404, { error: "Not found" }, originStr);
    } catch (err) {
      console.error("[agent-replay sidecar] Error:", err);
      json(
        res,
        500,
        { error: err instanceof Error ? err.message : "Internal error" },
        originStr
      );
    }
  });

  return {
    server,
    writer,
    start: () =>
      new Promise<void>((resolve) => {
        const port = config.port ?? DEFAULT_PORT;
        const host = config.host ?? DEFAULT_HOST;
        server.listen(port, host, () => {
          console.log(
            `[agent-replay] Sidecar running at http://${host}:${port}`
          );
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        // Generate summary for all active sessions before shutting down
        for (const sessionId of activeSessions.keys()) {
          try {
            generateSummary(writer, sessionId);
          } catch {
            // Best effort
          }
        }
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
