# syntax=docker/dockerfile:1
# apps/shorts-worker — Remotion render worker for Shorts Studio.
#
# Build context MUST be the repo root:
#   docker build -f apps/shorts-worker/Dockerfile -t shorts-worker .
# (BuildKit reads apps/shorts-worker/Dockerfile.dockerignore for the context.)
#
# LAYER ORDER (plan perf): apt libs, whisper.cpp, the ~1.6GB model, and the
# Chromium download all live in stages that only depend on pinned versions —
# NEVER on app source — so code deploys don't reship the model layer.
#
# Digest pin: node:22-bookworm-slim multi-arch manifest list resolved
# 2026-06-11 via the Docker Hub API. Node >= 22.18 is REQUIRED (default
# type stripping loads the source-shipped @forge/shorts-compositions TS at
# runtime — see the runtime stage notes).
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752

# ---------------------------------------------------------------------------
# runtime-base — Chromium/Remotion runtime libraries + ffmpeg + fonts.
# Shared by the media stage (which also runs the downloaded browser) and the
# final runtime stage. Package list per plan (Remotion linux-dependencies +
# fallback glyph fonts).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime-base

RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 \
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
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# media-deps — whisper.cpp (compiled), the large-v3-turbo model (SHA-256
# verified), and chrome-headless-shell. Installed from a STANDALONE npm
# project (not the workspace) so these layers are invalidated only by the
# pinned versions in this file.
# ---------------------------------------------------------------------------
FROM runtime-base AS media-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      cmake \
      git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/setup
RUN npm init -y >/dev/null \
    && npm install --no-save \
      @remotion/install-whisper-cpp@4.0.475 \
      @remotion/renderer@4.0.475

# whisper.cpp supply-chain pin: tag v1.7.4 == commit
# 8a9ad7844d6e2a10cddf4b92de4089d7ac2b14a9 (github.com/ggml-org/whisper.cpp,
# resolved 2026-06-11). installWhisperCpp()/transcribe() require a SEMVER
# version string (a raw commit SHA breaks their compareVersions-based
# executable-path selection), so we install by semver and HARD-VERIFY the
# checked-out commit SHA — a moved tag fails the build. Keep
# WHISPER_CPP_VERSION in sync with SHORTS_WORKER_WHISPER_CPP_VERSION below
# and config/env.ts's default.
ENV WHISPER_CPP_VERSION=1.7.4
ENV WHISPER_CPP_COMMIT_SHA=8a9ad7844d6e2a10cddf4b92de4089d7ac2b14a9
RUN node --input-type=module -e "import('@remotion/install-whisper-cpp').then(({ installWhisperCpp }) => installWhisperCpp({ to: '/opt/whisper', version: process.env.WHISPER_CPP_VERSION }))" \
    && ACTUAL_SHA="$(git -C /opt/whisper rev-parse HEAD)" \
    && echo "whisper.cpp HEAD: $ACTUAL_SHA" \
    && test "$ACTUAL_SHA" = "$WHISPER_CPP_COMMIT_SHA"

# Model supply-chain pin: known-good SHA-256 of ggml-large-v3-turbo.bin,
# resolved 2026-06-11 from the HuggingFace LFS pointer
# (https://huggingface.co/ggerganov/whisper.cpp/raw/main/ggml-large-v3-turbo.bin,
# `oid sha256:<hash>` line). The download is verified against this CONSTANT —
# never against a build-time fetch of the pointer, which lives on the same
# mutable `main` ref as the model bytes (self-referential trust: an upstream
# re-push would rotate both together). To rotate deliberately (intentional
# model upgrade): curl the LFS pointer above, read the `oid sha256:` line,
# and update this ARG — same operational posture as WHISPER_CPP_COMMIT_SHA.
# Rotating invalidates (and reships) the ~1.6GB model layer.
ARG WHISPER_MODEL_SHA256=1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69
RUN mkdir -p /opt/whisper-models \
    && node --input-type=module -e "import('@remotion/install-whisper-cpp').then(({ downloadWhisperModel }) => downloadWhisperModel({ model: 'large-v3-turbo', folder: '/opt/whisper-models' }))" \
    && echo "${WHISPER_MODEL_SHA256}  /opt/whisper-models/ggml-large-v3-turbo.bin" | sha256sum -c -

# chrome-headless-shell, pinned transitively by the exact @remotion/renderer
# version. ensureBrowser() downloads into <nearest package.json dir>/
# node_modules/.remotion relative to cwd — here that is
# /opt/setup/node_modules/.remotion; the runtime stage copies it to the
# worker's own node_modules/.remotion.
RUN node --input-type=module -e "import('@remotion/renderer').then(({ ensureBrowser }) => ensureBrowser())"

# ---------------------------------------------------------------------------
# build — workspace install + tsc build + baked Remotion bundle.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

# Manifests first so dependency layers cache across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/shorts-worker/package.json apps/shorts-worker/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
# patches/ is REQUIRED: pnpm hashes every root pnpm.patchedDependencies file
# at install time even when the patched package is outside the --filter — a
# missing patch file ENOENTs the install.
COPY patches patches
# --ignore-scripts: the repo root prepare hook (husky) needs the full repo;
# none of this subtree's deps require install scripts at build time.
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts \
      --filter @forge/shorts-worker...

COPY apps/shorts-worker apps/shorts-worker
COPY packages/shorts-compositions packages/shorts-compositions
RUN pnpm --filter @forge/shorts-worker build \
    && pnpm --filter @forge/shorts-worker prebundle /app/bundle

# ---------------------------------------------------------------------------
# prod-deps — production-only node_modules, PRESERVING the pnpm workspace
# symlink layout. Deliberately NOT `pnpm deploy`: deploy materializes
# @forge/shorts-compositions inside node_modules, and Node refuses to
# type-strip TS under node_modules — the workspace symlink (whose realpath
# is /app/packages/shorts-compositions, OUTSIDE node_modules) is what makes
# the source-shipped schema importable from compiled dist at runtime.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/shorts-worker/package.json apps/shorts-worker/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
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
COPY --from=prod-deps /app/packages/shorts-compositions/node_modules /app/packages/shorts-compositions/node_modules
COPY --from=media-deps /opt/whisper /opt/whisper
COPY --from=media-deps /opt/whisper-models /opt/whisper-models
COPY --from=media-deps /opt/setup/node_modules/.remotion /app/apps/shorts-worker/node_modules/.remotion

# … volatile app layers last.
COPY packages/shorts-compositions /app/packages/shorts-compositions
COPY apps/shorts-worker/package.json /app/apps/shorts-worker/package.json
COPY --from=build /app/bundle /app/bundle
COPY --from=build /app/apps/shorts-worker/dist /app/apps/shorts-worker/dist

ENV PORT=3012
ENV SHORTS_WORKER_BUNDLE_DIR=/app/bundle
ENV SHORTS_WORKER_WHISPER_MODEL_PATH=/opt/whisper-models/ggml-large-v3-turbo.bin
ENV SHORTS_WORKER_WHISPER_CPP_DIR=/opt/whisper
ENV SHORTS_WORKER_WHISPER_CPP_VERSION=1.7.4

EXPOSE 3012

WORKDIR /app/apps/shorts-worker
CMD ["node", "dist/server.js"]
