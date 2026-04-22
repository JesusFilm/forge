---
title: Running Strapi CMS locally with Docker Postgres
category: cms
date: 2026-03-25
tags: [strapi, postgres, docker, devcontainer, local-dev, setup]
severity: medium
components: [apps/cms, .devcontainer]
---

# Running Strapi CMS Locally with Docker Postgres

## Problem

Running `pnpm dev` (or `pnpm --filter @forge/cms dev`) fails with:

```
AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1142:49)
    at afterConnectMultiple (node:net:1723:7)
```

No useful context from the default error output — the `ECONNREFUSED` doesn't say what host/port it's trying to connect to.

## Investigation Steps

1. **Checked `.env`** — found `DATABASE_CLIENT=sqlite` and `DATABASE_FILENAME=.tmp/data.db`, which suggested SQLite should work.

2. **Checked `config/database.ts`** — discovered the database config is **hardcoded to `postgres`** with defaults (`localhost:5432`, user `strapi`, db `strapi`). The `DATABASE_CLIENT` env var in `.env` is unused — Strapi v5's config file is the source of truth, not the env var.

3. **Ran with `NODE_DEBUG=net`** — confirmed Strapi was trying to connect to `localhost:5432` (PostgreSQL) and failing because no Postgres was running.

4. **Found `.devcontainer/docker-compose.yml`** — the repo provides a Postgres 16 container with credentials `forge/forge/forge` on port 5432.

## Root Cause

The CMS requires a running PostgreSQL instance. The `config/database.ts` is hardcoded to use `postgres` (ignoring `DATABASE_CLIENT=sqlite` in `.env`). The database is expected to be provided by the devcontainer's Docker Compose setup.

## Solution

### Step 1: Start Docker Desktop

```bash
open -a Docker
# Wait for Docker daemon to be ready
```

### Step 2: Start the Postgres container

```bash
cd .devcontainer
docker compose up db -d
```

Verify it's ready:

```bash
docker exec devcontainer-db-1 pg_isready -U forge
# Expected: /var/run/postgresql:5432 - accepting connections
```

### Step 3: Set database credentials in `apps/cms/.env`

The docker-compose uses `forge/forge/forge` but `config/database.ts` defaults to `strapi/strapi/strapi`. Add these to `apps/cms/.env`:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=forge
DATABASE_USERNAME=forge
DATABASE_PASSWORD=forge
```

### Step 4: Start the CMS

```bash
pnpm --filter @forge/cms dev
```

Strapi will be available at `http://localhost:1337/admin`. On first run, you'll need to create an admin account.

### Port conflict note

If port 5432 is already in use (e.g., by another Docker Postgres container from a different project), find and stop it:

```bash
docker ps -a --filter "publish=5432"
docker stop <container_name>
```

Then retry `docker compose up db -d`.

## Running CMS + Web Together

```bash
# From repo root:
pnpm --filter @forge/cms dev &
pnpm --filter @forge/web dev &
```

Or use `pnpm dev` (runs all apps via Turborepo), but this also starts `@forge/manager` which may fail if its dependencies aren't installed.

- **CMS**: http://localhost:1337/admin
- **Web**: http://localhost:3000

The web app needs the CMS running to fetch data via GraphQL.

## Prevention

- The `.env` file's `DATABASE_CLIENT=sqlite` is misleading — consider removing it or adding a comment that `config/database.ts` overrides it.
- Document the Docker prerequisite in `apps/cms/CLAUDE.md` or a `CONTRIBUTING.md`.
- Consider adding a `predev` script to `apps/cms/package.json` that checks if Postgres is reachable before starting Strapi, with a helpful error message.
