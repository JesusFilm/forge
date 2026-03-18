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

5. Run `pnpm install` from repo root to wire up workspace symlinks

6. Configure Railway service with matching name and env vars

## Key decisions

- **Port assignment**: web=3000 (default), mobile=N/A, cms=1337 (Strapi default), manager=3002
- **CMS access**: always use `@forge/graphql` typed operations via Apollo Client (`src/cms/client.ts`) — never REST
- **Env validation**: always use t3-oss/env-nextjs; never read `process.env` directly
- **No root turbo.json changes**: tasks (dev, build, lint, typecheck, test) are inherited universally

## Example: apps/manager

See `apps/manager/` for a complete example of a Next.js app with external service integrations (Mux, OpenRouter, Railway S3, useworkflow.dev) added to this monorepo. See also `docs/solutions/platform/videoforge-manager-integration.md` for the full writeup.
