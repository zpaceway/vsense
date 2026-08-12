import { log } from "./src/logger.ts";
import { startServer } from "./src/server.ts";

try {
  await startServer();
} catch (error) {
  log("error", "fatal: failed to start vsense mcp", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
