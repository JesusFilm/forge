# apps/auth — Jesus Film Auth

## What this app does

Standalone authentication and authorization authority for Jesus Film apps. Auth
replaces the auth behavior currently embedded in `apps/admin` and becomes the
OAuth/OIDC-style provider for first-party applications.

Origin documents:

- Requirements: `docs/brainstorms/2026-05-11-jesus-film-auth-platform-requirements.md`
- Plan: `docs/plans/2026-05-11-001-jesus-film-auth-platform-plan.md`
- Roadmap: `docs/roadmap/platform/feat-121-jesus-film-auth-platform.md`

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- Better Auth as the auth framework
- OAuth/OIDC provider behavior for first-party clients
- Railway deployment with standalone output
- Doppler project: `forge-auth`

## Architecture rules

- Auth owns global membership and app-level scopes/grants.
- Apps own domain authorization after Auth establishes the user or service
  principal.
- Admin is a relying client. It must establish admin-local authenticated state
  through an OAuth/OIDC-style flow, not through shared parent-domain cookies.
- Environment-specific app registrations are first-class: local, preview,
  staging, and production use the same conceptual flow with different redirect
  URLs and approval posture.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-auth)
pnpm --filter @forge/auth dev           # http://localhost:3004
pnpm --filter @forge/auth build
pnpm --filter @forge/auth test
pnpm --filter @forge/auth lint
pnpm --filter @forge/auth typecheck
```

## Agent login handles

Trusted developer environments can mint short-lived email-like login handles
for local/preview browser testing. Set `AGENT_LOGIN_MINTING_KEY` in Auth for
the API endpoint, then mint a handle:

```bash
pnpm --filter @forge/auth mint:agent-handle
```

Paste the printed handle into the normal Auth email field and click Continue.
The raw `AGENT_LOGIN_MINTING_KEY` and printed handles are bearer credentials; do
not commit them, pipe them into durable logs, or paste them into issue/PR text.

## Deployment

Auth deploys as its own Railway service. `auth.jesusfilm.org` should point to
this service after cutover, not to `apps/admin`.

If `apps/auth/railway.toml` is used, set the Railway service's
Config-as-code Path to `apps/auth/railway.toml`. Otherwise configure the build,
start command, healthcheck, and env vars directly in the Railway dashboard and
document the dashboard as canonical.

## Security posture

- No shared `.jesusfilm.org` cookie dependency for admin.
- No public signup while migration fallback exists.
- OAuth redirect URLs must be exact-match per app environment.
- Operator dashboard access is disabled in production until the developer
  console becomes an OAuth relying client.
- Token issuance must be scoped, audience-bound, environment-bound, expiring,
  revocable, and audited.
- Stdout logs must not include raw credentials, bearer tokens, refresh tokens,
  client secrets, or unnecessary PII.
