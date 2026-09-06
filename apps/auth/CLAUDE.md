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

## Local Changelog Reader access

Local Changelog normally uses hosted Jesus Film Auth, so a developer who sees
an insufficient-scope error at `http://localhost:3000/mcp` needs an approved
Local `changelog:read` grant in that hosted Auth database. The recipient must
already have signed in to Auth once and be a verified, ACTIVE HUMAN user.
Google sign-in is supported: the command uses the prompted email only to find
the user's stable Auth ID, and the grant is stored against that ID.

```bash
pnpm --filter @forge/auth changelog:grant-local-reader
```

The command prompts for the email. Never pass it as a command-line argument.
Running the command against a local Auth database affects only local Auth; use
the explicit, guarded hosted procedure in
`apps/auth/docs/railway-deployment.md` when Local Changelog is using hosted
Auth. The command can create Local Reader access only. It cannot grant
Production, Contributor, or Admin access, and Production Changelog token
issuance remains disabled.

After a grant, reconnect the Changelog MCP so the OAuth flow issues a fresh
token for `http://localhost:3000/mcp`. Changelog-side documentation remains a
separate follow-up in
[JesusFilm/jfp-changelog#81](https://github.com/JesusFilm/jfp-changelog/issues/81).

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

## Mobile hosted sign-in — the self-RP flow on Better Auth 1.7

`apps/mobile` signs in through the `jfp` generic-oauth provider: Auth is
the OAuth CLIENT of its own OAuth provider (a self-RP), so the hosted login
page ends in a real Better Auth session that the Expo plugin hands back to
the app. Five things hold that flow together, and the 1.6.2 → 1.7.1
upgrade (#1978) broke every one of them for the shipped app:

- **The mobile client version is pinned in LOCKSTEP with this app.** 1.7
  removed the generic-oauth plugin's own endpoints (`/sign-in/oauth2`,
  `/oauth2/callback/:id`); providers now ride the core `/sign-in/social`
  and `/callback/:id` endpoints. A mobile client left on 1.6.2 POSTs to a
  route that no longer exists (404) and renders its retry card. Bump
  `better-auth` and `@better-auth/expo` in `apps/mobile/package.json` in the
  SAME PR as here;
  `apps/mobile/src/lib/__tests__/betterAuthVersionLockstep.guard.test.js`
  fails on drift.
- **`handleSocialSignIn` in the route wrapper passes a `forgemobile://`
  callback through** (`resolveMobileCallbackURL`). The web callback policy
  only knows watch URLs; a dropped mobile callback falls back to the auth
  base URL, the Expo cookie handoff never fires, and the sheet closes on a
  web page. Better Auth still vets it against `trustedOrigins`. The same
  helper feeds `errorCallbackURL` when the web policy did not claim the
  callback, so a provider-side failure returns to the app as
  `forgemobile:///?error=<code>` instead of stranding the sheet on
  `/api/auth/error` (verified locally 2026-08-29: a bogus `code` on
  `/callback/jfp` → `302 forgemobile:///?error=invalid_code`). The Expo
  client reads only the `cookie` param, so the app still settles
  session-less — a quiet cancel — but the sheet closes.
- **`mobileAwareExpoPlugin` (config.ts) replaces the upstream expo plugin's
  `/expo-authorization-proxy`.** 1.7 made that proxy refuse any
  authorization URL on Auth's own origin (login-CSRF hardening) — which is
  exactly what a self-RP authorize URL is. The override admits ONE
  same-origin target: `/oauth2/authorize` for the self-RP client id, read
  from the same expression the provider uses. Everything else is upstream's
  rule verbatim; re-read `@better-auth/expo`'s `src/routes.ts` on every
  bump. Verify with curl: the proxy must 302 for the jfp authorize URL and
  400 for `/callback/google` on the same origin.
- **`accountLinking.requireLocalEmailVerified` is set to `false`.** 1.7
  added it with a `true` default: no provider account links to a user whose
  LOCAL `emailVerified` is false, trusted provider or not
  (`better-auth/dist/oauth2/link-account.mjs`). This platform sends no
  verification email, so the default turned every password user's first
  jfp sign-in — and every hosted sign-up, which runs inside that flow —
  into `/api/auth/error?error=account_not_linked`. Users who already held
  a `jfp` account row kept working, which is why the break was invisible
  to anyone who had signed in on mobile before 2026-08-24. R1 is unchanged:
  consumer providers still need a verified provider email. The flag alone
  would also let a consumer provider link onto an unverified password
  account by email match — the account pre-hijacking the 1.7 default closes
  — so `refuseUnverifiedConsumerLink` (`account-linking-guard.ts`), wired as
  `databaseHooks.account.create.before`, keeps that refusal for the consumer
  providers only. `jfp` and `credential` pass; a fresh consumer sign-up (no
  account rows yet) passes; a consumer link onto an unverified existing user
  throws `CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL`, which the callback turns
  into its error redirect; a missing user row fails closed.
- **`resolveSessionClientKind` reads `params.id` as well as
  `params.providerId`.** The 1.7 core callback route is `/callback/:id`, so
  the session hook sees that pattern and `params.id`; the pre-1.7
  generic-oauth route was `/oauth2/callback/:providerId`. Without the `id`
  read, post-upgrade mobile sessions carried no `clientKind`, the minted
  JWT carried no mobile claim, and admin's progress operations had nothing
  to accept (local DB: 2 `mobile` sessions before 2026-08-24, none after).

One packaging rule rides with those five. **`@better-auth/utils` is pinned
to `0.4.2` in BOTH manifests.** `@better-auth/core`, `oauth-provider`, and
`prisma-adapter` take it as an EXACT peer, while `better-call` depends on
`^0.5.0`. Once mobile carried `core` too, pnpm's cross-importer peer dedupe
resolved this app's peers against the `0.5.0` walk, split `core` into two
lockfile variants, and failed the typecheck (`GenericEndpointContext`
identity mismatch; `auth.api` lost every plugin endpoint). Declaring the
peer at the importer pins the walk, and the mobile lockstep guard holds the
two pins equal. Re-pin it whenever a bump moves core's peer range.

Deploy order: this app first, then the mobile build. Local dev caveat:
`next dev` deadlocks on the provider's init-time discovery fetch (the
`/.well-known/openid-configuration` handler awaits the same auth instance
that is fetching it); run `next build && next start -p 3004` for a local
end-to-end sign-in.

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
recurring operator task: when it expires, Sign in with Apple stops working
on the hosted login page. That now breaks mobile's App Store compliance
(guideline 4.8, see the section above), not just one sign-in button. Native
Apple token verification also stops, but only for installed pre-hosted app
versions, until they drain.

```bash
pnpm --filter @forge/auth mint:apple-client-secret \
  "<path to AuthKey_XXXXXXXXXX.p8>" <team-id> <key-id> <client-id>
```

- `client-id` must equal the value presented to Apple's token endpoint. For
  the surviving native token exchange — used only by installed pre-hosted
  app versions — that is the app bundle id, `org.jesusfilm.forgewatch`, not
  the web Service ID.
- The JWT prints on **stdout**; everything else (including the expiry date to
  diary) goes to stderr, so a pipe stays clean.
- Store it as `APPLE_NATIVE_CLIENT_SECRET` on the `forge-auth` Doppler
  project. `APPLE_APP_BUNDLE_ID` must hold the same bundle id.
- The `.p8` is a long-lived credential. Keep it out of the repo; the minted
  JWT is a credential too.

The current secret expires **2027-02-04**.
