import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import type { ExportOptions } from "../core/types.js";
import { createSidecar } from "./sidecar.js";
import { SessionWriter } from "./writer.js";
import { detectFidelityWarnings, postProcessVideo, VIDEO_PRESETS } from "./video.js";

export async function exportReplayVideo(
  writer: SessionWriter,
  sessionId: string,
  options: ExportOptions,
): Promise<{ source: string; output: string; warnings: string[] }> {
  const manifest = writer.readManifest(sessionId);
  if (!manifest) throw new Error("Session not found");
  const rrweb = writer.readJsonl("events.jsonl", sessionId);
  if (rrweb.length < 2) throw new Error("This session does not contain enough rrweb events to replay");
  const warnings = detectFidelityWarnings(JSON.stringify(rrweb));
  manifest.fidelityWarnings = [...new Set([...manifest.fidelityWarnings, ...warnings])];
  writer.writeManifest(sessionId, manifest);

  const preset = options.preset ?? "debug";
  const size = VIDEO_PRESETS[preset];
  const mediaDirectory = path.join(writer.getSessionDir(sessionId), "media");
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const source = path.join(mediaDirectory, "replay.webm");
  const sidecar = createSidecar({ port: 0, host: "127.0.0.1", writerConfig: { baseDir: writer.baseDir } });
  await sidecar.start();
  const port = (sidecar.server.address() as AddressInfo).port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: size });
    const fromMs = options.fromMs ?? 0;
    const toMs = options.toMs ?? manifest.session.durationMs ?? 5_000;
    await page.goto(`http://127.0.0.1:${port}/?session=${sessionId}&t=${fromMs}&skipIdle=${options.removeIdle ? "1" : "0"}`, { waitUntil: "domcontentloaded" });
    await page.locator(".brand").waitFor({ state: "visible" });
    await page.locator(".event").first().waitFor({ state: "visible" });
    await page.screencast.start({ path: source, size, quality: 90 });
    if (options.emphasizeClicks !== false) await page.screencast.showActions({ cursor: "pointer", duration: 450 });
    if (options.title) await page.screencast.showChapter(options.title, { duration: 1_200 });
    if (fromMs === 0) await page.getByRole("button", { name: "Play", exact: true }).click();
    const timeline = writer.readJsonl<import("../core/types.js").AgentReplayEvent>("timeline.jsonl", sessionId)
      .filter((event) => event.offsetMs >= fromMs && event.offsetMs <= toMs)
      .sort((a, b) => a.offsetMs - b.offsetMs);
    const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const schedule = async (
      selected: import("../core/types.js").AgentReplayEvent[],
      render: (event: import("../core/types.js").AgentReplayEvent) => Promise<unknown>,
    ) => {
      let cursor = fromMs;
      for (const event of selected) {
        const gap = Math.max(0, event.offsetMs - cursor);
        await sleep(options.removeIdle ? Math.min(3_000, gap) : gap);
        await render(event);
        cursor = event.offsetMs;
      }
    };
    const markerTask = schedule(timeline.filter((event) => event.type === "marker"), (event) =>
      page.screencast.showChapter(String((event.data as { label?: string }).label ?? "Marker"), { duration: 650 }),
    );
    const captionEvents = options.captions
      ? timeline.filter((event) => ["interaction", "error", "route-change"].includes(event.type))
      : [];
    const captionTask = schedule(captionEvents, async (event) => {
      const data = event.data as Record<string, unknown>;
      const label = event.type === "error" ? String(data.message ?? "Error")
        : event.type === "interaction" ? String(data.type ?? "interaction") + " " + String(data.target ?? "")
          : String(data.to ?? "Route change");
      await page.screencast.showOverlay(`<div style="font:600 18px system-ui;background:#090c12e8;color:white;padding:10px 14px;border-radius:8px;border:1px solid #334155">${label.replace(/[&<>]/g, "")}</div>`, { duration: 900 });
    });
    const fullDuration = Math.max(250, toMs - fromMs);
    const activeDuration = timeline.length < 2 ? fullDuration : timeline.slice(1).reduce((total, event, index) =>
      total + Math.min(3_000, Math.max(0, event.offsetMs - timeline[index]!.offsetMs)), 0);
    await sleep(options.removeIdle ? Math.max(250, activeDuration) : fullDuration);
    await Promise.allSettled([markerTask, captionTask]);
    if (options.outro) await page.screencast.showChapter(options.outro, { duration: 1_000 });
    await page.screencast.stop();
  } finally {
    await browser.close();
    await sidecar.stop();
  }
  const output = options.format === "webm"
    ? (options.output ? postProcessVideo(source, options) : source)
    : postProcessVideo(source, options);
  return { source, output, warnings };
}
