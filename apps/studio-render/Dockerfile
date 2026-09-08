# syntax=docker/dockerfile:1
# Repo-root context. Credential-free execution only: no Admin/Manager/provider
# credentials, source acquisition, catalog writes or publication run here.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752
FROM ${NODE_IMAGE} AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libcap2 libseccomp2 libnss3 libdbus-1-3 libatk1.0-0 \
    libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
    libgbm1 libcups2 libcairo2 libpango-1.0-0 libatk-bridge2.0-0 \
    fonts-noto-color-emoji fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential meson ninja-build pkg-config libcap-dev libseccomp-dev curl xz-utils \
    && rm -rf /var/lib/apt/lists/*
# Published SHA: https://github.com/containers/bubblewrap/releases/tag/v0.11.1
RUN curl --fail --location --proto '=https' \
      https://github.com/containers/bubblewrap/releases/download/v0.11.1/bubblewrap-0.11.1.tar.xz -o /tmp/bwrap.tar.xz \
    && echo 'c1b7455a1283b1295879a46d5f001dfd088c0bb0f238abb5e128b3583a246f71  /tmp/bwrap.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/bwrap.tar.xz -C /tmp \
    && meson setup /tmp/bwrap-build /tmp/bubblewrap-0.11.1 --prefix=/usr \
      -Dman=disabled -Dtests=false -Dselinux=disabled -Dbash_completion=disabled -Dzsh_completion=disabled \
    && ninja -C /tmp/bwrap-build
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/studio-render/package.json apps/studio-render/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
COPY packages/shorts-compositions/package.json packages/shorts-compositions/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @forge/studio-render...
COPY apps/studio-render apps/studio-render
COPY packages/studio-contracts packages/studio-contracts
COPY packages/shorts-compositions packages/shorts-compositions
RUN pnpm --filter @forge/studio-render build \
    && pnpm --filter @forge/studio-render --prod deploy /runtime-deps --ignore-scripts
# Exact Remotion version pins Chromium149.0.7790.0. Browser is downloaded at
# build time only; execution has no download or package installation authority.
WORKDIR /app/apps/studio-render
RUN node --input-type=module -e "import('@remotion/renderer').then(({ensureBrowser})=>ensureBrowser())"
# Named context is staged from the retained reviewed archive outside the repo.
# No provider/build credential enters an image layer. See IMAGE.md for CI supply.
COPY --from=studio_codec /codec.tar.xz /tmp/codec.tar.xz
# Both reviewed archives contain byte-identical codec binaries. Accept no other
# packaging; verify the extracted executables independently before final copy.
RUN codec_sha="$(sha256sum /tmp/codec.tar.xz | cut -d ' ' -f 1)" \
    && case "$codec_sha" in \
      da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6) codec_root=ffmpeg-n9.0-latest-linux64-gpl-9.0 ;; \
      e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4) codec_root=ffmpeg-n9.0.1-27-g9b0578816c-linux64-gpl-9.0 ;; \
      *) exit 1 ;; \
    esac \
    && mkdir /codec \
    && tar -xJf /tmp/codec.tar.xz -C /codec --strip-components=2 \
      "$codec_root/bin/ffmpeg" "$codec_root/bin/ffprobe" \
    && echo 'bf626ef18ccc5b1c8d26e2e046a90b998d1554d2bde0dcac0d497ad1886e9aa6  /codec/ffmpeg' | sha256sum -c - \
    && echo 'c7a58858f84f56ce52fee2d09d1c8a56fbd4226e15be15c8c8fe88da395d3a1c  /codec/ffprobe' | sha256sum -c -

FROM runtime-base AS runtime
COPY --from=build /tmp/bwrap-build/bwrap /usr/bin/bwrap
COPY --from=build /app/apps/studio-render/dist/main.mjs /opt/studio-render/main.mjs
COPY --from=build /app/apps/studio-render/dist/child.mjs /opt/studio-render/child.mjs
COPY --from=build /app/apps/studio-render/dist/verify.mjs /opt/studio-render/verify.mjs
COPY --from=build /app/apps/studio-render/dist/guard /opt/studio-render/native/guard
COPY --from=build /app/apps/studio-render/dist/sandbox-init /opt/studio-render/native/sandbox-init
COPY --from=build /app/apps/studio-render/dist/entrypoint /opt/studio-render/native/entrypoint
COPY --from=build /app/apps/studio-render/dist/bundle /opt/studio-render/bundle
COPY --from=build /runtime-deps/node_modules /opt/studio-render/deps
COPY --from=build /app/apps/studio-render/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64 /opt/studio-render/browser
COPY --from=build /codec /opt/studio-render/codec
RUN mkdir -p /work /runtime && cp /usr/local/bin/node /runtime/node \
    && chmod 0755 /work && chmod 0755 /opt/studio-render/native/* /usr/bin/bwrap \
    && find /opt/studio-render /usr -xdev -type f -perm /6000 -exec chmod a-s {} +
USER 1000:1000
ENV PORT=3330
EXPOSE 3330
ENTRYPOINT ["/opt/studio-render/native/entrypoint"]

# Dedicated VM targets: OCI itself owns the only process/mount/network namespace.
# No nested Bubblewrap, API listener or credentials enter these disposable jobs.
FROM runtime-base AS job-base
COPY --from=build /app/apps/studio-render/dist/guard /runtime/guard
COPY --from=build /app/apps/studio-render/dist/sandbox-init /runtime/init
COPY --from=build /codec /codec
RUN mkdir -p /input && cp /usr/local/bin/node /runtime/node \
    && find /usr /runtime /codec -xdev -type f -perm /6000 -exec chmod a-s {} +
USER 1000:1000
WORKDIR /input
ENTRYPOINT ["/runtime/guard"]

FROM job-base AS render-job
COPY --from=build /app/apps/studio-render/dist/child.mjs /runtime/child.mjs
COPY --from=build /app/apps/studio-render/dist/bundle /bundle
COPY --from=build /runtime-deps/node_modules /deps
COPY --from=build /app/apps/studio-render/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64 /browser
USER root
RUN ln -s /deps/@remotion/renderer/dist/index.js /runtime/renderer.cjs
USER 1000:1000

FROM job-base AS verify-job
COPY --from=build /app/apps/studio-render/dist/verify.mjs /runtime/child.mjs

# Host-only release export. This target does not contain pool/registry credentials
# and is never started as an authored execution container.
FROM ${NODE_IMAGE} AS host-package
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source/apps/studio-render
COPY apps/studio-render/native/vm-watchdog.c native/vm-watchdog.c
COPY apps/studio-render/src/vm src/vm
COPY apps/studio-render/ops/package-supervisor.py ops/package-supervisor.py
COPY apps/studio-render/ops/forge-studio-supervisor.service ops/forge-studio-supervisor.service
RUN mkdir /export \
    && gcc -O2 -Wall -Wextra -Werror native/vm-watchdog.c -o /tmp/vm-watchdog \
    && python3 ops/package-supervisor.py --node /usr/local/bin/node --watchdog /tmp/vm-watchdog --output /export/supervisor.tar \
    && cd /export && sha256sum supervisor.tar > SHA256SUMS
FROM scratch AS host-bundle
COPY --from=host-package /export/ /

# Preserve the previous default target for explicit historical qualification.
# VM installation requires named render-job and verify-job targets.
FROM runtime AS default
