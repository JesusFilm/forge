FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS secure-node
FROM mcr.microsoft.com/playwright:v1.61.1-noble
# Keep the browser image while replacing its independently bundled Node/npm.
COPY --from=secure-node /usr/local/bin/node /usr/local/bin/node
COPY --from=secure-node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/bin/node /usr/bin/node \
    && ln -sf /usr/local/bin/node /usr/bin/nodejs \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/* \
    && node -e 'if (process.version !== "v24.22.1") process.exit(1)'
WORKDIR /app
RUN npm install --global pnpm@9.12.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/analytics-watcher/package.json ./apps/analytics-watcher/package.json
RUN pnpm install --filter @forge/analytics-watcher... --frozen-lockfile --ignore-scripts
COPY apps/analytics-watcher ./apps/analytics-watcher
RUN pnpm --filter @forge/analytics-watcher build
CMD ["sh", "apps/analytics-watcher/start.sh"]
