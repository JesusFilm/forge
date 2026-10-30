FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS secure-node
FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48
# Keep the browser image while replacing its independently bundled Node/npm.
COPY --from=secure-node /usr/local/bin/node /usr/local/bin/node
COPY --from=secure-node /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY apps/analytics-watcher/certificates /usr/local/share/analytics-watcher/distrust
COPY apps/analytics-watcher/update-security-ca.sh /usr/local/bin/update-watcher-security-ca
RUN ln -sf /usr/local/bin/node /usr/bin/node \
    && ln -sf /usr/local/bin/node /usr/bin/nodejs \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && sh /usr/local/bin/update-watcher-security-ca \
    && node -e 'if (process.version !== "v24.22.1") process.exit(1)'
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
WORKDIR /app
RUN npm install --global pnpm@9.12.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/analytics-watcher/package.json ./apps/analytics-watcher/package.json
RUN pnpm install --filter @forge/analytics-watcher... --frozen-lockfile --ignore-scripts
COPY apps/analytics-watcher ./apps/analytics-watcher
RUN pnpm --filter @forge/analytics-watcher build
CMD ["sh", "apps/analytics-watcher/start.sh"]
