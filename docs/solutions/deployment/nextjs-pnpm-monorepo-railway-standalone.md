---
title: "Railway + Next.js monorepo deployment: standalone mode pitfalls and runtime file access"
category: "deployment"
date: "2026-03-30"
tags:
  - railway
  - next.js
  - pnpm
  - turborepo
  - monorepo
  - standalone
  - deployment
  - railpack
severity: "high"
component: "apps/roadmap"
symptoms:
  - "Standalone output flattens monorepo paths — files outside the app directory are unreachable at runtime"
  - "Railway healthcheck fails with connection refused — server binds to container hostname instead of 0.0.0.0"
  - "[deploy.env] section in railway.toml silently ignored — env vars not applied"
  - "Dashboard renders with zero features — process.cwd() resolves to unexpected path in standalone mode"
  - "Deploy succeeds but app returns empty data with no errors"
---

## Problem

Deploying `apps/roadmap` (Next.js) to Railway in a pnpm monorepo. The app reads markdown files from `docs/roadmap/` at runtime. Multiple deploy iterations failed before finding a working approach.

## Root Cause

Two compounding issues:

1. **Next.js standalone output + railpack flattens monorepo paths.** With `output: "standalone"`, Next.js traces dependencies and copies them to `.next/standalone/`. In a monorepo with railpack, the directory structure gets reorganized — `apps/roadmap/` ends up at `standalone/roadmap/` not `standalone/apps/roadmap/`. This breaks `process.cwd()`-relative path assumptions and makes it impossible to reliably locate files outside the app directory (like `docs/roadmap/`).

2. **Railway's `[deploy.env]` in `railway.toml` is unreliable.** Environment variables defined in the toml's deploy section are not consistently applied at runtime. `HOSTNAME=0.0.0.0` was silently dropped, causing Next.js to bind to the container hostname instead of `0.0.0.0`, making the server unreachable through Railway's proxy.

## Investigation Steps

### Attempt 1: Standalone + copy commands
Used `output: "standalone"` with a complex `startCommand` that copies `docs/roadmap/`, `public/`, and `.next/static` into the standalone output. **Failed** — nixpacks `COPY . /app` overwrites build output, `mkdir -p` was missing for parent dirs, and the path structure was wrong.

### Attempt 2: Switch to railpack
Railpack has better monorepo support, but the standalone path flattening persisted — app placed at `standalone/roadmap/` not `standalone/apps/roadmap/`.

### Attempt 3: Healthcheck debugging
Server started but healthcheck failed. Root cause: `HOSTNAME` env var not applied from `[deploy.env]`. Fixed via CLI: `railway vars set HOSTNAME=0.0.0.0`.

### Attempt 4: Empty data debugging
Server responded 200 but returned empty feature lists. `process.cwd()` inside standalone didn't match where `docs/roadmap/` was copied. Added debug `ls` logging to the start command to discover the actual container layout.

### Attempt 5 (Final): Abandon standalone
Removed `output: "standalone"` entirely and ran `next start` directly.

## Solution

**Principle:** Do not use `output: "standalone"` when the app reads filesystem data from outside its own directory in a monorepo. Run the app in-place with an env var for the external data path.

### railway.toml

```toml
[build]
builder = "railpack"
buildCommand = "corepack prepare pnpm@9.12.3 --activate && pnpm install --frozen-lockfile && pnpm --filter roadmap build"
watchPatterns = ["apps/roadmap/**", "docs/roadmap/**"]

[deploy]
startCommand = "cd apps/roadmap && npx next start -p ${PORT:-3100}"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

### next.config.ts

```typescript
const nextConfig: NextConfig = {
  // NO output: "standalone"
  // Standalone breaks monorepo apps that read external filesystem data
};
```

### Data path resolution (lib/features.ts)

```typescript
const ROADMAP_DIR = process.env.ROADMAP_DIR
  ? path.resolve(process.env.ROADMAP_DIR)
  : path.join(process.cwd(), "../../docs/roadmap");
```

### Environment variables (set via CLI, NOT toml)

```bash
railway vars set HOSTNAME=0.0.0.0
railway vars set ROADMAP_DIR=/app/docs/roadmap
```

## Prevention

### Pre-Deploy Checklist for Railway Next.js Monorepo Apps

- [ ] `next.config` does NOT set `output: "standalone"` (unless app is fully self-contained)
- [ ] `railway.toml` build command pins pnpm version matching root `package.json`
- [ ] `railway.toml` start command uses `-p ${PORT:-<default>}`
- [ ] `HOSTNAME=0.0.0.0` set in Railway dashboard/CLI (not only in `railway.toml`)
- [ ] All cross-directory file paths are env-var driven with local-dev fallbacks
- [ ] All critical env vars set in Railway dashboard/CLI (not only in `[deploy.env]`)
- [ ] `watchPatterns` include both the app directory AND sibling directories it reads from
- [ ] After first deploy: verify external directory access via logs

### What NOT to do

- **Do NOT use `output: "standalone"` for apps reading files outside their own directory** — standalone traces JS imports only, not arbitrary filesystem trees
- **Do NOT rely on `[deploy.env]` in `railway.toml`** — it is inconsistent; use Railway dashboard or CLI
- **Do NOT hardcode `/app/docs/...`** in application code — always read from env var with local fallback
- **Do NOT assume `process.cwd()` returns the app directory** — the start command determines cwd
- **Do NOT switch builders (nixpacks ↔ railpack)** without verifying the output directory structure

## Related

- `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` — recommends standalone mode; note the exception for filesystem-reading apps documented here
- `docs/solutions/platform/adding-new-apps.md` — scaffolding checklist for new monorepo apps
- `docs/solutions/platform/videoforge-manager-integration.md` — manager app uses standalone successfully (it doesn't read external files)
- `apps/manager/railway.toml` — uses nixpacks + standalone (works because manager is self-contained)
- `apps/roadmap/CLAUDE.md` — roadmap-specific deployment notes
