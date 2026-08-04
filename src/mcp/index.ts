import * as readline from "node:readline";
import { SessionWriter } from "../server/writer.js";
import { inspectSession } from "../server/summarizer.js";
import { compareSessions } from "../server/compare.js";
import { packSession } from "../server/capsule.js";

type Request = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const tools = [
  { name: "list_sessions", description: "List local Agent Replay sessions", inputSchema: { type: "object", properties: {} } },
  { name: "inspect_session", description: "Return a deterministic, context-budgeted session inspection", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, budget: { type: "number", default: 4000 } } } },
  { name: "get_timeline", description: "Get the normalized correlated timeline", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] } },
  { name: "compare_sessions", description: "Compare a broken session with an after-fix session", inputSchema: { type: "object", properties: { before: { type: "string" }, after: { type: "string" } }, required: ["before", "after"] } },
  { name: "export_session", description: "Pack a session as a portable .areplay capsule", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, output: { type: "string" }, noMedia: { type: "boolean" } }, required: ["sessionId"] } },
];

export function createMcpHandler(writer = new SessionWriter()) {
  return async (request: Request): Promise<Record<string, unknown> | null> => {
    if (request.method === "notifications/initialized") return null;
    if (request.method === "initialize") {
      return { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "agent-replay", version: "0.3.0" } };
    }
    if (request.method === "tools/list") return { tools };
    if (request.method === "tools/call") {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      let value: unknown;
      if (name === "list_sessions") value = writer.listSessions();
      else if (name === "inspect_session") value = inspectSession(writer, args.sessionId as string | undefined, Number(args.budget ?? 4000));
      else if (name === "get_timeline") value = writer.readJsonl("timeline.jsonl", String(args.sessionId));
      else if (name === "compare_sessions") value = compareSessions(writer, String(args.before), String(args.after));
      else if (name === "export_session") value = { output: packSession(writer, String(args.sessionId), { output: args.output as string | undefined, noMedia: Boolean(args.noMedia) }) };
      else throw new Error("Unknown tool: " + name);
      return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
    }
    throw new Error("Unknown method: " + request.method);
  };
}

export async function runMcpServer(writer = new SessionWriter()): Promise<void> {
  const handle = createMcpHandler(writer);
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: Request;
    try { request = JSON.parse(line) as Request; }
    catch { continue; }
    try {
      const result = await handle(request);
      if (request.id != null && result) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    } catch (error) {
      if (request.id != null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: error instanceof Error ? error.message : "MCP error" } }) + "\n");
    }
  }
}
