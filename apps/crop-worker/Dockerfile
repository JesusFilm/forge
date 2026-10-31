# syntax=docker/dockerfile:1
# Repository-root context; all dependency downloads use the patched runtime.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && apt-get install -y --no-install-recommends libgnutls30 libx264-164 curl libbrotli1 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libbrotli1)" ge 1.0.9-2+deb12u1 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
WORKDIR /app

FROM base AS media-build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config nasm libgnutls28-dev libx264-dev zlib1g-dev xz-utils \
    && rm -rf /var/lib/apt/lists/*
COPY apps/crop-worker/build-security-ffmpeg.sh /usr/local/bin/build-security-ffmpeg
RUN sh /usr/local/bin/build-security-ffmpeg

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/crop-worker/package.json apps/crop-worker/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/crop-worker...
COPY apps/crop-worker apps/crop-worker
RUN pnpm --filter @forge/crop-worker build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/crop-worker/package.json apps/crop-worker/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --filter @forge/crop-worker...

FROM base AS runtime
ENV NODE_ENV=production PORT=3011
COPY --from=media-build /opt/security-ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=media-build /opt/security-ffmpeg/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=production-dependencies /app/apps/crop-worker/node_modules /app/apps/crop-worker/node_modules
COPY apps/crop-worker/package.json /app/apps/crop-worker/package.json
COPY --from=build /app/apps/crop-worker/dist /app/apps/crop-worker/dist
COPY apps/crop-worker/verify-image-trust.sh /usr/local/bin/verify-crop-image-trust
WORKDIR /app/apps/crop-worker
EXPOSE 3011
CMD ["node", "dist/server.js"]
