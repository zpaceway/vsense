import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { apiKey, HOST, MCP_PATH, PORT, proxyImages } from "./config.ts";
import { errorFields, log } from "./logger.ts";
import { registerTools } from "./tools/index.ts";

const SERVER_INSTRUCTIONS = `# vsense MCP server

vsense is a vision analysis MCP server. It lets you ask questions about images
using a multimodal model (OpenAI), without handling image data locally.

## What you can do

- Analyze any publicly accessible image by URL: describe contents, detect
  objects, read text (OCR), or answer arbitrary questions about what is
  visible in the image.

## How to use

1. Get an image URL the user (or another tool) provided, or that is publicly
   reachable. The image must be hosted somewhere the model can fetch it —
   private/local files or localhost URLs are not supported.
2. Call the \`analyze_image\` tool with:
   - \`imageUrl\`: the URL of the image to analyze.
   - \`prompt\`: the question or instruction about the image.
3. The tool returns the model's answer as text.

## Notes

- The model runs remotely; nothing is stored server-side.
- Prefer specific prompts (e.g. "What color is the car in this photo?") over
  vague ones ("What do you see?") for better results.
`;

function logRequest(req: IncomingMessage, res: ServerResponse) {
  const startedAt = performance.now();

  res.on("finish", () => {
    log("info", "http request completed", {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
}

export function createMcpServer() {
  const mcpServer = new McpServer(
    {
      name: "vsense",
      version: "1.0.0",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(mcpServer);

  return mcpServer;
}

export async function startServer() {
  if (!apiKey) {
    throw new Error("VSENSE_API_KEY environment variable is required");
  }

  log("info", "vsense mcp starting", {
    host: HOST,
    port: PORT,
    rawPort: process.env.VSENSE_PORT,
    mcpPath: MCP_PATH,
    apiKeyConfigured: apiKey.length > 0,
    proxyImages,
  });

  const httpServer = createServer(async (req, res) => {
    logRequest(req, res);

    // Simple health endpoint
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "application/json",
      });

      res.end(
        JSON.stringify({
          name: "vsense-mcp",
          status: "ok",
          mcp: `http://localhost:${PORT}${MCP_PATH}`,
        }),
      );

      return;
    }

    // MCP endpoint
    if (req.url === MCP_PATH) {
      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        log("warn", "unauthorized mcp request", {
          method: req.method,
          url: req.url,
        });

        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": "Bearer",
        });

        res.end(
          JSON.stringify({
            error: "Unauthorized",
          }),
        );

        return;
      }

      // Stateless MCP server: a fresh transport (and server) per request,
      // since a stateless transport cannot be reused across requests.
      const mcpServer = createMcpServer();

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);

        res.on("close", () => {
          transport.close();
          mcpServer.close();
        });
      } catch (error) {
        log("error", "mcp request failed", {
          method: req.method,
          url: req.url,
          ...errorFields(error),
        });

        if (!res.headersSent) {
          res.writeHead(500, {
            "content-type": "application/json",
          });
        }

        res.end(
          JSON.stringify({
            error: "Internal server error",
          }),
        );
      }

      return;
    }

    log("warn", "unhandled route", {
      method: req.method,
      url: req.url,
    });

    res.writeHead(404, {
      "content-type": "application/json",
    });

    res.end(
      JSON.stringify({
        error: "Not found",
      }),
    );
  });

  httpServer.listen(PORT, HOST, () => {
    log("info", "vsense mcp listening", {
      host: HOST,
      port: PORT,
      mcpUrl: `http://localhost:${PORT}${MCP_PATH}`,
    });
  });

  const shutdown = (signal: string) => {
    log("info", "shutting down", { signal });

    httpServer.close(() => {
      log("info", "shutdown complete", { signal });
      process.exit(0);
    });

    setTimeout(() => {
      log("error", "shutdown timed out", { signal });
      process.exit(1);
    }, 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
