FROM node:24.16.0-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED="1"

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.12.3 --activate

FROM base AS pruner

COPY . .

RUN pnpm dlx turbo@2.8.9 prune @forge/mastra-gateway --docker

FROM base AS runner

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/ ./

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @forge/mastra-gateway build

ENV NODE_ENV="production"

CMD ["sh", "-c", "cd apps/mastra-gateway && pnpm exec prisma migrate deploy && HOSTNAME=0.0.0.0 pnpm start"]
