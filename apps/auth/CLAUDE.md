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
- Public signup is allowed for new viewer accounts. Keep duplicate-account
  protection in front of Better Auth signup so existing Auth users and legacy
  Firebase users are asked to sign in instead of creating a second account.
- OAuth redirect URLs must be exact-match per app environment.
- The first-party seed (`src/scripts/seed-first-party-apps.ts`) is
  **upsert-only and never prunes.** Editing a client's redirect URIs is scrubbed
  into the DB on the next deploy (the upsert `update` branch replaces
  `redirectUris` wholesale), but **removing or renaming a client's `clientId` in
  the seed leaves the old OAuth client row live** — the seeder never deletes it.
  Retiring a client (DNS cutover to a new id, or decommission) means
  disabling/deleting its row out-of-band, not just dropping it from the seed.
  This matters most when a redirect host is reclaimable (e.g. a raw
  `*.up.railway.app` domain) — see
  `docs/solutions/auth/public-repo-oauth-seed-railway-domain-exposure-calculus.md`.
- Operator dashboard access is disabled in production until the developer
  console becomes an OAuth relying client.
- Token issuance must be scoped, audience-bound, environment-bound, expiring,
  revocable, and audited.
- Stdout logs must not include raw credentials, bearer tokens, refresh tokens,
  client secrets, or unnecessary PII.

## Sign in with Apple — App Store constraint (guideline 4.8)

The hosted login page is the ONLY sign-in surface for `apps/mobile`
(feat-349). App Store guideline 4.8 requires Sign in with Apple to stay
enabled on the hosted page while the mobile app is live in the App Store.
Do not disable or let the Apple provider lapse: an expired Apple client
secret now takes down mobile's App Store compliance, not only Apple
sign-in itself.

## Sign in with Apple — client-secret rotation

Apple's "client secret" is an ES256 JWT signed with a Sign in with Apple
`.p8` key, and Apple caps its lifetime at **6 months**. It is therefore a
recurring operator task: when it expires, native Apple sign-in on
`apps/mobile` stops working.

```bash
pnpm --filter @forge/auth mint:apple-client-secret \
  "<path to AuthKey_XXXXXXXXXX.p8>" <team-id> <key-id> <client-id>
```

- `client-id` must equal the value presented to Apple's token endpoint. For
  the native sheet that is the app bundle id, `org.jesusfilm.forgewatch` —
  not the web Service ID.
- The JWT prints on **stdout**; everything else (including the expiry date to
  diary) goes to stderr, so a pipe stays clean.
- Store it as `APPLE_NATIVE_CLIENT_SECRET` on the `forge-auth` Doppler
  project. `APPLE_APP_BUNDLE_ID` must hold the same bundle id.
- The `.p8` is a long-lived credential. Keep it out of the repo; the minted
  JWT is a credential too.

The current secret expires **2027-02-04**.
