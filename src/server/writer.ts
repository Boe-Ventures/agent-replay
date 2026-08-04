import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentReplayEvent,
  AgentReplayEventType,
  CleanupConfig,
  PageMetadata,
  ReplayManifest,
  SessionMetadata,
  WriterConfig,
} from "../core/types.js";
import { createManifest, isUuid } from "../core/schema.js";
import { DEFAULT_RETENTION } from "../core/retention.js";

const DEFAULT_BASE_DIR = ".agent-replay";
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_MAX_SESSION_SIZE = 500 * 1024 * 1024;
const DEFAULT_MAX_DISK = 2 * 1024 * 1024 * 1024;

const SIGNAL_FILES: Record<AgentReplayEventType, string> = {
  rrweb: "events.jsonl",
  console: "console.jsonl",
  network: "network.jsonl",
  websocket: "websocket.jsonl",
  error: "errors.jsonl",
  interaction: "interactions.jsonl",
  "route-change": "routes.jsonl",
  marker: "markers.jsonl",
  performance: "performance.jsonl",
  "playwright-step": "playwright-steps.jsonl",
};

function atomicWrite(filePath: string, content: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + "." + crypto.randomUUID() + ".partial";
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function directorySize(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    total += entry.isDirectory() ? directorySize(filePath) : fs.statSync(filePath).size;
  }
  return total;
}

export class SessionWriter {
  readonly baseDir: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxSessionSizeBytes: number;
  private readonly maxDiskBytes: number;
  private fileSizes = new Map<string, number>();
  private errorFingerprints = new Map<string, Set<string>>();
  private nextSequences = new Map<string, number>();

  constructor(config: WriterConfig = {}) {
    this.baseDir = path.resolve(config.baseDir ?? DEFAULT_BASE_DIR);
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    this.maxSessionSizeBytes = config.maxSessionSizeBytes ?? DEFAULT_MAX_SESSION_SIZE;
    this.maxDiskBytes = config.maxDiskBytes ?? DEFAULT_MAX_DISK;
  }

  private validateSessionId(sessionId: string): void {
    if (!isUuid(sessionId)) throw new Error("Session ID must be a UUID");
  }

  getSessionDir(sessionId: string): string {
    this.validateSessionId(sessionId);
    return path.join(this.baseDir, "sessions", sessionId);
  }

  initSession(sessionId: string, metadata?: SessionMetadata, page?: PageMetadata): string {
    this.validateSessionId(sessionId);
    const sessionDir = this.getSessionDir(sessionId);
    fs.mkdirSync(path.join(sessionDir, "media"), { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "exports"), { recursive: true });

    let manifest = this.readManifest(sessionId);
    if (!manifest) {
      const session = metadata ?? {
        id: sessionId,
        startedAt: new Date().toISOString(),
        status: "active",
        mode: "rolling",
        privacyPreset: "safe",
        url: "",
        userAgent: "",
        viewport: { width: 0, height: 0 },
      };
      manifest = createManifest(session);
    } else if (metadata) {
      manifest.session = { ...manifest.session, ...metadata, id: sessionId, schemaVersion: 1 };
    }
    if (page && !manifest.pages.some((candidate) => candidate.id === page.id)) manifest.pages.push(page);
    manifest.updatedAt = new Date().toISOString();
    this.writeManifest(sessionId, manifest);
    this.writeLatest(sessionId);
    return sessionDir;
  }

