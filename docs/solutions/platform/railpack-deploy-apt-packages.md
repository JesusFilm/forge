# Railway Deploy: Adding System Binaries That Need Custom Apt Repos

## Pattern

Railway's Railpack builder produces minimal Node.js runtime images from default Debian repos. If your app spawns versioned system binaries at runtime (e.g., `pg_dump` v18 to match a PostgreSQL 18 server), and those binaries require a third-party apt repository (e.g., pgdg), **use a Dockerfile instead of Railpack**.

## Problem

The data-snapshot service shells out to `pg_dump` to create database snapshots. Two issues surfaced:

1. **Missing binary**: Railpack's default Node.js image has no `pg_dump` at all (`ENOENT`).
2. **Version mismatch**: Adding `postgresql-client` via `railpack.json` `deploy.aptPackages` installed v15 (Debian bookworm default), but Railway's PostgreSQL is v18.3. `pg_dump` refuses to dump a server newer than itself.

Railpack does not support custom apt repositories — there is no `aptRepositories` field, and custom `steps` with `deployOutputs` would require manually tracking all shared library dependencies.

## Solution

For services that need packages from non-default apt repos, use a Dockerfile with `dockerfilePath` in `railway.toml`:

```toml
[build]
dockerfilePath = "apps/cms/Dockerfile"

[deploy]
releaseCommand = "pnpm data-import-check"
```

The Dockerfile adds the pgdg repo and installs the matching client version:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 && \
    rm -rf /var/lib/apt/lists/*
```

## When to use Railpack vs Dockerfile

| Scenario                                                                          | Use                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Standard Node.js app, no system binaries                                          | Railpack                                        |
| Need system tools from default Debian repos (e.g., `curl`, `ffmpeg`)              | Railpack + `railpack.json` `deploy.aptPackages` |
| Need versioned packages from third-party apt repos (e.g., `postgresql-client-18`) | Dockerfile                                      |

## Railpack aptPackages (for simple cases)

When Railpack is sufficient, use `railpack.json`:

```json
{
  "$schema": "https://schema.railpack.com",
  "deploy": {
    "aptPackages": ["curl"]
  }
}
```

Note: `deploy.aptPackages` installs into the runtime image. `buildAptPackages` is build-time only. The Nixpacks-era `aptPkgs` field in `railway.toml` is silently ignored by Railpack.

## Files in this repo

- `apps/cms/Dockerfile` — Dockerfile with pgdg repo + `postgresql-client-18`
- `apps/cms/railway.toml` — uses `dockerfilePath` to opt out of Railpack
- `apps/roadmap/railway.toml` — example of Railpack builder (no system deps needed)
- `apps/cms/railpack.json` — retained for reference but not used when Dockerfile is active

## Known gaps / watch-outs

- `pg_dump` client version must be >= the server version — always pin to match your Railway PostgreSQL major version
- When Railway upgrades PostgreSQL (e.g., 18 → 19), update the Dockerfile's `postgresql-client-N` accordingly
- `releaseCommand` in `railway.toml` still works with Dockerfile builds — Railway runs it before deploy
- `startCommand` is unnecessary if the Dockerfile has a `CMD` — remove it to avoid confusion
