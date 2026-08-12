FROM oven/bun:1-alpine

ENV VSENSE_MCP_HOST=0.0.0.0 \
    VSENSE_PORT=32516 \
    VSENSE_API_KEY=f18df8637d0240b7a2aba2ea4dba93d5

RUN apk add --no-cache make

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["make", "run"]
