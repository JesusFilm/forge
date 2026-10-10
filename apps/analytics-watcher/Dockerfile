FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
RUN npm install --global pnpm@9.12.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/analytics-watcher/package.json ./apps/analytics-watcher/package.json
RUN pnpm install --filter @forge/analytics-watcher... --frozen-lockfile --ignore-scripts
COPY apps/analytics-watcher ./apps/analytics-watcher
RUN pnpm --filter @forge/analytics-watcher build
CMD ["sh", "apps/analytics-watcher/start.sh"]
