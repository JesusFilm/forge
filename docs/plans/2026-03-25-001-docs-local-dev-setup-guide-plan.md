---
title: "Local Development Setup Guide"
type: docs
status: completed
date: 2026-03-25
---

# Local Development Setup Guide

Complete steps to go from `git clone` to a running CMS + web app. Written so Claude Code (or any developer) can follow without guesswork.

## Prerequisites

- macOS (arm64/x86_64)
- Node.js 24+ (via Homebrew or fnm)
- Docker Desktop
- Git with SSH configured

## Step 1: Clone the Repo

```bash
git clone git@github-tandem:JesusFilm/forge.git
cd forge
```

> **SSH host alias:** The remote uses `github-tandem` — this must be configured in `~/.ssh/config` for the up-tandem account.

## Step 2: Install pnpm

The repo pins `pnpm@9.12.3` in `package.json` → `"packageManager"`. Activate it via corepack:

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
```

Verify: `pnpm --version` → `9.12.3`

## Step 3: Install Dependencies

```bash
pnpm install
```

> **Note:** If prompted "The modules directories will be removed and reinstalled from scratch. Proceed?", answer `y`.

Peer dependency warnings for Strapi, Supabase, and React Native are expected and harmless.

## Step 4: Start Docker Desktop

```bash
open -a Docker
```

Wait for the daemon to be ready:

```bash
docker ps  # should return without error
```

## Step 5: Choose Your Environment

### Option A: Devcontainer (Recommended)

Everything runs inside Docker — Postgres included, env vars pre-configured.

```bash
npm install -g @devcontainers/cli   # one-time
devcontainer up --workspace-folder .
```

This builds the app container and starts a Postgres 16 sidecar. The `DATABASE_URL` env var (`postgresql://forge:forge@db:5432/forge`) is set automatically in `devcontainer.json`.

**Port conflict:** If port 5432 is already in use by another project's Postgres:

```bash
docker ps -a --filter "publish=5432"
docker stop <offending_container>
```

Then re-run `devcontainer up`.

**Running commands inside the container:**

```bash
# The devcontainer uses fnm for Node — must init it first
docker exec -it forge_devcontainer-app-1 bash -c \
  'export PATH="/home/vscode/.fnm:$PATH" && eval "$(fnm env)" && <your_command>'
```

