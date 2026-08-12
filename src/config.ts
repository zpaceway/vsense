const DEFAULT_PORT = 32516;

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;

  // Kubernetes injects Service env vars like VSENSE_PORT=tcp://10.43.191.220:32516
  const match = (raw ?? "").match(/:(\d+)\s*$/);
  const candidate = Number.parseInt(match?.[1] ?? raw ?? "", 10);

  if (Number.isInteger(candidate) && candidate > 0 && candidate < 65536) {
    return candidate;
  }

  return fallback;
}

export const PORT = parsePort(process.env.VSENSE_PORT, DEFAULT_PORT);

export const HOST = process.env.VSENSE_MCP_HOST ?? "0.0.0.0";

export const MCP_PATH = "/mcp";

export const apiKey = process.env.VSENSE_API_KEY;

// Internal: download images server-side and send them to OpenAI as base64 so
// private URLs work. Clients are not aware of this. Set to "false" to pass
// the URL through to OpenAI directly.
export const proxyImages =
  (process.env.VSENSE_PROXY_IMAGES ?? "true") !== "false";
