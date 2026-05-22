FROM node:24.16.0-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

FROM base AS pruner

COPY . .

RUN pnpm dlx turbo@2.8.9 prune @forge/mastra-gateway --docker

FROM base AS installer

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ ./

RUN pnpm --filter @forge/mastra-gateway build

FROM base AS runner

ENV NODE_ENV="production"
ENV NEXT_TELEMETRY_DISABLED="1"

COPY --from=installer /app /app

CMD ["node", "apps/mastra-gateway/.next/standalone/apps/mastra-gateway/server.js"]
