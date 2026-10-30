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
COPY apps/chat/package.json apps/chat/package.json
COPY packages/video-player/package.json packages/video-player/package.json
COPY packages/watch-url-policy/package.json packages/watch-url-policy/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/chat...
COPY apps/chat apps/chat
COPY packages/video-player packages/video-player
COPY packages/watch-url-policy packages/watch-url-policy
RUN CI=true pnpm --filter @forge/chat build
ENV NODE_ENV=production
CMD ["sh", "/app/apps/chat/start-production.sh"]
