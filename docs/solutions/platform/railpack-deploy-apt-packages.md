# Railpack Deploy: Adding System Binaries via aptPackages

## Pattern

Railway's Railpack builder produces minimal Node.js runtime images that do not include system tools like `pg_dump`, `curl`, or other OS-level binaries. If your application spawns system binaries at runtime (e.g., via `child_process.exec`), those binaries must be explicitly declared in `railpack.json` under `deploy.aptPackages`.

## Problem

The data-snapshot service shells out to `pg_dump` to create database snapshots. After Railway switched to the Railpack builder (replacing Nixpacks), deploys succeeded but `pg_dump` was missing at runtime — the binary simply was not in the image. The process failed with `ENOENT` when trying to spawn it.

The old Nixpacks-era `railway.toml` field `aptPkgs` under `[build]` has **no effect** under Railpack. Railpack uses its own configuration file.

## Solution

Create a `railpack.json` in the service's root directory:

```json
{
  "$schema": "https://schema.railpack.com",
  "deploy": {
    "aptPackages": ["postgresql-client"]
  }
}
```

### Key fields

| Field                | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `$schema`            | Provides editor validation and autocomplete from `https://schema.railpack.com` |
| `deploy.aptPackages` | Packages installed into the **runtime** image — available when the app runs    |
| `buildAptPackages`   | Packages installed only at **build time** — not available at runtime           |

Use `deploy.aptPackages` for any binary your app spawns at runtime. Use `buildAptPackages` only for tools needed during the build step (e.g., native compilation headers).

## Why not railway.toml?

`railway.toml` can declare `builder = "railpack"` to opt in to the Railpack builder, but runtime package installation is configured in `railpack.json`, not `railway.toml`. The Nixpacks-era `[build] aptPkgs` array is silently ignored by Railpack.

## Files in this repo

- `apps/roadmap/railway.toml` — example of `builder = "railpack"` declaration
- Service-level `railpack.json` files — where `deploy.aptPackages` is declared

## Known gaps / watch-outs

- `deploy.aptPackages` uses Debian/Ubuntu package names — check the correct package name for your distro (e.g., `postgresql-client` not `pg_dump`)
- If you need a specific major version of a tool, use the versioned package name (e.g., `postgresql-client-16`)
- Adding packages increases image size — only include what the service actually needs at runtime
- When migrating a service from Nixpacks to Railpack, audit `railway.toml` for any `aptPkgs` entries and move them to `railpack.json` under `deploy.aptPackages`
