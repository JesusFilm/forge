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

## Better Auth 1.7 Persistence Rollout

The Better Auth 1.7 upgrade uses an expand-and-contract migration. Production
must receive it through the normal PR-to-main deployment path during an
approved Auth-write maintenance window. Do not run `railway up`, trigger a
manual redeploy, or apply the migration directly from a local checkout.

Before merge, rehearse both database shapes against scratch PostgreSQL:

- a fresh database with every migration followed by `seed:first-party-apps`;
- a representative 1.6.2-shaped database containing accounts for every live
  provider, public and confidential OAuth clients, access and refresh tokens,
  consents, and device codes.

No production snapshot is checked into this repository. The representative
fixture is a contract rehearsal, not evidence about production row contents;
record redacted production preflight counts during the maintenance window.

The production dashboard's existing start chain is authoritative:

```text
db:migrate:deploy && seed:first-party-apps && node server.js
```

Migration `0004_better_auth_17_persistence` adds the 1.7 tables and columns
without deleting the 1.6.2 `oauth_client.public`, `oauth_client.type`, redirect
arrays, or `(provider_id, account_id)` unique key. The seed's first operation
then finalizes `Account.issuer` before the server starts:

1. Build an explicit trusted map for `credential`, the legacy `firebase`
   migration marker, `google`, `facebook`, `apple`, the configured
   `OKTA_ISSUER`, and the JFP self-provider issuer at
   `${AUTH_BASE_URL}/api/auth`.
2. Stop on an unknown provider, a missing dynamic issuer, an existing issuer
   mismatch, or an `(issuer, account_id)` collision before changing account
   rows or enforcing the new constraint.
3. Install the trusted map, backfill issuers, add the unique key, and make the
   column non-null.
4. Seed native OAuth resources and client-resource links idempotently.

### Public MCP client-resource repair

The same startup seed repairs compatible dynamic loopback clients after all
resource rows and first-party links have been seeded. Before inspecting any
client, the seed verifies that every public DCR default has one enabled
`OauthResource` row whose allowed scopes exactly match the Auth resource
catalogue. Auth must not start when this invariant or a client repair
transaction fails.

The repair is additive and registration-posture based. It adds every missing
public MCP link, in one transaction per client, only for an unseeded, enabled,
public native client that uses token authentication `none`, Authorization Code
plus Refresh Token, PKCE that is not disabled, and exact ephemeral HTTP
loopback callbacks at `/auth/callback` or `/callback`. It does not change
seeded, confidential, remote, disabled, PKCE-disabled, web, or incomplete-grant
clients. It does not create AppGrants or consents and does not rewrite
authorization codes, access tokens, or refresh tokens. The older
`offline_access` append remains a separate, narrower migration for clients
carrying the established legacy Admin MCP scope markers.

Startup reports counts only: eligible clients, repaired clients, links added,
and legacy clients updated for offline access. Do not add client IDs, redirect
URIs, user identifiers, authorization codes, tokens, or secrets to this output.
Before deployment, record equally redacted counts for public resource rows,
links grouped by public resource, eligible loopback clients, and eligible
clients missing at least one public link. Stop for duplicate resource
identifiers, duplicate `(client_id, resource_id)` pairs, or unexpected seeded
client gaps. After deployment, require zero eligible clients missing a public
link and confirm a second seed adds zero repair links.

Use a clean isolated MCP client profile for the rollout gate: perform discovery
and registration without cached metadata, authorize the canonical production
Admin MCP resource, exchange the code, verify the signed production Admin
claims, initialize MCP, and list tools and Experiences. Then reconnect one
accessible eligible pre-deploy client to exercise the repaired-client path. If
none is accessible, record that smoke as not applicable and retain the
post-seed invariant plus real-database backfill evidence. Remove the isolated
profile and its credentials after the smoke.

Application rollback is non-destructive. The added resource links are
capability ceilings, not user grants, so do not delete them during rollback.
Roll back through the normal PR-to-main deployment path only after the
old-code/new-data compatibility check shows the previous Auth policy can read
the additive links without widening authority or failing startup.

If finalization fails, do not bypass it or start Better Auth 1.7. The additive
schema can remain in place while the previous deployment continues; correct
the trusted configuration or identity collision through a reviewed PR and
repeat the normal deployment path.

After startup, verify `/api/health`, discovery, a representative password and
upstream-provider login, authorization-code exchange and refresh,
introspection, Manager client credentials, and the TV device flow. Confirm
resource and link counts contain no duplicate `(client_id, resource_id)` rows.

### Rollback during the soak window

Rollback the application only; do not reverse the migration. Before returning
to 1.6.2, revoke or disable resource-bound 1.7 refresh families because 1.6.2
cannot enforce their resource state. Retain
`auth_account_issuer_mapping` and the `account_trusted_issuer` trigger: the
trigger fills issuer for 1.6.2 Account inserts from the trusted map and rejects
unknown providers, so password and mapped OAuth account creation remain
compatible with the non-null 1.7 schema. Keep `AUTH_BASE_URL` and
`OKTA_ISSUER` unchanged across rollback. Rerun the normal seed finalizer before
restoring 1.7.

