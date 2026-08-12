export const PORT = process.env.VSENSE_PORT
  ? parseInt(process.env.VSENSE_PORT)
  : 32516;

export const HOST = process.env.VSENSE_MCP_HOST ?? "0.0.0.0";

export const MCP_PATH = "/mcp";

export const apiKey = process.env.VSENSE_API_KEY;
