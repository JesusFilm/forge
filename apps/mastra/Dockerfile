# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
ENV MASTRA_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/mastra/package.json apps/mastra/package.json
COPY packages/devotional-workspace/package.json packages/devotional-workspace/package.json
COPY packages/experience-schema/package.json packages/experience-schema/package.json
COPY packages/watch-url-policy/package.json packages/watch-url-policy/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
COPY packages/studio-server/package.json packages/studio-server/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/mastra...
COPY apps/mastra apps/mastra
COPY packages/devotional-workspace packages/devotional-workspace
COPY packages/experience-schema packages/experience-schema
COPY packages/watch-url-policy packages/watch-url-policy
COPY packages/studio-contracts packages/studio-contracts
COPY packages/studio-server packages/studio-server
# CLI analysis never starts deployed runtime timers or touches production stores.
# The production entrypoint is separately tested with a real disposable Postgres.
RUN NODE_ENV=development MASTRA_STORAGE_BACKEND=memory CI=true \
    pnpm --filter @forge/mastra build \
    && rm -rf apps/mastra/.mastra/storage
ENV NODE_ENV=production
ENV MASTRA_STUDIO_PATH=/app/apps/mastra/.mastra/output/studio
WORKDIR /app/apps/mastra
CMD ["node", "/app/apps/mastra/.mastra/output/index.mjs"]
