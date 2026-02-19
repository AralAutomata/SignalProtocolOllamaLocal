FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV OLLAMA_HOST=http://localhost:11434

ENTRYPOINT ["/entrypoint.sh"]
