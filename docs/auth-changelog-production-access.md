# Changelog production access

Use the Auth-owned operator command from a reviewed, merged Forge checkout.
The operator needs trusted Auth database access, just as for
`changelog:grant-local-reader`. This command is not exposed over HTTP and does
not authenticate operators independently of that database access.

## Inspect first

Confirm the recipient's intended Jesus Film Auth email directly with them.
Select the production Auth database using the existing secret-management
workflow. Keep the connection string out of terminal history, logs and tickets.
Do not use Changelog's application database.

```sh
pnpm --filter @forge/auth changelog:production-access inspect
```

The command prompts for the recipient email on stdin so package-manager logs
and shell history do not capture it as an argument. Output contains the Auth user ID, membership, email-verification state, actor
type, exact production environment, application status and the scopes stored on
approved, non-revoked grants. It omits the email and credentials. A stored
`changelog:admin` implies read and submit through existing OAuth policy;
`inspect` reports grants, not proof of token issuance or successful sign-in.
Unknown or ambiguous identities fail without creating an account.

## Provision

```sh
pnpm --filter @forge/auth changelog:production-access grant-admin
pnpm --filter @forge/auth changelog:production-access inspect
```

The recipient must already be a verified, ACTIVE HUMAN. The registered Changelog
application must be ACTIVE and its production environment APPROVED. Repeating
the command preserves an existing admin grant. It does not change membership,
local grants, the Local Reader command, or the production enablement flag.

Before first activation, verify both provisioning and revocation with an
isolated database and the tests below. Only then provision the pilot admin and
set `AUTH_CHANGELOG_PRODUCTION_ENABLED=true` on the production Auth service
through the normal configuration workflow. Wait for the resulting deployment
to report SUCCESS. The flag alone creates no grants.

Code releases go through the normal PR-to-main Railway autodeploy path. Do not
publish local worktree code directly to production.

Sign in again at `https://changelog.jesusfilm.org`. Verify shipment history and
product administration. Record deployment revision, date, and observed role or
scopes, never tokens or cookies. A previous authorization cannot widen its scope
ceiling after an upgrade; reconnect for the newly granted role.

## Revoke

```sh
pnpm --filter @forge/auth changelog:production-access revoke
pnpm --filter @forge/auth changelog:production-access inspect
```

This revokes all of that user's production Changelog USER grants, including
pending grants, to remove the entire grant union. It preserves grant history and
does not touch local or other-application access. It remains available after a
user is suspended or the application/environment is disabled. Repeat execution
is a no-op. Never revoke the sole pilot admin merely to test this command.

Mutations and audit events commit together, with the environment row lock
serializing this command's grant/revoke operations. Audit records hash the
subject and identify the command source. Code exchange and refresh revalidate
current grants. Already-issued JWTs remain usable until their existing expiry;
revocation is not an immediate access-token invalidation mechanism.

## Isolated verification

Supply `AUTH_TEST_DATABASE_URL` for disposable PostgreSQL with Auth migrations
applied. Never point tests at production. Set one consistent
`BETTER_AUTH_SECRET` for every integration suite sharing that database: their
individual defaults differ, and existing encrypted JWKS require the same secret
that created them.

```sh
pnpm --filter @forge/auth test -- --no-file-parallelism
pnpm --filter @forge/auth typecheck
pnpm --filter @forge/auth lint
```

On 2026-09-05, all 556 Auth tests passed across 48 files with disposable
PostgreSQL 18 and one explicit test secret. Nine new tests exercised the real
operator CLI, concurrent idempotent grants, absent-grant downscoping, full
production revocation, stale-refresh denial, local isolation, inactive or
unverified recipients, and audited changes without recipient email. Existing
native OAuth integration tests also passed for code exchange, refresh,
production-off behavior and exact resource binding. Typecheck and lint passed.

This isolated proof does not establish the pilot user's production acceptance.
Track that outcome in JesusFilm/jfp-changelog#101. Backups, legacy imports and
onboarding another engineer remain outside this access change.
