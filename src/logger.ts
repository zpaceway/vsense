export type LogLevel = "info" | "warn" | "error";

function format(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
}

export function log(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
) {
  const line = format(level, message, fields);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function errorFields(error: unknown): { error: string } {
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}
