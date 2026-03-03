FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cms/package.json apps/cms/package.json

RUN pnpm install --frozen-lockfile --filter @forge/cms...

COPY apps/cms apps/cms

WORKDIR /workspace/apps/cms

RUN pnpm run build

EXPOSE 1337

CMD ["pnpm", "run", "start"]
