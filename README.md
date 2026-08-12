# VSense MCP

VSense is a minimal Model Context Protocol server built with Bun that exposes
an image-analysis tool backed by OpenAI. The MCP endpoint is protected by a
shared API key; the health endpoint is public.

## Requirements

- [Bun](https://bun.sh/) 1.x or newer
- An OpenAI API key
- Docker with Compose, only when using the container workflow

## Configuration

Configuration comes from environment variables, optionally loaded from a
`.env` file in this directory (Bun loads it automatically):

| Variable              | Default                  | Purpose                                               |
| --------------------- | ------------------------ | ----------------------------------------------------- |
| `OPENAI_API_KEY`      | —                        | OpenAI API key used by `analyze_image` (required).    |
| `VSENSE_API_KEY`      | —                        | Bearer token required on the MCP endpoint (required). |
| `VSENSE_PORT`         | `32516`                  | Port the HTTP server binds.                           |
| `VSENSE_MCP_HOST`     | `0.0.0.0`                | Interface the HTTP server binds.                      |
| `VSENSE_MCP_BASE_URL` | `http://localhost:32516` | Public base URL used by deployments.                  |
| `VSENSE_PROXY_IMAGES` | `true`                  | Download images server-side and send them to OpenAI as base64 so private URLs work. Set to `false` to pass the URL through to OpenAI directly. |

The server refuses to start without `VSENSE_API_KEY`. The Makefile and
Compose default to the committed development key (`f18df8...`); override it
with `make run VSENSE_API_KEY=...` or the environment.

## Local Development

Run commands from this directory:

```bash
bun install
make dev
```

`make dev` starts Bun in watch mode and reloads on changes. `make run` starts
the production server. Override the bind address, port, or API key with Make
variables:

```bash
make run VSENSE_MCP_HOST=127.0.0.1 VSENSE_PORT=8000 VSENSE_API_KEY=secret
```

## Verification

```bash
make check
```

`make check` runs Prettier in check mode and `tsc --noEmit`. `make format`
applies Prettier formatting.

## Docker

From this directory:

```bash
docker compose up --build
```

The Compose project, service, image, and container are named `vsense-mcp`.
The service uses the host network, binding `0.0.0.0:32516` directly. It needs
`OPENAI_API_KEY` (and optionally `VSENSE_API_KEY`) passed through the
environment:

```bash
OPENAI_API_KEY=... docker compose up -d --build
```

`make docker` rebuilds and restarts the container, `make logs` tails its
logs, `make build-push` publishes
`harbor.zpaceway.com/zpaceway/vsense-mcp:latest`, and `make deploy` pushes
and restarts the Kubernetes deployment.

## Endpoints

| Method | Route  | Purpose                                                                   |
| ------ | ------ | ------------------------------------------------------------------------- |
| `GET`  | `/`    | Health check, returns `{"name":"vsense-mcp","status":"ok",...}` (public). |
| `POST` | `/mcp` | MCP Streamable HTTP endpoint (API key required).                          |

### MCP

Authenticate with the API key as a Bearer token:

```bash
curl -X POST http://localhost:32516/mcp \
  -H "Authorization: Bearer $VSENSE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}'
```

The server is stateless: every request is handled with a fresh transport, so
no `mcp-session-id` handling is required.

### Tools

`analyze_image` analyzes an image based on a prompt:

```json
{
  "prompt": "What breed of dog is this?",
  "imageUrl": "https://example.com/dog.jpg"
}
```

By default the server downloads the image itself and sends it to OpenAI as
base64 (so private URLs work); the `imageUrl` is only passed directly to
OpenAI when `VSENSE_PROXY_IMAGES=false`.

## Logging

All logs are structured JSON lines on stdout/stderr (`ts`, `level`, `msg`,
plus fields). The server logs startup configuration, every HTTP request
(method, URL, status, duration), authorization failures, MCP request errors,
and graceful shutdown. The `analyze_image` tool logs each call, its duration,
and failures.

## Security

- The MCP endpoint is protected by a single shared `VSENSE_API_KEY`; the
  health endpoint is public.
- The Makefile and Compose use a committed development key by default.
- VSense does not provide TLS, rate limiting, or quota enforcement. Without
  TLS, the API key is transmitted in plaintext.
- Compose publishes the service on all host interfaces by default.

Do not expose this configuration directly to an untrusted network. Use a
generated key and add TLS before a remote deployment.
