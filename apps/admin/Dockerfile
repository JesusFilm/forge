# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS postgres-clients
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
COPY apps/admin/build-postgres-clients.sh /tmp/build-postgres-clients.sh
RUN sh /tmp/build-postgres-clients.sh

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
COPY scripts/update-security-ca.sh /usr/local/bin/update-security-ca
RUN sh /usr/local/bin/update-security-ca \
    && apt-get install -y --no-install-recommends libreadline8 liblz4-1 libzstd1 libicu72 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@9.12.3
ENV SSL_CERT_DIR=/usr/local/share/security-ca/certs
ENV NEXT_TELEMETRY_DISABLED=1
ENV PATH=/opt/forge-postgres/bin:$PATH
COPY --from=postgres-clients /opt/forge-postgres /opt/forge-postgres
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/admin/package.json apps/admin/package.json
COPY packages/experience-schema/package.json packages/experience-schema/package.json
COPY packages/automation-contracts/package.json packages/automation-contracts/package.json
COPY packages/feature-flags/package.json packages/feature-flags/package.json
COPY packages/studio-contracts/package.json packages/studio-contracts/package.json
COPY packages/studio-server/package.json packages/studio-server/package.json
COPY packages/watch-url-policy/package.json packages/watch-url-policy/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --ignore-scripts --filter @forge/admin...
COPY apps/admin apps/admin
COPY packages/experience-schema packages/experience-schema
COPY packages/automation-contracts packages/automation-contracts
COPY packages/feature-flags packages/feature-flags
COPY packages/studio-contracts packages/studio-contracts
COPY packages/studio-server packages/studio-server
COPY packages/watch-url-policy packages/watch-url-policy
COPY scripts/upload-datadog-sourcemaps.mjs scripts/upload-datadog-sourcemaps.mjs
# These are browser-visible RUM configuration and release identifiers only.
ARG NEXT_PUBLIC_DATADOG_APPLICATION_ID
ARG NEXT_PUBLIC_DATADOG_CLIENT_TOKEN
ARG NEXT_PUBLIC_DATADOG_SITE
ARG NEXT_PUBLIC_DATADOG_ENV
ARG NEXT_PUBLIC_DATADOG_VERSION
ARG RAILWAY_GIT_COMMIT_SHA
ARG RAILWAY_ENVIRONMENT_NAME
RUN CI=true \
    DATABASE_URL=postgresql://ci:ci@127.0.0.1:9/admin_image_build \
    ADMIN_SESSION_SECRET=synthetic-image-build-secret-with-no-authority \
    AUTH_ISSUER_URL=https://auth.example.invalid/api/auth \
    AUTH_ADMIN_CLIENT_ID=synthetic-admin-image \
    pnpm --filter @forge/admin build
ENV NODE_ENV=production
CMD ["sh", "/app/apps/admin/start-production.sh"]
