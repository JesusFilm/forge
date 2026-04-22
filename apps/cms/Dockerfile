FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home cms

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cms/package.json apps/cms/package.json

RUN pnpm install --frozen-lockfile --filter @forge/cms...

COPY apps/cms apps/cms

WORKDIR /workspace/apps/cms

# Placeholder so users-permissions plugin config loads at build; real secret from ECS at runtime
ENV JWT_SECRET=build-placeholder-not-used-at-runtime
RUN pnpm run build
RUN chown -R cms:nodejs /workspace

USER cms

EXPOSE 1337

CMD ["pnpm", "run", "start"]
