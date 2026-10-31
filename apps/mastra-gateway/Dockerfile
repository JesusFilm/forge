# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/mastra-gateway/package.json apps/mastra-gateway/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/mastra-gateway...
COPY apps/mastra-gateway apps/mastra-gateway
# Generation validates the schema without connecting to this public dummy URL.
RUN DATABASE_URL=postgresql://ci:ci@127.0.0.1:9/gateway_image_build pnpm --filter @forge/mastra-gateway db:generate
RUN CI=true pnpm --filter @forge/mastra-gateway build \
    && cp -r apps/mastra-gateway/.next/static apps/mastra-gateway/.next/standalone/apps/mastra-gateway/.next/static
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
CMD ["sh", "/app/apps/mastra-gateway/start-production.sh"]
