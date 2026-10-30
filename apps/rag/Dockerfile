# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/rag/package.json apps/rag/package.json
COPY packages/rag-contracts/package.json packages/rag-contracts/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/rag...
COPY apps/rag apps/rag
COPY packages/rag-contracts packages/rag-contracts
RUN pnpm --filter @forge/rag db:generate
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@forge/rag", "start"]
