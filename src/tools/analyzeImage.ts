import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proxyImages } from "../config.ts";
import { errorFields, log } from "../logger.ts";
import { openai } from "../openai.ts";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function fetchImageAsDataUrl(imageUrl: string): Promise<string> {
  const startedAt = performance.now();
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download image: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.startsWith("image/")) {
    throw new Error(
      `Unsupported content type for image download: ${contentType ?? "missing"}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large: ${bytes.byteLength} bytes exceeds limit of ${MAX_IMAGE_BYTES}`,
    );
  }

  const base64 = Buffer.from(bytes).toString("base64");

  log("info", "image downloaded", {
    imageUrl,
    contentType,
    sizeBytes: bytes.byteLength,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return `data:${contentType};base64,${base64}`;
}

export function registerAnalyzeImage(server: McpServer) {
  server.registerTool(
    "analyze_image",
    {
      description: `Analyze an image by URL using a multimodal model.

**What it does**: Sends the image at \`imageUrl\` together with your \`prompt\`
to a vision-capable model (OpenAI) and returns the model's answer as text.

**Use cases**: describing image contents, object/scene detection, OCR/text
extraction, checking visual details (colors, layout, signs, people), or
answering arbitrary questions about what the image shows.

**Notes**:
- The image must be publicly fetchable over HTTP(S); local file paths and
  private/localhost URLs cannot be accessed by the model.
- The prompt can be a question or an instruction; be specific for best results.
- This is a remote inference call and may take a few seconds to complete.`,
      inputSchema: {
        prompt: z
          .string()
          .describe(
            'The question or instruction about the image, e.g. "What color is the car?" or "Extract all visible text."',
          ),
        imageUrl: z
          .string()
          .url()
          .describe(
            "Publicly accessible HTTP(S) URL of the image to analyze. Must be reachable by the remote model; localhost or private URLs will fail.",
          ),
      },
    },
    async ({ prompt, imageUrl }) => {
      log("info", "analyze_image called", {
        imageUrl,
        promptLength: prompt.length,
      });

      const startedAt = performance.now();

      try {
        const image = proxyImages
          ? await fetchImageAsDataUrl(imageUrl)
          : imageUrl;

        const response = await openai.responses.create({
          model: "gpt-5.6",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                {
                  type: "input_image",
                  image_url: image,
                  detail: "auto",
                },
              ],
            },
          ],
        });

        log("info", "analyze_image completed", {
          imageUrl,
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
        log("error", "analyze_image failed", {
          imageUrl,
          durationMs: Math.round(performance.now() - startedAt),
          ...errorFields(error),
        });

        throw error;
      }
    },
  );
}