## Cutover Rule

`auth.jesusfilm.org` was moved from admin to Auth on 2026-05-12. Admin now uses
Auth as its only runtime sign-in path.

Before deploying changes to this flow:

- `apps/auth` healthcheck passes in Railway.
- Admin has an OAuth client registration in Auth.
- Admin can complete the OAuth callback flow against `auth.jesusfilm.org`.
- Rollback is a normal application rollback, not an admin-side auth-mode toggle.

## Changelog OAuth launch boundary

Forge Auth owns Changelog's AppGrant checks and Better Auth owns the OAuth
authorization code, resource persistence, access token, and refresh token. The
only supported Changelog MCP resources are:

- local: `http://localhost:3000/mcp`
- production: `https://changelog.jesusfilm.org/mcp`

Dynamic MCP registrations receive admission links to both resources, but each
authorization must select exactly one resource and registration does not grant
any `changelog:*` scope. Auth downscopes before Better Auth creates its native
authorization code and revalidates the current grant from provider-owned user,
scope, and resource context before code-exchange or refresh token persistence.

Keep `AUTH_CHANGELOG_PRODUCTION_ENABLED=false` (or unset) in every production
environment until a supported grant-provisioning and revocation workflow is
operational. Direct database edits are not a launch procedure. Enabling the
flag does not create grants; it only permits matching approved, non-revoked
production AppGrants to be considered. Preview remains intentionally deferred
until Changelog has a stable preview deployment and callback domain.

This boundary depends on the completed Better Auth 1.7 native-resource rollout
(`feat-401`). Do not replace it with authorization-code record rewrites, a
side-channel resource binding, or another issuer.

### Grant Local Reader access

Local Changelog normally authorizes through hosted Jesus Film Auth. Before
granting access, the recipient must have signed in to Auth at least once and
must be a verified, ACTIVE HUMAN user. Google sign-in is supported: the
operator enters the account email only so Auth can resolve the stable user ID;
the grant itself is stored against that ID. A linked Google account does not
prove ACTIVE membership. If the command rejects an otherwise verified user,
resolve an unexpected INVITED membership through the approved membership
process; this command intentionally does not activate users.

The command prompts for the email and must not receive it through command-line
arguments:

```bash
pnpm --filter @forge/auth changelog:grant-local-reader
```

Running this command normally uses the Auth database configured in the current
shell. Against a local Auth database, it changes local Auth only and will not
help a Local Changelog instance that is using hosted Auth.

For hosted Auth, use the following procedure only after this command has been
merged, deployed, and checked out from a clean `main` branch:

1. Inspect the target without reading environment variables:

   ```bash
   railway status \
     --project 98952497-a4d9-4714-8fe8-0cdbff3147c9 \
     --environment production \
     --json
   ```

2. Verify that the output identifies project `forge`, environment
   `production`, and lists the `@forge/auth` service with ID
   `28b7c7be-3a22-4a95-885a-bc302e3d16a2`.
3. Pause and obtain human confirmation of that exact target.
4. Run the prompt-driven command with the service's injected configuration:

   ```bash
   railway run \
     --project 98952497-a4d9-4714-8fe8-0cdbff3147c9 \
     --environment production \
     --service 28b7c7be-3a22-4a95-885a-bc302e3d16a2 \
     --no-local \
     -- pnpm --filter @forge/auth changelog:grant-local-reader
   ```

Do not run `railway variables`, `railway run env`, or
`railway run printenv`. Do not print, copy, or paste `DATABASE_URL`, and do not
use `railway up` for this workflow.

The command can create an approved Reader grant for the Changelog Local
environment only. It cannot grant Production, Contributor, or Admin access,
and `AUTH_CHANGELOG_PRODUCTION_ENABLED` must remain disabled. After the grant,
reconnect the Changelog MCP so the OAuth flow issues a fresh token for
`http://localhost:3000/mcp`.

Verify the new token by calling the MCP `list_entries` tool. A successful
response with an empty entries array is valid when the developer's local
Changelog PostgreSQL database has no entries; an authorization or
insufficient-scope error is the failure signal.

Changelog repository wording and policy documentation are tracked separately
in [JesusFilm/jfp-changelog#81](https://github.com/JesusFilm/jfp-changelog/issues/81).

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
- Startup applied Prisma migration `0001_init` and seeds first-party Admin and
  Manager app environments. Manager session-validation service clients remain
  disabled until their `AUTH_MANAGER_SESSION_SERVICE_CLIENT_SECRET_*` value is
  configured and the seed is rerun.
- 2026-05-20 redeploy trigger: refresh `@forge/auth` so the Manager OAuth
  client seed changes from PR #989 run on Railway startup.
- Copied available upstream SSO provider env values from admin to Auth:
  Facebook, Google, and Okta. Apple was not configured on admin.
- Added admin production env values for `AUTH_ISSUER_URL`,
  `AUTH_ADMIN_CLIENT_ID`, and `ADMIN_BASE_URL`.