  private writeLatest(sessionId: string): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const link = path.join(this.baseDir, "latest");
    const temporary = path.join(this.baseDir, ".latest-" + crypto.randomUUID());
    try { fs.symlinkSync(path.join("sessions", sessionId), temporary, "dir"); } catch { return; }
    try { fs.unlinkSync(link); } catch { /* absent */ }
    fs.renameSync(temporary, link);
  }

  readManifest(sessionId: string): ReplayManifest | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.getSessionDir(sessionId), "manifest.json"), "utf8")) as ReplayManifest;
    } catch {
      return null;
    }
  }

  writeManifest(sessionId: string, manifest: ReplayManifest): void {
    const sessionDir = this.getSessionDir(sessionId);
    manifest.updatedAt = new Date().toISOString();
    const content = JSON.stringify(manifest, null, 2) + "\n";
    atomicWrite(path.join(sessionDir, "manifest.json"), content);
    atomicWrite(path.join(sessionDir, "session.json"), JSON.stringify(manifest.session, null, 2) + "\n");
  }

  writeMetadata(sessionId: string, metadata: SessionMetadata, page?: PageMetadata): void {
    this.initSession(sessionId, metadata, page);
  }

  writeEvents(events: AgentReplayEvent[]): void {
    const bySession = new Map<string, AgentReplayEvent[]>();
    for (const event of events) {
      this.validateSessionId(event.sessionId);
      const group = bySession.get(event.sessionId) ?? [];
      group.push(event);
      bySession.set(event.sessionId, group);
    }
    for (const [sessionId, sessionEvents] of bySession) {
      this.initSession(sessionId);
      const manifest = this.readManifest(sessionId);
      if (!manifest) throw new Error("Unable to initialize session manifest");
      sessionEvents.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);
      let nextSequence = this.nextSequences.get(sessionId);
      if (nextSequence == null) {
        const timeline = this.readJsonl<AgentReplayEvent>("timeline.jsonl", sessionId);
        nextSequence = timeline.reduce((maximum, event) => Math.max(maximum, event.sequence), -1) + 1;
      }
      for (const event of sessionEvents) event.sequence = nextSequence++;
      this.nextSequences.set(sessionId, nextSequence);
      for (const event of sessionEvents) {
        if (event.type === "error" && this.isDuplicateError(sessionId, event)) continue;
        this.appendJsonl(sessionId, "timeline.jsonl", event);
        this.appendJsonl(sessionId, SIGNAL_FILES[event.type], event.type === "rrweb" ? event.data : event);
        manifest.counts[event.type] = (manifest.counts[event.type] ?? 0) + 1;
      }
      manifest.session.durationMs = Math.max(
        manifest.session.durationMs ?? 0,
        sessionEvents.at(-1)?.offsetMs ?? 0,
      );
      if (manifest.session.mode === "rolling" && !manifest.session.pinned) {
        this.pruneRollingFiles(sessionId, sessionEvents.at(-1)?.timestamp ?? Date.now());
      }
      this.refreshFiles(sessionId, manifest);
      this.writeManifest(sessionId, manifest);
    }
  }

  private pruneRollingFiles(sessionId: string, now: number): void {
    const cutoff = now - DEFAULT_RETENTION.rollingWindowMs;
    const sessionDir = this.getSessionDir(sessionId);
    const timeline = this.readJsonl<AgentReplayEvent>("timeline.jsonl", sessionId);
    const retainedTimeline = timeline.filter((event) => event.timestamp >= cutoff);
    atomicWrite(path.join(sessionDir, "timeline.jsonl"), retainedTimeline.map((event) => JSON.stringify(event)).join("\n") + (retainedTimeline.length ? "\n" : ""));
    for (const filename of Object.values(SIGNAL_FILES).filter((value) => value !== "events.jsonl")) {
      const values = this.readJsonl<AgentReplayEvent>(filename, sessionId);
      if (!values.length || !("timestamp" in values[0]!)) continue;
      const retained = values.filter((event) => event.timestamp >= cutoff);
      atomicWrite(path.join(sessionDir, filename), retained.map((event) => JSON.stringify(event)).join("\n") + (retained.length ? "\n" : ""));
      this.fileSizes.set(sessionId + "/" + filename, fs.existsSync(path.join(sessionDir, filename)) ? fs.statSync(path.join(sessionDir, filename)).size : 0);
    }
    const rrweb = this.readJsonl<Record<string, unknown>>("events.jsonl", sessionId);
    const before = rrweb.filter((event) => Number(event.timestamp ?? 0) < cutoff);
    const checkpoint = [...before].reverse().find((event) => event.type === 2);
    const retainedRrweb = rrweb.filter((event) => Number(event.timestamp ?? 0) >= cutoff);
    if (checkpoint) retainedRrweb.unshift(checkpoint);
    atomicWrite(path.join(sessionDir, "events.jsonl"), retainedRrweb.map((event) => JSON.stringify(event)).join("\n") + (retainedRrweb.length ? "\n" : ""));
    for (const filename of ["timeline.jsonl", "events.jsonl"]) {
      this.fileSizes.set(sessionId + "/" + filename, fs.statSync(path.join(sessionDir, filename)).size);
    }
  }

  private isDuplicateError(sessionId: string, event: AgentReplayEvent): boolean {
    const data = event.data as { fingerprint?: string; message?: string; stack?: string };
    const fingerprint = data.fingerprint
      ?? crypto.createHash("sha1").update((data.message ?? "") + "\n" + (data.stack ?? "")).digest("hex");
    const seen = this.errorFingerprints.get(sessionId) ?? new Set<string>();
    if (seen.has(fingerprint)) return true;
    seen.add(fingerprint);
    this.errorFingerprints.set(sessionId, seen);
    data.fingerprint = fingerprint;
    return false;
  }

  private appendJsonl(sessionId: string, filename: string, data: unknown): void {
    const sessionDir = this.getSessionDir(sessionId);
    const filePath = path.join(sessionDir, filename);
    const line = JSON.stringify(data) + "\n";
    const key = sessionId + "/" + filename;
    const knownSize = this.fileSizes.get(key) ?? (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);

    if (directorySize(sessionDir) + Buffer.byteLength(line) > this.maxSessionSizeBytes) {
      throw new Error("Session disk quota exceeded");
    }
    if (directorySize(this.baseDir) + Buffer.byteLength(line) > this.maxDiskBytes) {
      throw new Error("Agent Replay disk quota exceeded");
    }
    if (knownSize + Buffer.byteLength(line) > this.maxFileSizeBytes) {
      const rotated = filePath.replace(/\.jsonl$/, "." + Date.now() + ".jsonl");
      if (fs.existsSync(filePath)) fs.renameSync(filePath, rotated);
      this.fileSizes.set(key, 0);
    }
    fs.appendFileSync(filePath, line, { encoding: "utf8", flag: "a", mode: 0o600 });
    this.fileSizes.set(key, (this.fileSizes.get(key) ?? 0) + Buffer.byteLength(line));
  }

  writeSummary(sessionId: string, markdown: string): void {
    atomicWrite(path.join(this.getSessionDir(sessionId), "summary.md"), markdown);
  }

  writeReport(sessionId: string, html: string): void {
    atomicWrite(path.join(this.getSessionDir(sessionId), "report.html"), html);
  }

  appendMediaChunk(sessionId: string, captureId: string, chunk: Uint8Array): string {
    this.validateSessionId(captureId);
    const mediaDir = path.join(this.getSessionDir(sessionId), "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    const partial = path.join(mediaDir, captureId + ".webm.partial");
    if ((fs.existsSync(partial) ? fs.statSync(partial).size : 0) + chunk.byteLength > this.maxSessionSizeBytes) {
      throw new Error("Media quota exceeded");
    }
    fs.appendFileSync(partial, chunk);
    return partial;
  }

  finalizeMedia(sessionId: string, captureId: string): string {
    this.validateSessionId(captureId);
    const mediaDir = path.join(this.getSessionDir(sessionId), "media");
    const partial = path.join(mediaDir, captureId + ".webm.partial");
    const output = path.join(mediaDir, captureId + ".webm");
    fs.renameSync(partial, output);
    return output;
  }

  readJsonl<T>(filename: string, sessionId?: string): T[] {
    const resolved = sessionId ?? this.getLatestSessionId();
    if (!resolved) return [];
    try {
      return fs.readFileSync(path.join(this.getSessionDir(resolved), filename), "utf8")
        .split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  }

  listSessions(): Array<{ id: string; metadata: SessionMetadata | null; schemaVersion: number }> {
    const sessionsDir = path.join(this.baseDir, "sessions");
    if (!fs.existsSync(sessionsDir)) return [];
    return fs.readdirSync(sessionsDir)
      .filter((id) => isUuid(id))
      .map((id) => {
        const manifest = this.readManifest(id);
        if (manifest) return { id, metadata: manifest.session, schemaVersion: manifest.schemaVersion };
        try {
          const metadata = JSON.parse(fs.readFileSync(path.join(sessionsDir, id, "session.json"), "utf8")) as SessionMetadata;
          return { id, metadata, schemaVersion: 0 };
        } catch {
          return { id, metadata: null, schemaVersion: 0 };
        }
      })
      .sort((a, b) => (b.metadata?.startedAt ?? "").localeCompare(a.metadata?.startedAt ?? ""));
  }

  getLatestSessionId(): string | null {
    try {
      const target = fs.readlinkSync(path.join(this.baseDir, "latest"));
      const id = path.basename(target);
      return isUuid(id) ? id : null;
    } catch {
      return this.listSessions()[0]?.id ?? null;
    }
  }

  readSummary(sessionId?: string): string | null {
    const resolved = sessionId ?? this.getLatestSessionId();
    if (!resolved) return null;
    try { return fs.readFileSync(path.join(this.getSessionDir(resolved), "summary.md"), "utf8"); }
    catch { return null; }
  }

  markPinned(sessionId: string, reason: string): void {
    const manifest = this.readManifest(sessionId);
    if (!manifest) return;
    manifest.session.pinned = true;
    manifest.session.pinReason = reason;
    this.writeManifest(sessionId, manifest);
  }

  closeSession(sessionId: string): void {
    const manifest = this.readManifest(sessionId);
    if (!manifest) return;
    const endedAt = new Date().toISOString();
    manifest.session.endedAt = endedAt;
    manifest.session.status = "closed";
    manifest.session.durationMs = new Date(endedAt).getTime() - new Date(manifest.session.startedAt).getTime();
    this.refreshFiles(sessionId, manifest);
    this.writeManifest(sessionId, manifest);
  }

  private refreshFiles(sessionId: string, manifest: ReplayManifest): void {
    const root = this.getSessionDir(sessionId);
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.endsWith(".partial") || entry.name === "manifest.json") continue;
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filePath);
        else manifest.files[path.relative(root, filePath)] = { bytes: fs.statSync(filePath).size };
      }
    };
    walk(root);
  }

  cleanup(config: CleanupConfig = {}): { deleted: string[] } {
    if (config.preserveLogs) return { deleted: [] };
    const maxSessions = config.maxSessions ?? 20;
    const maxAgeMs = (config.maxAgeHours ?? 24 * 7) * 60 * 60 * 1000;
    const maxPinned = config.maxPinnedSessions ?? 20;
    const pinnedMaxAgeMs = config.pinnedMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const sessions = this.listSessions();
    let pinnedIndex = 0;
    const deleted: string[] = [];
    for (let index = 0; index < sessions.length; index++) {
      const session = sessions[index]!;
      const started = new Date(session.metadata?.startedAt ?? 0).getTime();
      const pinned = session.metadata?.pinned === true;
      if (pinned) pinnedIndex++;
      const remove = pinned
        ? pinnedIndex > maxPinned || now - started > pinnedMaxAgeMs
        : index >= maxSessions || now - started > maxAgeMs;
      if (remove) {
        fs.rmSync(this.getSessionDir(session.id), { recursive: true, force: true });
        deleted.push(session.id);
      }
    }
    if (deleted.includes(this.getLatestSessionId() ?? "")) {
      try { fs.unlinkSync(path.join(this.baseDir, "latest")); } catch { /* absent */ }
      const next = this.listSessions()[0]?.id;
      if (next) this.writeLatest(next);
    }
    return { deleted };
  }

  cleanAll(): { deleted: string[] } {
    const deleted = this.listSessions().map((session) => session.id);
    for (const id of deleted) fs.rmSync(this.getSessionDir(id), { recursive: true, force: true });
    try { fs.unlinkSync(path.join(this.baseDir, "latest")); } catch { /* absent */ }
    return { deleted };
  }
}
