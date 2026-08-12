import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorFields, log } from "../logger.ts";
import { openai } from "../openai.ts";

export function registerAnalyzeImage(server: McpServer) {
  server.registerTool(
    "analyze_image",
    {
      description: "Analyze an image based on a prompt",
      inputSchema: {
        prompt: z.string().describe("Question about the image"),
        imageUrl: z.string().url().describe("URL of the image to analyze"),
      },
    },
    async ({ prompt, imageUrl }) => {
      log("info", "analyze_image called", {
        imageUrl,
        promptLength: prompt.length,
      });

      const startedAt = performance.now();

      try {
        const response = await openai.responses.create({
          model: "gpt-5.6",
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                {
                  type: "input_image",
                  image_url: imageUrl,
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
