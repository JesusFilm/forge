FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home cms

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cms/package.json apps/cms/package.json

RUN pnpm install --frozen-lockfile --filter @forge/cms...

COPY apps/cms apps/cms

WORKDIR /workspace/apps/cms

RUN pnpm run build
RUN chown -R cms:nodejs /workspace /pnpm

USER cms

EXPOSE 1337

CMD ["pnpm", "run", "start"]
