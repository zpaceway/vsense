import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalyzeImage } from "./analyzeImage.ts";
import { registerAnalyzeVideo } from "./analyzeVideo.ts";

export function registerTools(server: McpServer) {
  registerAnalyzeImage(server);
  registerAnalyzeVideo(server);
}
