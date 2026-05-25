# apps/developer - Apps Developer Portal

## What this app does

`apps/developer` is the Forge developer portal for first-party and future
third-party app registrations. It is intended to deploy at
`developer.jesusfilm.org`.

The first slice is intentionally read-only: it shows Auth-owned app
registration data so operators can inspect apps, environments, OAuth client
ids, redirect URIs, scopes, and approval posture without using Strapi or
expanding Auth's internal dashboard.

## Architecture rules

- Auth owns identity, OAuth/OIDC provider behavior, app grants, token issuance,
  revocation, audit, and credential lifecycle.
- Developer is a relying UI, not a second identity authority.
- Auth OAuth with the `developer:access` scope protects registry views.
- Direct Auth database reads are a first-slice read-only projection. Before
  adding writes, introduce an Auth-owned management API or shared Auth registry
  data package so validation, audit, and policy stay centralized.
- Never render raw client secrets, bearer tokens, refresh tokens, database
  URLs, or unnecessary PII.
- Do not change `apps/cms` authentication or make Strapi an Auth relying
  client.

## Development

```bash
pnpm fetch-secrets
pnpm --filter @forge/developer dev
pnpm --filter @forge/developer test
pnpm --filter @forge/developer typecheck
pnpm --filter @forge/developer lint
```

## Environment

| Variable                       | Purpose                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| `AUTH_DATABASE_URL`            | Auth-owned Postgres database URL for read-only registry projection.    |
| `DEVELOPER_BASE_URL`           | Public origin for this app.                                            |
| `AUTH_ISSUER_URL`              | Auth OAuth issuer URL, e.g. `http://localhost:3004/api/auth` locally.  |
| `AUTH_DEVELOPER_CLIENT_ID`     | Developer portal OAuth client id registered in Auth.                   |
| `AUTH_DEVELOPER_CLIENT_SECRET` | Optional OAuth client secret if the Auth registration is confidential. |
| `DEVELOPER_SESSION_SECRET`     | 32+ character secret for Developer-local session cookies.              |

## Deployment

Developer deploys as its own Railway service. If `apps/developer/railway.toml`
is used, set the Railway service's Config-as-code Path to
`apps/developer/railway.toml`; otherwise configure the build, start command,
healthcheck, and env vars directly in Railway and document the dashboard as
canonical.
