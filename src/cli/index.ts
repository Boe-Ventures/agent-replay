#!/usr/bin/env node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import type { AgentReplayEvent, ExportOptions } from "../core/types.js";
import { createSidecar } from "../server/sidecar.js";
import { SessionWriter } from "../server/writer.js";
import { generateSummary, inspectSession } from "../server/summarizer.js";
import { packSession } from "../server/capsule.js";
import { listLegacySessions, migrateLegacySession } from "../server/legacy.js";
import { writeComparison } from "../server/compare.js";
import { exportReplayVideo } from "../server/replay-export.js";
import { findExecutable, postProcessVideo } from "../server/video.js";
import { runMcpServer } from "../mcp/index.js";
import { parseCliArgs } from "./args.js";

const parsedArgs = parseCliArgs(process.argv.slice(2));
const command = parsedArgs.command;
const positionals = parsedArgs.positionals;

function flag(name: string): string | undefined {
  return parsedArgs.flags.get(name);
}
function bool(name: string): boolean { return parsedArgs.booleans.has(name); }
function numberFlag(name: string, fallback?: number): number | undefined {
  const value = flag(name);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("--" + name + " must be a number");
  return parsed;
}
function output(value: unknown): void {
  process.stdout.write(typeof value === "string" ? value + (value.endsWith("\n") ? "" : "\n") : JSON.stringify(value, null, 2) + "\n");
}
function session(writer: SessionWriter, explicit?: string): string {
  const id = explicit ?? flag("session") ?? writer.getLatestSessionId();
  if (!id) throw new Error("No session found. Start Agent Replay and use the app first.");
  return id;
}
function openUrl(url: string): void {
  const executable = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", url] : [url];
  spawn(executable, args, { detached: true, stdio: "ignore" }).unref();
}

async function watch(baseUrl: string): Promise<void> {
  const response = await fetch(baseUrl + "/api/v1/watch");
  if (!response.ok || !response.body) throw new Error("Unable to connect to live stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split("\n\n");
    buffer = records.pop() ?? "";
    for (const record of records) {
      const line = record.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (line) for (const event of JSON.parse(line.slice(6)) as AgentReplayEvent[]) output(event);
    }
  }
}

function help(): void {
  output(`agent-replay 0.3.0 — local flight recorder for web development

Capture
  dev [--port 3700] [--host 127.0.0.1]   Run receiver and viewer
  mark <label> [--incident]                Add a timestamped marker
  watch                                    Stream new evidence

Inspect
  view [session]                           Open the synchronized local viewer
  sessions [--json]                        List sessions and incidents
  inspect [session] [--budget 4000]        Deterministic agent-ready evidence
  timeline [session] [--around ms]         Normalized event timeline
  errors [session]                         Errors only
  network [session] [--failures]           Network evidence

Package and verify
  pack [session] [--no-media]              Create a portable .areplay capsule
  export [session] --format mp4             Export replay video/media
  compare <before> <after>                  Write a fix receipt
  receipt <before> <after>                  Compare and optionally export video

Operate
  doctor                                   Check Chrome, Playwright, and FFmpeg
  migrate [legacy-id|--all]                Explicitly migrate v0.2 sessions
  clean [--keep 20|--all]                  Apply retention or remove recordings
  mcp                                      Run the small stdio MCP server

Safe privacy and rolling capture are the defaults. Documentation: https://boe-ventures.github.io/agent-replay/`);
}

