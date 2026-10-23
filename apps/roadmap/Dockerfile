# syntax=docker/dockerfile:1
# Repository-root context; filter CAs before any package download.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/roadmap/package.json apps/roadmap/package.json
COPY packages/watch-url-policy/package.json packages/watch-url-policy/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter roadmap...
COPY packages/watch-url-policy packages/watch-url-policy
COPY apps/roadmap apps/roadmap
COPY docs/roadmap docs/roadmap
RUN node --import tsx --test apps/roadmap/lib/planned-roadmap-calendar.test.ts \
    && pnpm --filter roadmap build
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3100 ROADMAP_DIR=/app/docs/roadmap
COPY apps/roadmap/verify-image-trust.sh /usr/local/bin/verify-roadmap-image-trust
WORKDIR /app/apps/roadmap
EXPOSE 3100
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3100}"]
