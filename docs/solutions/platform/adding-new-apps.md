# Adding a New App to the Forge Monorepo

## Pattern

The monorepo uses `apps/*` and `packages/*` globs in `pnpm-workspace.yaml`, so **no root-level config changes are needed** when adding a new app. Turborepo task definitions in `turbo.json` are universal.

## Checklist

1. Create `apps/<name>/` with:
   - `package.json` — name `@forge/<name>`, include standard scripts
   - `tsconfig.json` — copy from `apps/web`, adjust paths if needed
   - `CLAUDE.md` — stack, conventions, env var table
   - `AGENTS.md` — key files, cross-package impact notes

2. Add framework config (e.g. `next.config.ts` for Next.js apps)

3. Add `src/config/env.ts` using `@t3-oss/env-nextjs` + zod — validate all env vars at startup

4. Add `railway.toml` with `startCommand = "pnpm --filter @forge/<name> start"`

   > ⚠ **Important caveat (added 2026-04-29):** Railway only auto-discovers `railway.toml` at the **repo root**. A per-service `apps/<name>/railway.toml` is silently ignored unless the service's **Config-as-code Path** is explicitly set in the Railway dashboard to point at it. If you skip this step, the toml becomes dead config — your `startCommand` here will look authoritative but never run. Either: (a) set `Config-as-code Path = apps/<name>/railway.toml` on the service after creating it, OR (b) set `Custom Start Command` (and any other deploy-config dimensions) directly in the Railway dashboard and document the dashboard as canonical. See [`docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md) for the trap that surfaced this requirement (5 PRs of Prisma migrations silently skipped on `@forge/admin` over ~1 week before detection).

5. Run `pnpm install` from repo root to wire up workspace symlinks

6. Configure Railway service with matching name and env vars

## Key decisions

- **Port assignment**: web=3000 (default), mobile=N/A, cms=1337 (Strapi default), manager=3002, admin=3003, auth=3004, mastra-gateway=3005, roadmap=3100, chat=3200
- **Data access**: consumer apps read from `apps/admin` via the typed `adminGraphql()` client from `@forge/admin-graphql` — never REST. (The old Strapi CMS app and its Strapi-bound `packages/graphql` / `@forge/graphql` client were removed; do not reach for them.)
- **Env validation**: when an app has env vars, validate them with t3-oss/env-nextjs — never read `process.env` directly. An env-less app ships no `env.ts`.
- **No root turbo.json changes**: tasks (dev, build, lint, typecheck, test) are inherited universally

## Example: apps/manager

See `apps/manager/` for a complete example of a Next.js app with external service integrations (Mux, OpenRouter, Railway S3, useworkflow.dev) added to this monorepo. See also `docs/solutions/platform/videoforge-manager-integration.md` for the full writeup.
