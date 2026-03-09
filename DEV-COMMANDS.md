# Dev commands

From repo root (`qyi`). Install first: `pnpm install`.

## Backend (CMS / Strapi)

| Command                                  | Description                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm turbo run dev --filter @forge/cms` | Start Strapi (GraphQL at http://localhost:1337)                                |
| `pnpm --filter @forge/cms run dev`       | Same, without Turbo                                                            |
| `pnpm --filter @forge/cms run build`     | Build CMS for production                                                       |
| `pnpm --filter @forge/cms run seed`      | Seed Easter experience + Video Hero (video “Easter Hero”, experience “easter”) |

**Requires:** `apps/cms/.env` with `ADMIN_JWT_SECRET`, `APP_KEYS`, etc. Copy from `apps/cms/.env.example` or use existing `.env`.

## Frontend (Next.js web)

| Command                                  | Description                           |
| ---------------------------------------- | ------------------------------------- |
| `pnpm turbo run dev --filter @forge/web` | Start Next.js (http://localhost:3000) |
| `pnpm --filter @forge/web run dev`       | Same, without Turbo                   |
| `pnpm --filter @forge/web run build`     | Production build                      |

**Requires:** `apps/web/.env.local` with `NEXT_PUBLIC_GRAPHQL_URL` and `STRAPI_API_TOKEN`.

## Both

| Command    | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `pnpm dev` | Start all apps that have a `dev` script (web + CMS in parallel) |

## Other

| Command        | Description                                 |
| -------------- | ------------------------------------------- |
| `pnpm codegen` | Regenerate GraphQL types (`@forge/graphql`) |
| `pnpm seed`    | Seed Easter experience + Video Hero (CMS)   |
| `pnpm lint`    | Lint all packages                           |