async function main(): Promise<void> {
  const writer = new SessionWriter({ baseDir: flag("dir") });
  if (command === "dev" || command === "view") {
    const port = numberFlag("port", 3700)!;
    const host = flag("host") ?? "127.0.0.1";
    const sidecar = createSidecar({
      port, host, token: flag("token"),
      writerConfig: { baseDir: flag("dir"), maxDiskBytes: numberFlag("max-disk-mb") ? numberFlag("max-disk-mb")! * 1024 * 1024 : undefined },
      corsOrigins: flag("origins")?.split(","),
      cleanupConfig: { maxSessions: numberFlag("max-sessions", 20), maxAgeHours: numberFlag("max-age", 24 * 7), preserveLogs: bool("preserve") },
    });
    await sidecar.start();
    const id = command === "view" ? positionals[0] ?? writer.getLatestSessionId() : undefined;
    const url = `http://${host}:${port}/${id ? "?session=" + id : ""}`;
    if (!bool("no-open") && command === "view") openUrl(url);
    output(command === "view" ? "Viewer: " + url : "Recording locally. Viewer: " + url);
    await new Promise<void>((resolve) => {
      const stop = async () => { await sidecar.stop(); resolve(); };
      process.once("SIGINT", () => void stop());
      process.once("SIGTERM", () => void stop());
    });
    return;
  }
  if (command === "sessions") {
    const sessions = writer.listSessions();
    if (bool("json")) return output(sessions);
    if (!sessions.length) return output("No v1 sessions found.");
    for (const item of sessions) output(`${item.id}  ${item.metadata?.pinned ? "PINNED" : "      "}  ${item.metadata?.startedAt ?? ""}  ${item.metadata?.url ?? ""}`);
    const legacy = listLegacySessions(writer.baseDir);
    if (legacy.length) output(`\n${legacy.length} legacy v0.2 session(s) available via migrate.`);
    return;
  }
  if (command === "inspect" || command === "summary") {
    if (command === "summary") process.stderr.write("[agent-replay] summary is deprecated; use inspect.\n");
    return output(command === "summary"
      ? generateSummary(writer, positionals[0] ?? flag("session")) ?? ""
      : inspectSession(writer, positionals[0] ?? flag("session"), numberFlag("budget", 4000)!));
  }
  if (command === "timeline") {
    const id = session(writer, positionals[0]);
    let events = writer.readJsonl<AgentReplayEvent>("timeline.jsonl", id);
    const around = numberFlag("around");
    if (around != null) events = events.filter((event) => Math.abs(event.offsetMs - around) <= numberFlag("window", 5000)!);
    const type = flag("type");
    if (type) events = events.filter((event) => event.type === type);
    return output(events);
  }
  if (command === "errors") return output(writer.readJsonl("errors.jsonl", session(writer, positionals[0])));
  if (command === "network") {
    let events = writer.readJsonl<AgentReplayEvent>("network.jsonl", session(writer, positionals[0]));
    if (bool("failures")) events = events.filter((event) => {
      const status = (event.data as { status?: number | null }).status;
      return status == null || status >= 400;
    });
    return output(events);
  }
  if (command === "watch") return watch(flag("url") ?? "http://127.0.0.1:3700");
  if (command === "mark") {
    const id = session(writer);
    const manifest = writer.readManifest(id);
    if (!manifest) throw new Error("Markers require a v1 session");
    const now = Date.now();
    const event: AgentReplayEvent = {
      id: crypto.randomUUID(), type: "marker", sequence: now, timestamp: now,
      offsetMs: Math.max(0, now - new Date(manifest.session.startedAt).getTime()),
      sessionId: id, pageId: manifest.pages.at(-1)?.id ?? crypto.randomUUID(),
      data: { timestamp: now, offsetMs: 0, label: positionals.join(" ") || "Manual marker", triggerIncident: bool("incident") },
    };
    writer.writeEvents([event]);
    if (bool("incident")) writer.markPinned(id, String((event.data as { label: string }).label));
    generateSummary(writer, id);
    return output(event);
  }
  if (command === "pack") {
    const id = session(writer, positionals[0]);
    return output({ output: packSession(writer, id, { output: flag("output"), noMedia: bool("no-media") }) });
  }
  if (command === "export") {
    const id = session(writer, positionals[0]);
    const options: ExportOptions = {
      format: (flag("format") ?? "webm") as ExportOptions["format"],
      preset: (flag("preset") ?? "debug") as ExportOptions["preset"],
      fromMs: numberFlag("from"), toMs: numberFlag("to"), title: flag("title"), outro: flag("outro"),
      captions: bool("captions"), emphasizeClicks: !bool("no-clicks"), removeIdle: bool("remove-idle"),
      audio: bool("audio"), output: flag("output"),
    };
    if (flag("source") === "tab") {
      const media = path.join(writer.getSessionDir(id), "media");
      const source = fs.readdirSync(media).filter((file) => file.endsWith(".webm") && file !== "replay.webm")
        .map((file) => path.join(media, file)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (!source) throw new Error("No finalized Chrome tab capture found for this session");
      return output({ source, output: postProcessVideo(source, options), warnings: [] });
    }
    return output(await exportReplayVideo(writer, id, options));
  }
  if (command === "compare" || command === "receipt") {
    const before = positionals[0];
    const after = positionals[1];
    if (!before || !after) throw new Error(command + " requires before and after session IDs");
    const directory = path.resolve(flag("output") ?? path.join(".agent-replay", "receipts", before + "--" + after));
    const result = writeComparison(writer, before, after, directory);
    let video: unknown;
    if (command === "receipt" && bool("video")) {
      const format = (flag("format") ?? "mp4") as ExportOptions["format"];
      video = {
        before: await exportReplayVideo(writer, before, { format, preset: "launch", output: path.join(directory, "before." + format), title: "Before", emphasizeClicks: true }),
        after: await exportReplayVideo(writer, after, { format, preset: "launch", output: path.join(directory, "after." + format), title: "After — fix verified", emphasizeClicks: true }),
      };
    }
    return output({ ...result, video });
  }
  if (command === "doctor") {
    const executable = chromium.executablePath();
    const ffmpeg = findExecutable("ffmpeg");
    const ffprobe = findExecutable("ffprobe");
    const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", executable].find((candidate) => fs.existsSync(candidate));
    const checks = {
      node: { ok: Number(process.versions.node.split(".")[0]) >= 18, version: process.versions.node },
      playwright: { ok: fs.existsSync(executable), executable, fix: "Run: bunx playwright install chromium" },
      chrome: { ok: Boolean(chrome), executable: chrome ?? null, fix: "Install current Google Chrome for extension demo capture." },
      ffmpeg: { ok: Boolean(ffmpeg), executable: ffmpeg, fix: "Install FFmpeg for MP4, GIF, poster, storyboard, and social exports." },
      ffprobe: { ok: Boolean(ffprobe), executable: ffprobe },
    };
    output(checks);
    if (Object.values(checks).some((check) => !check.ok)) process.exitCode = 1;
    return;
  }
  if (command === "migrate") {
    const legacy = listLegacySessions(writer.baseDir);
    const targets = bool("all") ? legacy.map((item) => item.id) : [positionals[0]].filter(Boolean) as string[];
    if (!targets.length) return output(legacy);
    return output(targets.map((id) => ({ legacyId: id, sessionId: migrateLegacySession(writer, id) })));
  }
  if (command === "clean") {
    if (bool("all")) return output(writer.cleanAll());
    return output(writer.cleanup({ maxSessions: numberFlag("keep", 20), maxAgeHours: numberFlag("max-age", 24 * 7), preserveLogs: bool("preserve") }));
  }
  if (command === "mcp") return runMcpServer(writer);
  help();
  if (!["help", "--help", "-h"].includes(command)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write("[agent-replay] " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
