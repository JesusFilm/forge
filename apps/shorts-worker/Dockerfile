# syntax=docker/dockerfile:1
# apps/shorts-worker — retained devotional Remotion worker.
#
# Build context MUST be the repo root:
#   docker build -f apps/shorts-worker/Dockerfile -t shorts-worker .
# (BuildKit reads apps/shorts-worker/Dockerfile.dockerignore for the context.)
#
# Runtime libraries and Chromium are cached independently of app source.
#
# Digest pin: node:22.23.4-bookworm-slim multi-arch manifest list resolved
# 2026-10-23 via the Docker Hub API. Node >= 22.18 is REQUIRED (default
# type stripping loads the source-shipped @forge/shorts-compositions and
# @forge/devotional-workspace TS at runtime — see the runtime stage notes).
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# ---------------------------------------------------------------------------
# runtime-base — Chromium/Remotion runtime libraries + ffmpeg + fonts.
# Shared by the media stage (which also runs the downloaded browser) and the
# final runtime stage. Package list per plan (Remotion linux-dependencies +
# fallback glyph fonts).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS secure-node
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i -e 's|^mozilla/emSign_ECC_Root_CA_-_G3.crt|!&|' -e 's|^mozilla/Comodo_AAA_Services_root.crt|!&|' /etc/ca-certificates.conf \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/*

FROM secure-node AS runtime-base

COPY apps/shorts-worker/certificates /usr/local/share/devotional-worker/distrust
COPY apps/shorts-worker/install-browser-distrust.sh /usr/local/bin/install-devotional-browser-distrust

RUN apt-get update && apt-get install -y --no-install-recommends \
      libbrotli1 \
      libnss3 \
      libnss3-tools \
      libdbus-1-3 \
      libatk1.0-0 \
      libasound2 \
      libxrandr2 \
      libxkbcommon-dev \
      libxfixes3 \
      libxcomposite1 \
      libxdamage1 \
      libgbm-dev \
      libcups2 \
      libcairo2 \
      libpango-1.0-0 \
      libatk-bridge2.0-0 \
      fonts-noto-color-emoji \
      fonts-noto-cjk \
      ffmpeg \
      ca-certificates \
      curl \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libbrotli1)" ge 1.0.9-2+deb12u1 \
    && sh /usr/local/bin/install-devotional-browser-distrust \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# media-deps — pinned Chromium, independent of workspace source.
# ---------------------------------------------------------------------------
FROM runtime-base AS media-deps

WORKDIR /opt/setup
RUN npm init -y >/dev/null \
    && npm install --no-save @remotion/renderer@4.0.475

# chrome-headless-shell, pinned transitively by the exact @remotion/renderer
# version. ensureBrowser() downloads into <nearest package.json dir>/
# node_modules/.remotion relative to cwd — here that is
# /opt/setup/node_modules/.remotion; the runtime stage copies it to the
# worker's own node_modules/.remotion.
RUN node --input-type=module -e "import('@remotion/renderer').then(({ ensureBrowser }) => ensureBrowser())"

# ---------------------------------------------------------------------------
# build — workspace install + tsc build + baked Remotion bundle.
# ---------------------------------------------------------------------------
FROM secure-node AS build

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

# Manifests first so dependency layers cache across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/shorts-worker/package.json apps/shorts-worker/package.json
COPY packages/devotional-workspace/package.json packages/devotional-workspace/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
# patches/ is REQUIRED: pnpm hashes every root pnpm.patchedDependencies file
# at install time even when the patched package is outside the --filter — a
# missing patch file ENOENTs the install.
COPY patches patches
# --ignore-scripts: the repo root prepare hook (husky) needs the full repo;
# none of this subtree's deps require install scripts at build time.
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts \
      --filter @forge/shorts-worker...

COPY apps/shorts-worker apps/shorts-worker
COPY packages/devotional-workspace packages/devotional-workspace
COPY packages/shorts-compositions packages/shorts-compositions
COPY packages/studio-contracts packages/studio-contracts
RUN pnpm --filter @forge/shorts-worker build \
    && pnpm --filter @forge/shorts-worker prebundle /app/devotional-bundle

# ---------------------------------------------------------------------------
# prod-deps — production-only node_modules, PRESERVING the pnpm workspace
# symlink layout. Deliberately NOT `pnpm deploy`: deploy materializes
# source-shipped workspace packages inside node_modules, and Node refuses to
# type-strip TS under node_modules. Workspace symlinks whose realpaths are
# under /app/packages keep those schemas importable from compiled dist.
# ---------------------------------------------------------------------------
FROM secure-node AS prod-deps

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/shorts-worker/package.json apps/shorts-worker/package.json
COPY packages/devotional-workspace/package.json packages/devotional-workspace/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
# patches/ required here too — same pnpm patchedDependencies hashing as the
# build stage.
COPY patches patches
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @forge/shorts-worker...

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Stable layers first (only change when deps/pins change) …
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/shorts-worker/node_modules /app/apps/shorts-worker/node_modules
COPY --from=prod-deps /app/packages/devotional-workspace/node_modules /app/packages/devotional-workspace/node_modules
COPY --from=prod-deps /app/packages/shorts-compositions/node_modules /app/packages/shorts-compositions/node_modules
COPY --from=prod-deps /app/packages/studio-contracts/node_modules /app/packages/studio-contracts/node_modules
COPY --from=media-deps /opt/setup/node_modules/.remotion /app/apps/shorts-worker/node_modules/.remotion

# … volatile app layers last.
COPY packages/devotional-workspace /app/packages/devotional-workspace
COPY packages/shorts-compositions /app/packages/shorts-compositions
COPY packages/studio-contracts /app/packages/studio-contracts
COPY apps/shorts-worker/package.json /app/apps/shorts-worker/package.json
COPY apps/shorts-worker/verify-image-trust.sh /usr/local/bin/verify-devotional-image-trust
COPY --from=build /app/devotional-bundle /app/devotional-bundle
COPY --from=build /app/apps/shorts-worker/dist /app/apps/shorts-worker/dist

ENV PORT=3012
ENV SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR=/app/devotional-bundle

EXPOSE 3012

WORKDIR /app/apps/shorts-worker
CMD ["node", "dist/server.js"]
