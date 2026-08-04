import * as fs from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import type { AgentReplayEvent } from "../core/types.js";
import { generateSummary } from "./summarizer.js";
import { renderPortableReport } from "./report.js";
import { SessionWriter } from "./writer.js";

function collect(directory: string, root: string, noMedia: boolean, output: Record<string, Uint8Array>): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.endsWith(".partial")) continue;
    const filePath = path.join(directory, entry.name);
    const relative = path.relative(root, filePath).split(path.sep).join("/");
    if (noMedia && relative.startsWith("media/")) continue;
    if (entry.isDirectory()) collect(filePath, root, noMedia, output);
    else output[relative] = new Uint8Array(fs.readFileSync(filePath));
  }
}

export function packSession(
  writer: SessionWriter,
  sessionId: string,
  options: { output?: string; noMedia?: boolean } = {},
): string {
  const manifest = writer.readManifest(sessionId);
  if (!manifest) throw new Error("Session not found or is still a legacy v0.2 session");
  const summary = generateSummary(writer, sessionId) ?? "";
  const timeline = writer.readJsonl<AgentReplayEvent>("timeline.jsonl", sessionId);
  const report = renderPortableReport(manifest, timeline, summary);
  writer.writeReport(sessionId, report);
  const files: Record<string, Uint8Array> = {};
  collect(writer.getSessionDir(sessionId), writer.getSessionDir(sessionId), options.noMedia ?? false, files);
  files["capsule.json"] = strToU8(JSON.stringify({
    format: "agent-replay-capsule",
    schemaVersion: 1,
    sessionId,
    packedAt: new Date().toISOString(),
    includesMedia: !(options.noMedia ?? false),
  }, null, 2));
  const output = path.resolve(options.output ?? sessionId + ".areplay");
  fs.writeFileSync(output, zipSync(files, { level: 6 }), { mode: 0o600 });
  return output;
}
