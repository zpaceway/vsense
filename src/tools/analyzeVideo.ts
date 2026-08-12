import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { errorFields, log } from "../logger.ts";
import { openai } from "../openai.ts";
import { videoModel } from "../config.ts";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_VIDEO_DURATION_SECONDS = 5 * 60;
const AUTO_FRAME_INTERVAL_SECONDS = 5;
const MAX_FRAMES_LIMIT = 100;

async function downloadVideo(
  videoUrl: string,
  destPath: string,
): Promise<{ contentType: string; sizeBytes: number }> {
  const startedAt = performance.now();
  const response = await fetch(videoUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download video: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("video/")) {
    throw new Error(
      `Unsupported content type for video download: ${contentType ?? "missing"}`,
    );
  }

  if (!response.body) {
    throw new Error("Video download returned no body");
  }

  const reader = response.body.getReader();
  const writer = Bun.file(destPath).writer();
  let sizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_VIDEO_BYTES) {
        throw new Error(
          `Video too large: ${sizeBytes} bytes exceeds limit of ${MAX_VIDEO_BYTES}`,
        );
      }

      writer.write(value);
    }
  } finally {
    reader.releaseLock();
    await writer.end();
  }

  log("info", "video downloaded", {
    videoUrl,
    contentType,
    sizeBytes,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return { contentType, sizeBytes };
}

async function getDurationSeconds(videoPath: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      videoPath,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `ffprobe failed (exit ${exitCode}): ${stderr.trim() || "no output"}`,
    );
  }

  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const duration = Number(parsed.format?.duration);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  return duration;
}

async function extractFrames(
  videoPath: string,
  outDir: string,
  maxFrames: number | undefined,
): Promise<number> {
  const durationSeconds = await getDurationSeconds(videoPath);

  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new Error(
      `Video too long: ${durationSeconds} seconds exceeds the ${MAX_VIDEO_DURATION_SECONDS} second (${MAX_VIDEO_DURATION_SECONDS / 60} minute) limit`,
    );
  }

  const frameCount =
    maxFrames ??
    Math.min(
      Math.ceil(durationSeconds / AUTO_FRAME_INTERVAL_SECONDS),
      MAX_FRAMES_LIMIT,
    );
  const fps = frameCount / durationSeconds;

  const proc = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      `fps=${fps}`,
      "-frames:v",
      String(frameCount),
      "-q:v",
      "2",
      path.join(outDir, "frame_%04d.jpg"),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `ffmpeg frame extraction failed (exit ${exitCode}): ${stderr.trim() || "no output"}`,
    );
  }

  const names = await readdir(outDir);
  return names.filter((name) => name.endsWith(".jpg")).length;
}

async function readFramesAsDataUrls(outDir: string): Promise<string[]> {
  const names = (await readdir(outDir))
    .filter((name) => name.endsWith(".jpg"))
    .sort();

  const frames: string[] = [];
  for (const name of names) {
    const bytes = await Bun.file(path.join(outDir, name)).arrayBuffer();
    frames.push(
      `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
    );
  }

  return frames;
}

export function registerAnalyzeVideo(server: McpServer) {
  server.registerTool(
    "analyze_video",
    {
      description: `Analyze a video by URL using a multimodal model.

**What it does**: Downloads the video at \`videoUrl\` and samples frames across
its duration, then sends them to a cheap vision-capable model in chronological
order along with your \`prompt\`, returning the model's answer as text.

**Frame sampling**: By default the server extracts one frame every
${AUTO_FRAME_INTERVAL_SECONDS} seconds, capped at ${MAX_FRAMES_LIMIT} frames.
Pass \`maxFrames\` to override and distribute that exact number of frames
evenly across the video (max ${MAX_FRAMES_LIMIT}).

**Use cases**: describing video contents, detecting objects/actions over time,
reading text shown in the video (OCR), summarizing what happens, checking
visual details, or answering arbitrary questions about what the video shows.

**Notes**:
- The video must be publicly fetchable over HTTP(S); local file paths and
  private/localhost URLs cannot be accessed by the server.
- Videos are limited to 5 minutes; longer videos are rejected.
- Frames are sampled evenly across the video, so fast transient details may be
  missed. Raise \`maxFrames\` for finer temporal coverage.
- Only the visuals are analyzed; the audio track is not transcribed.
- Frames are sent at low detail to keep cost down; for fine visual detail
  prefer \`analyze_image\` on a single frame.
- This is a remote inference call and may take several seconds to complete.`,
      inputSchema: {
        prompt: z
          .string()
          .describe(
            'The question or instruction about the video, e.g. "What happens in this video?" or "Extract all visible text."',
          ),
        videoUrl: z
          .string()
          .url()
          .describe(
            "Publicly accessible HTTP(S) URL of the video to analyze. Must be reachable by the server; localhost or private URLs will fail.",
          ),
        maxFrames: z
          .number()
          .int()
          .min(1)
          .max(MAX_FRAMES_LIMIT)
          .optional()
          .describe(
            `Optional number of frames to sample evenly across the video (max ${MAX_FRAMES_LIMIT}). When omitted, the server samples one frame every ${AUTO_FRAME_INTERVAL_SECONDS} seconds (up to ${MAX_FRAMES_LIMIT} frames).`,
          ),
      },
    },
    async ({ prompt, videoUrl, maxFrames }) => {
      log("info", "analyze_video called", {
        videoUrl,
        promptLength: prompt.length,
        maxFrames,
      });

      const startedAt = performance.now();
      const tmpDir = await mkdtemp(path.join(tmpdir(), "vsense-"));

      try {
        const videoPath = path.join(tmpDir, "video.bin");
        await downloadVideo(videoUrl, videoPath);

        const extractStartedAt = performance.now();
        const frameCount = await extractFrames(videoPath, tmpDir, maxFrames);
        const frames = await readFramesAsDataUrls(tmpDir);

        log("info", "video frames extracted", {
          videoUrl,
          frameCount,
          durationMs: Math.round(performance.now() - extractStartedAt),
        });

        if (frames.length === 0) {
          throw new Error("No frames could be extracted from the video");
        }

        const response = await openai.responses.create({
          model: videoModel,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...frames.map((frame) => ({
                  type: "input_image" as const,
                  image_url: frame,
                  detail: "low" as const,
                })),
              ],
            },
          ],
        });

        log("info", "analyze_video completed", {
          videoUrl,
          durationMs: Math.round(performance.now() - startedAt),
          outputLength: response.output_text.length,
        });

        return {
          content: [
            {
              type: "text",
              text: response.output_text,
            },
          ],
        };
      } catch (error) {
        log("error", "analyze_video failed", {
          videoUrl,
          durationMs: Math.round(performance.now() - startedAt),
          ...errorFields(error),
        });

        throw error;
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    },
  );
}
