import type { AgentReplayEvent, Transport } from "./types.js";

// ── POST Transport ───────────────────────────────────────

export class PostTransport implements Transport {
  private url: string;
  private pending: AgentReplayEvent[] = [];
  private sending = false;

  constructor(url: string) {
    this.url = url;
  }

  async send(events: AgentReplayEvent[]): Promise<void> {
    this.pending.push(...events);
    if (this.sending) return;
    await this.drain();
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
          console.warn(
            `[agent-replay] Failed to send events: ${response.status}`
          );
          // Re-queue on failure
          this.pending.unshift(...batch);
          break;
        }
      } catch (err) {
        console.warn("[agent-replay] Transport error:", err);
        this.pending.unshift(...batch);
        break;
      }
    }
    this.sending = false;
  }

  async flush(): Promise<void> {
    await this.drain();
  }

  async close(): Promise<void> {
    await this.flush();
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
