# syntax=docker/dockerfile:1
# Repository-root context; distrust affected roots before package downloads.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agentic/package.json apps/agentic/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/agentic...
COPY apps/agentic apps/agentic
# Public build-only placeholders; production always reads its own runtime config.
# No model, Manager, or storage service can be contacted by this build step.
RUN --network=none NODE_ENV=production CI=true \
    AGENTIC_SERVICE_API_KEY=ci-build-service-token \
    AGENTIC_OPERATOR_API_KEY=ci-build-operator-token \
    AGENTIC_STORAGE_URL=file:/tmp/agentic-build.db \
    AGENTIC_MODEL=openai/gpt-5-mini \
    MANAGER_BASE_URL=http://127.0.0.1:9 \
    MANAGER_AGENTIC_API_KEY=ci-build-manager-token \
    pnpm --filter @forge/agentic build
ENV NODE_ENV=production
WORKDIR /app/apps/agentic
CMD ["node", ".mastra/output/index.mjs"]
