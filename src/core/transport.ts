import type { AgentReplayEvent, Transport } from "./types.js";

// ── Health check + backoff constants ─────────────────────

const MAX_BUFFER_SIZE = 1000;
const INITIAL_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;
const HEALTH_RECHECK_MS = 30000;

// ── POST Transport ───────────────────────────────────────

export class PostTransport implements Transport {
  private url: string;
  private baseUrl: string;
  private pending: AgentReplayEvent[] = [];
  private sending = false;

  // Health / backoff state
  private healthy: boolean | null = null; // null = unknown
  private healthChecked = false;
  private warningLogged = false;
  private retryMs = INITIAL_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(url: string) {
    this.url = url;
    // Derive base URL: "/api/__agent-replay/events" → "/api/__agent-replay"
    // "http://localhost:3700/events" → "http://localhost:3700"
    this.baseUrl = url.replace(/\/events\/?$/, "");
  }

  /**
   * Check if the endpoint is reachable.
   * Returns true if healthy, false otherwise.
   * Logs a single warning on first failure.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const healthUrl = `${this.baseUrl}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        if (this.healthy === false) {
          // Was down, now back up
          console.log("[agent-replay] Connected to recording endpoint.");
        }
        this.healthy = true;
        this.healthChecked = true;
        this.retryMs = INITIAL_RETRY_MS;
        return true;
      }
    } catch {
      // Unreachable
    }

    if (!this.warningLogged) {
      this.warningLogged = true;
      const isRelative = this.baseUrl.startsWith("/");
      if (isRelative) {
        console.warn(
          `[agent-replay] API route not responding at ${this.baseUrl}. Buffering events.`
        );
      } else {
        console.warn(
          `[agent-replay] Sidecar not reachable at ${this.baseUrl}. Buffering events. Start with: npx agent-replay dev`
        );
      }
    }
    this.healthy = false;
    this.healthChecked = true;
    this.scheduleRetry();
    return false;
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    if (this.retryTimer) return; // Already scheduled

    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.closed) return;

      const wasHealthy = await this.checkHealth();
      if (wasHealthy && this.pending.length > 0) {
        // Flush buffered events
        await this.drain();
      } else if (!wasHealthy) {
        // Exponential backoff
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      }
    }, this.retryMs);
  }

  /**
   * Start periodic health monitoring.
   * Call this once during initialization.
   */
  startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(async () => {
      if (this.closed) return;
      if (this.healthy) return; // No need to check if already healthy
      await this.checkHealth();
      if (this.healthy && this.pending.length > 0) {
        await this.drain();
      }
    }, HEALTH_RECHECK_MS);
  }

  /** Whether the transport has confirmed the endpoint is reachable */
  isHealthy(): boolean {
    return this.healthy === true;
  }

  /** Whether the initial health check has completed */
  isHealthChecked(): boolean {
    return this.healthChecked;
  }

  async send(events: AgentReplayEvent[]): Promise<void> {
    // Buffer if not healthy
    if (this.healthy === false) {
      this.bufferEvents(events);
      return;
    }

    this.pending.push(...events);
    if (this.sending) return;
    await this.drain();
  }

  private bufferEvents(events: AgentReplayEvent[]): void {
    this.pending.push(...events);
    // Cap buffer to prevent memory leaks
    if (this.pending.length > MAX_BUFFER_SIZE) {
      const overflow = this.pending.length - MAX_BUFFER_SIZE;
      this.pending.splice(0, overflow);
    }
  }

  private async drain(): Promise<void> {
    this.sending = true;
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0);
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: batch }),
        });
        if (!response.ok) {
          // Re-queue on failure, mark unhealthy
          this.pending.unshift(...batch);
          this.healthy = false;
          this.scheduleRetry();
          break;
        }
        // Success — confirm healthy
        if (this.healthy !== true) {
          this.healthy = true;
          this.retryMs = INITIAL_RETRY_MS;
        }
      } catch {
        // Silently buffer — no console spam
        this.pending.unshift(...batch);
        this.healthy = false;
        this.scheduleRetry();
        break;
      }
    }
    this.sending = false;
  }

  async flush(): Promise<void> {
    if (this.healthy === true) {
      await this.drain();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    // Best-effort flush
    if (this.healthy === true) {
      await this.drain();
    }
  }
}

// ── WebSocket Transport ──────────────────────────────────

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private url: string;
  private buffer: AgentReplayEvent[] = [];
  private connected = false;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.connected = true;
      // Drain buffer
      if (this.buffer.length > 0) {
        const batch = this.buffer.splice(0);
        this.ws?.send(JSON.stringify({ events: batch }));
      }
    };
    this.ws.onclose = () => {
      this.connected = false;
    };
    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  async send(events: AgentReplayEvent[]): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ events }));
    } else {
      this.buffer.push(...events);
    }
  }

  async flush(): Promise<void> {
    if (this.connected && this.ws && this.buffer.length > 0) {
      const batch = this.buffer.splice(0);
      this.ws.send(JSON.stringify({ events: batch }));
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.ws?.close();
    this.ws = null;
  }
}

// ── Direct Transport (in-process, for testing) ──────────

export class DirectTransport implements Transport {
  private callback: (events: AgentReplayEvent[]) => void;

  constructor(callback: (events: AgentReplayEvent[]) => void) {
    this.callback = callback;
  }

  async send(events: AgentReplayEvent[]): Promise<void> {
    this.callback(events);
  }

  async flush(): Promise<void> {
    // No-op for direct transport
  }

  async close(): Promise<void> {
    // No-op for direct transport
  }
}

// ── Console Transport (fallback/debug) ──────────────────

export class ConsoleTransport implements Transport {
  async send(events: AgentReplayEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type !== "rrweb") {
        console.log(`[agent-replay] ${event.type}:`, event.data);
      }
    }
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
