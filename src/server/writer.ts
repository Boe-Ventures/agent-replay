import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentReplayEvent,
  WriterConfig,
  CleanupConfig,
  SessionMetadata,
  ConsoleEntry,
  NetworkEntry,
  WebSocketEntry,
  ErrorEntry,
} from "../core/types.js";

const DEFAULT_BASE_DIR = ".agent-replay";
const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export class SessionWriter {
  private baseDir: string;
  private maxFileSizeBytes: number;
  private currentSessionId: string | null = null;
  private sessionDir: string | null = null;
  private fileSizes: Map<string, number> = new Map();

  constructor(config: WriterConfig = {}) {
    this.baseDir = config.baseDir ?? DEFAULT_BASE_DIR;
    this.maxFileSizeBytes =
      config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  }

  /** Initialize a session directory */
  initSession(sessionId: string): string {
    this.currentSessionId = sessionId;
    const sessionsDir = path.join(this.baseDir, "sessions");
    this.sessionDir = path.join(sessionsDir, sessionId);

    // Create directories
    fs.mkdirSync(this.sessionDir, { recursive: true });

    // Update latest symlink
    const latestLink = path.join(this.baseDir, "latest");
    try {
      fs.unlinkSync(latestLink);
    } catch {
      // Doesn't exist yet
    }
    fs.symlinkSync(
      path.join("sessions", sessionId),
      latestLink,
      "dir"
    );

    return this.sessionDir;
  }

  /** Write session metadata */
  writeMetadata(metadata: SessionMetadata): void {
    if (!this.sessionDir) return;
    const metaPath = path.join(this.sessionDir, "session.json");
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  }

  /** Process and write a batch of events */
  writeEvents(events: AgentReplayEvent[]): void {
    if (!this.sessionDir || !this.currentSessionId) return;

    for (const event of events) {
      switch (event.type) {
        case "rrweb":
          this.appendJsonl("events.jsonl", event.data);
          break;
        case "console":
          this.appendJsonl("console.jsonl", event.data);
          break;
        case "network":
          this.appendJsonl("network.jsonl", event.data);
          break;
        case "websocket":
          this.appendJsonl("websocket.jsonl", event.data);
          break;
        case "error":
          this.appendJsonl("errors.jsonl", event.data);
          break;
        case "interaction":
          this.appendJsonl("events.jsonl", event);
          break;
        case "route-change":
          this.appendJsonl("events.jsonl", event);
          break;
      }
    }
  }

  /** Append a JSON line to a file, respecting size limits */
  private appendJsonl(filename: string, data: unknown): void {
    if (!this.sessionDir) return;
    const filePath = path.join(this.sessionDir, filename);
    const line = JSON.stringify(data) + "\n";

    // Check size limit
    const currentSize = this.fileSizes.get(filename) ?? 0;
    if (currentSize + line.length > this.maxFileSizeBytes) {
      // Rotate: rename current file and start fresh
      const rotated = filePath.replace(
        ".jsonl",
        `.${Date.now()}.jsonl`
      );
      try {
        fs.renameSync(filePath, rotated);
      } catch {
        // File might not exist
      }
      this.fileSizes.set(filename, 0);
    }

    fs.appendFileSync(filePath, line);
    this.fileSizes.set(filename, (this.fileSizes.get(filename) ?? 0) + line.length);
  }

  /** Write the summary markdown */
  writeSummary(markdown: string): void {
    if (!this.sessionDir) return;
    fs.writeFileSync(
      path.join(this.sessionDir, "summary.md"),
      markdown
    );
  }

  /** Read all entries from a JSONL file */
  readJsonl<T>(filename: string, sessionId?: string): T[] {
    const dir = sessionId
      ? path.join(this.baseDir, "sessions", sessionId)
      : this.sessionDir ??
        path.join(this.baseDir, "latest");
    const filePath = path.join(dir, filename);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  }

  /** List all sessions */
  listSessions(): { id: string; metadata: SessionMetadata | null }[] {
    const sessionsDir = path.join(this.baseDir, "sessions");
    try {
      const dirs = fs.readdirSync(sessionsDir).sort().reverse();
      return dirs.map((id) => {
        const metaPath = path.join(sessionsDir, id, "session.json");
        let metadata: SessionMetadata | null = null;
        try {
          metadata = JSON.parse(
            fs.readFileSync(metaPath, "utf-8")
          ) as SessionMetadata;
        } catch {
          // No metadata file
        }
        return { id, metadata };
      });
    } catch {
      return [];
    }
  }

  /** Get the latest session ID */
  getLatestSessionId(): string | null {
    const latestLink = path.join(this.baseDir, "latest");
    try {
      const target = fs.readlinkSync(latestLink);
      return path.basename(target);
    } catch {
      // Fallback: read sessions dir
      const sessions = this.listSessions();
      return sessions[0]?.id ?? null;
    }
  }

  /** Get session directory path */
  getSessionDir(sessionId?: string): string {
    if (sessionId) {
      return path.join(this.baseDir, "sessions", sessionId);
    }
    return this.sessionDir ?? path.join(this.baseDir, "latest");
  }

  /** Read summary.md for a session */
  readSummary(sessionId?: string): string | null {
    const dir = sessionId
      ? path.join(this.baseDir, "sessions", sessionId)
      : path.join(this.baseDir, "latest");
    const filePath = path.join(dir, "summary.md");
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /** Run cleanup based on config: remove old/excess sessions */
  cleanup(config: CleanupConfig = {}): { deleted: string[] } {
    const maxSessions = config.maxSessions ?? 5;
    const maxAgeHours = config.maxAgeHours ?? 24;
    const preserveLogs = config.preserveLogs ?? false;
    const deleted: string[] = [];

    if (preserveLogs) return { deleted };

    const sessionsDir = path.join(this.baseDir, "sessions");
    if (!fs.existsSync(sessionsDir)) return { deleted };

    // Get all sessions sorted by directory mtime (newest first)
    const entries = fs.readdirSync(sessionsDir)
      .map((name) => {
        const dirPath = path.join(sessionsDir, name);
        try {
          const stat = fs.statSync(dirPath);
          if (!stat.isDirectory()) return null;
          return { name, mtime: stat.mtimeMs, dirPath };
        } catch {
          return null;
        }
      })
      .filter((e): e is { name: string; mtime: number; dirPath: string } => e !== null)
      .sort((a, b) => b.mtime - a.mtime);

    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const isExpired = (now - entry.mtime) > maxAgeMs;
      const isExcess = i >= maxSessions;

      if (isExpired || isExcess) {
        try {
          fs.rmSync(entry.dirPath, { recursive: true, force: true });
          deleted.push(entry.name);
        } catch {
          // Best effort
        }
      }
    }

    // Update latest symlink if current target was deleted
    const latestLink = path.join(this.baseDir, "latest");
    try {
      const target = fs.readlinkSync(latestLink);
      const targetName = path.basename(target);
      if (deleted.includes(targetName)) {
        fs.unlinkSync(latestLink);
        // Point to newest surviving session
        const surviving = entries.find((e) => !deleted.includes(e.name));
        if (surviving) {
          fs.symlinkSync(path.join("sessions", surviving.name), latestLink, "dir");
        }
      }
    } catch {
      // No symlink or already gone
    }

    return { deleted };
  }

  /** Delete all sessions */
  cleanAll(): { deleted: string[] } {
    const sessionsDir = path.join(this.baseDir, "sessions");
    const deleted: string[] = [];

    if (!fs.existsSync(sessionsDir)) return { deleted };

    for (const name of fs.readdirSync(sessionsDir)) {
      const dirPath = path.join(sessionsDir, name);
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        deleted.push(name);
      } catch {
        // Best effort
      }
    }

    // Remove latest symlink
    const latestLink = path.join(this.baseDir, "latest");
    try { fs.unlinkSync(latestLink); } catch { /* */ }

    return { deleted };
  }
}
