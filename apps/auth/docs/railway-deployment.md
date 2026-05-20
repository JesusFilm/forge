# Railway Deployment

`apps/auth` deploys as a standalone Railway service for `auth.jesusfilm.org`.

## Service Shape

- Service name: `@forge/auth`
- Railway project: `forge`
- Railway service ID: `28b7c7be-3a22-4a95-885a-bc302e3d16a2`
- Railway environment: `production`
- App path: `apps/auth`
- Healthcheck path: `/api/health`
- Local port: `3004`
- Temporary Railway domain:
  `https://forgeauth-production.up.railway.app`
- Production domain: `https://auth.jesusfilm.org`
- Doppler project: `forge-auth`

## Build And Start

If Railway config-as-code is enabled for the service, set Config-as-code Path
to `apps/auth/railway.toml`.

If the Railway dashboard is canonical, configure:

- Build command:
  `pnpm install --frozen-lockfile && pnpm --filter @forge/auth build && cp -r apps/auth/.next/static apps/auth/.next/standalone/apps/auth/.next/static`
- Start command:
  `HOSTNAME=0.0.0.0 node apps/auth/.next/standalone/apps/auth/server.js`
- Healthcheck path:
  `/api/health`
- Healthcheck timeout:
  `60s`

## Initial Env

- `AUTH_BASE_URL=https://auth.jesusfilm.org`
- `BETTER_AUTH_SECRET=<runtime secret>`
- `DATABASE_URL=<auth Postgres database>`
- `REDIS_HOST=<optional rate limit Redis host>`
- `REDIS_PORT=<optional rate limit Redis port>`
- `REDIS_PASSWORD=<optional rate limit Redis password>`
- `FIREBASE_WEB_API_KEY=<optional migration fallback>`
- `FIREBASE_PROJECT_ID=<optional migration fallback>`
- `FIREBASE_CLIENT_EMAIL=<optional migration fallback>`
- `FIREBASE_PRIVATE_KEY=<optional migration fallback>`

Configure upstream identity providers only when enabled:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`
- `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET`
- `OKTA_CLIENT_ID` / `OKTA_CLIENT_SECRET` / `OKTA_ISSUER`

After the database is available, run:

```bash
pnpm --filter @forge/auth db:migrate:deploy
pnpm --filter @forge/auth seed:first-party-apps
```

## Cutover Rule

`auth.jesusfilm.org` was moved from admin to Auth on 2026-05-12. Admin now uses
Auth as its only runtime sign-in path.

Before deploying changes to this flow:

- `apps/auth` healthcheck passes in Railway.
- Admin has an OAuth client registration in Auth.
- Admin can complete the OAuth callback flow against `auth.jesusfilm.org`.
- Rollback is a normal application rollback, not an admin-side auth-mode toggle.

## 2026-05-12 Provisioning Status

- Created Railway service `@forge/auth`.
- Created dedicated Railway Postgres service currently named `Postgres`.
- Generated Railway service domain
  `https://forgeauth-production.up.railway.app`.
- Set Auth runtime vars for `AUTH_BASE_URL`, `BETTER_AUTH_SECRET`, and
  `DATABASE_URL`.
- Deployed current workspace to production service; latest verified deployment
  uses `AUTH_BASE_URL=https://auth.jesusfilm.org`.
- Moved the `auth.jesusfilm.org` custom domain from `@forge/admin` to
  `@forge/auth`.
- Verified `/api/health` returns `{ "ok": true, "service": "forge-auth" }` on
  the real Auth domain.
- Startup applied Prisma migration `0001_init` and seeded one first-party admin
  app, four environments, four OAuth clients, and eight scopes.
- 2026-05-20 redeploy trigger: refresh `@forge/auth` so the Manager OAuth
  client seed changes from PR #989 run on Railway startup.
- Copied available upstream SSO provider env values from admin to Auth:
  Facebook, Google, and Okta. Apple was not configured on admin.
- Added admin production env values for `AUTH_ISSUER_URL`,
  `AUTH_ADMIN_CLIENT_ID`, and `ADMIN_BASE_URL`.
