# apps/developer - Apps Developer Portal

## What this app does

`apps/developer` is the Forge developer portal for third-party app
registrations, first-party app registrations, and internal app access
administration. It is intended to deploy at
`developer.jesusfilm.org`.

The registry slice shows Auth-owned app registration data so operators can
inspect apps, environments, OAuth client ids, redirect URIs, scopes, and
approval posture without using Strapi or expanding Auth's internal dashboard.
The first access-management slice allows Developer admins to approve and revoke
Auth-owned first-party app grants with audit events.

## Architecture rules

- Auth owns identity, OAuth/OIDC provider behavior, app grants, token issuance,
  revocation, audit, and credential lifecycle.
- Developer is a relying UI, not a second identity authority.
- Auth OAuth with the `developer:access` scope protects registry views.
- An approved Auth-owned Developer app grant with `developer:admin` protects
  access-management writes.
- Developer is the intended unified admin UI for first-party access grants
  across Admin, Manager, Mastra Studio, and Developer, but Auth owns the grant
  model, enforcement, and audit trail.
- Direct Auth database reads are a first-slice projection. Direct mutations are
  limited to app grants and audit events until an Auth-owned management API or
  shared Auth registry data package replaces this operational bridge.
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