**Port forwarding** (container ports aren't exposed to host by default):

```bash
# Forward CMS (1337) and Web (3000) using socat containers
docker run --rm -d --name pf-cms --network forge_devcontainer_default \
  -p 1337:1337 alpine/socat TCP-LISTEN:1337,fork,reuseaddr TCP:forge_devcontainer-app-1:1337

docker run --rm -d --name pf-web --network forge_devcontainer_default \
  -p 3000:3000 alpine/socat TCP-LISTEN:3000,fork,reuseaddr TCP:forge_devcontainer-app-1:3000
```

### Option B: Local (Without Devcontainer)

Start only the Postgres container, run Node apps natively.

```bash
cd .devcontainer
docker compose up db -d
cd ..
```

Verify Postgres:

```bash
docker exec devcontainer-db-1 pg_isready -U forge
# Expected: accepting connections
```

## Step 6: Configure Environment Variables

### CMS (`apps/cms/.env`)

**Critical:** `config/database.ts` is hardcoded to `postgres`. The `DATABASE_CLIENT=sqlite` in `.env` is **ignored**. You must set Postgres credentials matching the Docker container.

Ensure these are in `apps/cms/.env`:

```env
HOST=0.0.0.0
PORT=1337

# Database — must match .devcontainer/docker-compose.yml credentials
DATABASE_HOST=localhost          # Use 'db' if running inside devcontainer
DATABASE_PORT=5432
DATABASE_NAME=forge
DATABASE_USERNAME=forge
DATABASE_PASSWORD=forge

# API token — must match STRAPI_API_TOKEN in apps/web/.env.local
# Generate one or use the existing value from apps/web/.env.local
STRAPI_INTERNAL_API_TOKEN=<paste_value_from_web_env>
```

**Inside devcontainer:** `DATABASE_URL` is already set via `devcontainer.json` → `containerEnv`. You still need `STRAPI_INTERNAL_API_TOKEN`.

**How to get the token value:** Copy `STRAPI_API_TOKEN` from `apps/web/.env.local` and set it as `STRAPI_INTERNAL_API_TOKEN` in `apps/cms/.env`. The bootstrap (`src/bootstrap/internal-api-token.ts`) hashes and stores this token so the web app can authenticate.

### Web (`apps/web/.env.local`)

Ensure these are present:

```env
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:1337/graphql
INTERNAL_GRAPHQL_URL=http://localhost:1337/graphql
STRAPI_API_TOKEN=<your_token>
STRAPI_PREVIEW_SECRET=<any_string>
REVALIDATION_SECRET=<any_string>
```

> **Validation:** The web app uses `@t3-oss/env-nextjs` in `src/env.ts`. It will crash on startup if any of `INTERNAL_GRAPHQL_URL`, `STRAPI_API_TOKEN`, `STRAPI_PREVIEW_SECRET`, or `REVALIDATION_SECRET` are missing.

**Fetch secrets from Doppler** (if you have access):

```bash
pnpm --filter @forge/cms fetch-secrets
pnpm --filter @forge/web fetch-secrets
```

## Step 7: Enable Easter Seed (Local Dev Only)

The database starts empty. The easter experience seed (`src/bootstrap/seed-easter.ts`) is exported but **not called** in production bootstrap.

Edit `apps/cms/src/index.ts` to re-enable it for local dev:

```typescript
import { seedEaster } from "./bootstrap/seed-easter"

// Inside bootstrap():
if (process.env.NODE_ENV !== "production") {
  await seedEaster(strapi)
}
```

> **Important:** Do not commit this change. It's for local dev only. The seed creates videos, an easter experience with all sections (VideoHero, EasterDates, BibleQuotes, MediaCollection, RelatedQuestions, etc.).

Alternatively, if Doppler secrets include `PROD_BASE_URL` and `PROD_DATA_SNAPSHOT_SECRET`, you can import production data:

```bash
pnpm --filter @forge/cms data-import
```

## Step 8: Start the Dev Servers

### Option A: Devcontainer

```bash
# From host — exec into container with fnm initialized
FNM_INIT='export PATH="/home/vscode/.fnm:$PATH" && eval "$(fnm env)"'

# Source .env so STRAPI_INTERNAL_API_TOKEN is available
docker exec -d forge_devcontainer-app-1 bash -c "$FNM_INIT && cd /workspace/apps/cms && source .env && STRAPI_INTERNAL_API_TOKEN=\$STRAPI_INTERNAL_API_TOKEN pnpm dev > /tmp/cms.log 2>&1"
docker exec -d forge_devcontainer-app-1 bash -c "$FNM_INIT && cd /workspace && pnpm --filter @forge/web dev > /tmp/web.log 2>&1"

# Check logs
docker exec forge_devcontainer-app-1 tail -5 /tmp/cms.log
docker exec forge_devcontainer-app-1 tail -5 /tmp/web.log
```

### Option B: Local

```bash
pnpm --filter @forge/cms dev &
pnpm --filter @forge/web dev &
```

Or run all apps: `pnpm dev` (uses Turborepo, but `@forge/manager` may fail if its deps aren't fully installed).

## Step 9: Create Strapi Admin Account

On first run with a fresh database, visit `http://localhost:1337/admin` and create an admin account.

For local dev, store credentials in `apps/cms/.strapi-admin-creds.local` (gitignored):

```
Email:    admin@forge.local
Password: ForgeAdmin2026!
```

## Step 10: Verify

| Service        | URL                                | Expected               |
| -------------- | ---------------------------------- | ---------------------- |
| Strapi Admin   | http://localhost:1337/admin        | Dashboard              |
| Strapi GraphQL | http://localhost:1337/graphql      | GraphQL playground     |
| Web App        | http://localhost:3000              | Next.js app            |
| Easter Page    | http://localhost:3000/watch/easter | Full easter experience |

## Troubleshooting

### `ECONNREFUSED` when starting CMS

**Cause:** Postgres isn't running or credentials don't match.

**Fix:** Start the Docker db container and ensure `apps/cms/.env` has `DATABASE_HOST=localhost` (or `db` inside devcontainer), `DATABASE_USERNAME=forge`, `DATABASE_PASSWORD=forge`, `DATABASE_NAME=forge`.

### `Invalid environment variables` on web app

**Cause:** Missing env vars in `apps/web/.env.local`.

**Fix:** Ensure `INTERNAL_GRAPHQL_URL`, `STRAPI_API_TOKEN`, `STRAPI_PREVIEW_SECRET`, and `REVALIDATION_SECRET` are all set.

### `Unable to authenticate with the content service`

**Cause:** `STRAPI_API_TOKEN` (web) doesn't match `STRAPI_INTERNAL_API_TOKEN` (CMS), or the CMS bootstrap hasn't created the token yet.

**Fix:** Ensure both values match. Restart the CMS — the bootstrap in `internal-api-token.ts` will hash and store the token on startup.

### `No content is available` on `/watch/easter`

**Cause:** Fresh database with no content.

**Fix:** Enable the easter seed in `apps/cms/src/index.ts` (see Step 7) and restart the CMS. Or run `pnpm --filter @forge/cms data-import` if you have production snapshot access.

### Port 5432 already in use

**Cause:** Another Docker Postgres container from a different project.

**Fix:**

```bash
docker ps -a --filter "publish=5432"
docker stop <container_name>
```

### DNS resolution fails inside devcontainer (`db: NXDOMAIN`)

**Cause:** Containers were partially recreated, leaving the db on a stale network.

**Fix:**

```bash
cd .devcontainer
docker compose --project-name forge_devcontainer down
docker compose --project-name forge_devcontainer up -d --force-recreate
```

### `pnpm: command not found` inside devcontainer

**Cause:** fnm (Fast Node Manager) isn't initialized in the shell.

**Fix:** Always prefix commands with:

```bash
export PATH="/home/vscode/.fnm:$PATH" && eval "$(fnm env)"
```
