# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && apt-get install -y --no-install-recommends libgnutls30 libx264-164 libmp3lame0 curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS media-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config nasm libgnutls28-dev libx264-dev libmp3lame-dev zlib1g-dev xz-utils \
    && rm -rf /var/lib/apt/lists/*
COPY apps/manager/build-security-ffmpeg.sh /usr/local/bin/build-security-ffmpeg
RUN sh /usr/local/bin/build-security-ffmpeg

FROM base AS runtime
COPY --from=media-build /opt/security-ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=media-build /opt/security-ffmpeg/bin/ffprobe /usr/local/bin/ffprobe
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/manager/package.json apps/manager/package.json
COPY packages/admin-graphql/package.json packages/admin-graphql/package.json
COPY packages/automation-contracts/package.json packages/automation-contracts/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
COPY packages/studio-server/package.json packages/studio-server/package.json
COPY packages/video-player/package.json packages/video-player/package.json
COPY packages/watch-url-policy/package.json packages/watch-url-policy/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/manager...
COPY apps/manager apps/manager
COPY packages/admin-graphql packages/admin-graphql
COPY packages/automation-contracts packages/automation-contracts
COPY packages/shorts-compositions packages/shorts-compositions
COPY packages/studio-contracts packages/studio-contracts
COPY packages/studio-server packages/studio-server
COPY packages/video-player packages/video-player
COPY packages/watch-url-policy packages/watch-url-policy
ARG NEXT_PUBLIC_WATCH_URL
RUN CI=true MUX_TOKEN_ID=synthetic-build-id MUX_TOKEN_SECRET=synthetic-build-secret \
    OPENROUTER_API_KEY=synthetic-build-openrouter MANAGER_DATA_MODE=admin \
    pnpm --filter @forge/manager build \
    && cp -r apps/manager/.next/static apps/manager/.next/standalone/apps/manager/.next/static
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
CMD ["node", "/app/apps/manager/.next/standalone/apps/manager/server.js"]
