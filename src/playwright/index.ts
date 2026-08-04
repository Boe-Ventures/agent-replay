import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import { test as base, expect } from "@playwright/test";

export interface ReplayFlowOptions {
  outputDirectory?: string;
  name?: string;
  size?: { width: number; height: number };
  annotate?: boolean;
}

export interface ReplayStep {
  title: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "passed" | "failed";
  error?: string;
}

export class AgentReplayFlow {
  readonly steps: ReplayStep[] = [];
  readonly videoPath: string;
  readonly tracePath: string;
  private started = false;

  constructor(private page: Page, private options: ReplayFlowOptions = {}) {
    const directory = path.resolve(options.outputDirectory ?? ".agent-replay/receipts");
    fs.mkdirSync(directory, { recursive: true });
    const name = (options.name ?? "receipt").replace(/[^a-z0-9-_]+/gi, "-");
    this.videoPath = path.join(directory, name + ".webm");
    this.tracePath = path.join(directory, name + ".steps.json");
  }

  async start(title = "Verification receipt"): Promise<void> {
    await this.page.screencast.start({
      path: this.videoPath,
      size: this.options.size ?? { width: 1280, height: 800 },
      annotate: this.options.annotate === false ? undefined : { position: "top-right", duration: 700, fontSize: 22 },
    });
    if (this.options.annotate !== false) await this.page.screencast.showActions({ cursor: "pointer", position: "top-right" });
    await this.page.screencast.showChapter(title, { duration: 1_200 });
    this.started = true;
  }

  async step<T>(title: string, operation: () => Promise<T>): Promise<T> {
    if (!this.started) await this.start();
    await this.page.screencast.showChapter(title, { duration: 650 });
    const started = Date.now();
    try {
      const value = await operation();
      this.steps.push({ title, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: "passed" });
      return value;
    } catch (error) {
      this.steps.push({ title, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), durationMs: Date.now() - started, status: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      fs.writeFileSync(this.tracePath, JSON.stringify({ schemaVersion: 1, steps: this.steps }, null, 2) + "\n");
    }
  }

  async stop(outro = "Verified"): Promise<{ videoPath: string; tracePath: string; steps: ReplayStep[] }> {
    if (this.started) {
      await this.page.screencast.showChapter(outro, { duration: 900 });
      await this.page.screencast.stop();
      this.started = false;
    }
    fs.writeFileSync(this.tracePath, JSON.stringify({ schemaVersion: 1, steps: this.steps }, null, 2) + "\n");
    return { videoPath: this.videoPath, tracePath: this.tracePath, steps: this.steps };
  }
}

export function createReplayFlow(page: Page, options?: ReplayFlowOptions): AgentReplayFlow {
  return new AgentReplayFlow(page, options);
}

type Fixtures = { agentReplay: AgentReplayFlow };

export const test = base.extend<Fixtures>({
  agentReplay: async ({ page }, use, testInfo) => {
    const flow = new AgentReplayFlow(page, { name: testInfo.title, outputDirectory: testInfo.outputDir });
    await flow.start(testInfo.title);
    await use(flow);
    await flow.stop(testInfo.status === testInfo.expectedStatus ? "Verified" : "Needs attention");
  },
});

export { expect };
