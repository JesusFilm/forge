FROM node:24.16.0-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED="1"

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.12.3 --activate

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @forge/mastra-gateway build

ENV NODE_ENV="production"

CMD ["sh", "-c", "cd apps/mastra-gateway && pnpm exec prisma migrate deploy && HOSTNAME=0.0.0.0 pnpm start"]
