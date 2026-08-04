import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExportOptions } from "../core/types.js";

export const VIDEO_PRESETS = {
  debug: { width: 1280, height: 800 },
  launch: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  vertical: { width: 1080, height: 1920 },
} as const;

export function findExecutable(name: string): string | null {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runFfmpeg(args: string[]): void {
  const ffmpeg = findExecutable("ffmpeg");
  if (!ffmpeg) throw new Error("FFmpeg is required for this export. Install it and run agent-replay doctor.");
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "FFmpeg export failed");
}

function framingFilter(preset: keyof typeof VIDEO_PRESETS): string {
  const { width, height } = VIDEO_PRESETS[preset];
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x090c12`;
}

export function postProcessVideo(
  source: string,
  options: ExportOptions,
): string {
  if (!fs.existsSync(source)) throw new Error("Source recording not found: " + source);
  const preset = options.preset ?? "debug";
  const extension = options.format === "poster" || options.format === "storyboard" ? "jpg" : options.format;
  const output = path.resolve(options.output ?? source.replace(/\.webm$/i, "." + extension));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const trim = [
    ...(options.fromMs != null ? ["-ss", String(options.fromMs / 1000)] : []),
    ...(options.toMs != null ? ["-to", String(options.toMs / 1000)] : []),
  ];
  const filter = framingFilter(preset);
  if (options.format === "mp4") {
    runFfmpeg([...trim, "-i", source, "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...(options.audio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]), output]);
  } else if (options.format === "gif") {
    const complex = `[0:v]${filter},fps=15,split[a][b];[a]palettegen[p];[b][p]paletteuse`;
    runFfmpeg([...trim, "-i", source, "-filter_complex", complex, output]);
  } else if (options.format === "poster") {
    const posterAt = Math.max(0, (options.fromMs ?? 1_000) / 1_000);
    runFfmpeg(["-ss", String(posterAt), "-i", source, "-frames:v", "1", "-vf", filter, "-q:v", "2", output]);
  } else if (options.format === "storyboard") {
    const probe = probeVideo(source);
    const sourceDuration = Number((probe.format as { duration?: string } | undefined)?.duration ?? 3);
    const startSeconds = (options.fromMs ?? 0) / 1_000;
    const endSeconds = options.toMs == null ? sourceDuration : Math.min(sourceDuration, options.toMs / 1_000);
    const duration = Math.max(0.25, endSeconds - startSeconds);
    const frameCount = Math.min(12, Math.max(1, Math.ceil(duration / 3)));
    const columns = Math.min(4, frameCount);
    const rows = Math.ceil(frameCount / columns);
    const sampleRate = frameCount / duration;
    runFfmpeg([...trim, "-i", source, "-vf", `fps=${sampleRate},${filter},scale=480:-1,tile=${columns}x${rows}:nb_frames=${frameCount}:padding=8:margin=8`, "-frames:v", "1", output]);
  } else if (options.format === "webm" && path.resolve(source) !== output) {
    fs.copyFileSync(source, output);
  }
  return output;
}

export function probeVideo(file: string): Record<string, unknown> {
  const ffprobe = findExecutable("ffprobe");
  if (!ffprobe) throw new Error("ffprobe is not available");
  const result = spawnSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "ffprobe failed");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

export function detectFidelityWarnings(serializedEvents: string): string[] {
  const warnings: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/<canvas|canvasMutation/i, "Canvas content may not reconstruct faithfully."],
    [/webgl/i, "WebGL content is not captured as pixels."],
    [/<video|<iframe/i, "Video and embedded frames may require true tab capture."],
    [/mapbox|google\.maps|leaflet/i, "Interactive maps should use true tab capture for faithful output."],
  ];
  for (const [pattern, warning] of checks) if (pattern.test(serializedEvents)) warnings.push(warning);
  return warnings;
}
