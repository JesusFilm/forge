# RAG portal admission

`users.json` is the merged repository allowlist for **portal access only**. Each
entry has exactly `login` (GitHub handle) and `id` (stable positive GitHub numeric
account ID). Example:

```json
{
  "users": [{ "login": "engineer", "id": 123456 }]
}
```

Logins are normalized to lowercase; case-insensitive duplicate logins and
repeated IDs are invalid. A rename requires a reviewed edit retaining the same
numeric ID. A reassigned handle never inherits access because the ID must also
match. The first approved entry was merged in
[#2423](https://github.com/JesusFilm/forge/pull/2423) after eligibility CI passed.

The path-specific `rag-portal-allowlist` CI workflow emits a receipt with the
candidate commit SHA, normalized entries, predicate names and each check's
`pass`, `fail` or `unverified` outcome. It requires
`RAG_PORTAL_ELIGIBILITY_TOKEN` with repository administration-read visibility
for the private Forge collaborator-permission endpoint. An absent token,
private-visibility 404, incomplete response, rate limit or network error is
`unverified` and fails the job. A live `read`, `triage` or `none` permission,
missing account or identity mismatch is known ineligible and fails. A public
contribution or organization-membership check does not establish repository
write access. The receipt contains no token. A zero-entry list passes only
vacuously; it admits nobody.

Runtime admission reads `apps/rag/portal/users.json` at the current **merged**
`main` SHA through the GitHub API on every portal login and protected action.
It verifies the signed-in account's live handle and numeric ID and current
Forge `write`, `maintain` or `admin` permission. There is no cached permission
or stale publication grace period: unavailable/incomplete GitHub reads deny the
action. A PR head cannot grant admission before merge. The `/v1` bearer route
is independent of the portal session and keeps its existing credential path.
The portal exposes login, protected identity proof, and sign-out. When the
separate consumer writer and auth reader URLs are configured, it also mounts
authenticated `/portal/consumers` management routes. These are the backend
for local management UI development under feat-530; they do not
expose usage reports themselves. With the report reader configured, the separate
`/portal/usage` route lets every admitted portal user read every consumer report
using their existing session, independently of ownership. Reads recheck current
admission; database credentials stay server-side. See the [consumer access migration runbook](../docs/ops/consumer-access-migration.md)
for the route contract, least-privilege roles, one-time secret handling and
rollout boundary.

## Operator setup and verification

The six `RAG_PORTAL_*` service variables were configured on the Forge RAG
Railway production service after [#2416](https://github.com/JesusFilm/forge/pull/2416)
merged. The OAuth app uses that service's HTTPS origin and exact
`<origin>/portal/callback`. The server-only GitHub token, OAuth client secret
and restricted portal-session database URL were sourced from Doppler; the
separate CI review token is a GitHub Actions secret. Keep these values out of
the browser, logs and repository. The session role has only `USAGE` on
`portal_private` and `SELECT`, `INSERT`, `DELETE` on `oauth_states` and
`sessions`, plus column-limited `UPDATE (expires_at)` on `sessions` for idle
renewal; its corpus and `consumer_private` reads were denied in the
operator permission check.

The Railway pre-deploy command applies the additive migration, then runs
`db:grant-portal-session-renewal` before the new service starts. The script
connects with the configured restricted `RAG_PORTAL_DATABASE_URL`, obtains its
role from PostgreSQL `current_user`, checks its existing portal-only privileges,
and verifies both connections reach the same PostgreSQL cluster and database.
It uses the migration administrator connection to grant only
`UPDATE (expires_at)` on `portal_private.sessions`. It then reconnects as the
restricted role to verify the expiry update is available while table-wide,
other session-column, OAuth-state update and non-portal data privileges remain unavailable.
An unexpected role, database, or privilege stops the deployment. The grant is
idempotent and the script prints a redacted receipt containing the database and
role names plus the checked permission booleans; it never prints either URL.
Portal startup independently verifies the restricted role, so a Railway
dashboard override that skips pre-deploy cannot silently enable broken renewal.
The deployment log and reviewed script commit are the audit record. After the
first production deployment, record the deployment ID and receipt result in
`docs/roadmap/rag/evidence/feat-575/` without credentials or session values.

The migration retains existing sessions' original expiry and gives new OAuth
sign-ins the eight-hour idle and 24-hour absolute limits. Environments without
portal configuration skip the grant.

The allowlisted login, protected identity response, sign-out, next-request
unauthorized response and unlisted-account denial were observed in a real
browser on 25 September 2026. The
[feat-527 admission evidence](../../../docs/roadmap/rag/evidence/feat-527/portal-admission-slice.md)
records completed checks and remaining operational checks without secret values.
Still check session persistence across restart, merged allowlist removal and
next-action denial, forced GitHub outage/stale-publication behavior, live
state-replay and cookie properties, and redacted browser/network/log leakage.
Use a reviewed PR for allowlist changes.

The portal feature is disabled when all six `RAG_PORTAL_*` service variables
are absent. Partial configuration fails service startup. Production now has
all six variables, so the admission portal is enabled. Consumer management is enabled separately through the restricted consumer
writer/auth reader URLs; see the feat-530 activation record for its live status.

## Consumer UI (feat-530)

`/portal` now serves the management UI. `/portal/identity` provides the protected
JSON identity proof previously returned at `/portal`. The shell and static assets
contain no session data; identity, directory reads and mutations recheck current
admission. Management appears only when the consumer backend is configured.
`GET /portal/members` provides the merged allowlist for member selection; adding
members still checks live eligibility and ownership in the backend transaction.

The UI creates directly from the form, then shows the issued key once with copy/save
controls, and clears the display on dismissal, sign-out and page navigation.
It stores only the selected section, validated Usage UTC date range and bounded
recovery markers in per-tab `sessionStorage`. It stores no credentials, issued
keys, OAuth values, corpus text or management payloads, and uses no telemetry.
Visible-tab input coalesces idle renewal requests. An expired session starts
GitHub sign-in once and restores the tab's section. Explicit sign-out, removed
admission and outages leave a manual sign-in fallback. Key replacement, suspension and terminal
revocation require an explicit confirmation. Stale changes refresh the directory
and require another explicit action. Uncertain issuance results direct the user
to refresh and replace a lost key; mutations never automatically retry.

### Local UI development

`pnpm --filter @forge/rag portal:dev` is a separate local composition, never
imported or enabled by the production server. It binds only `127.0.0.1:3445`, uses
HTTPS and synthetic `local-owner`, `local-member`, `local-other` sign-ins, and
requires the exact local database `forge_rag_portal_dev`. Consumer creation,
membership, hashing, rotation, sessions and bearer authentication use the real
PostgreSQL adapters. Retrieval returns an empty synthetic result; actual corpus
retrieval and ops dogfood remain feat-529 work.

Create the dedicated database on the local `forge-rag-postgres` container and
apply migrations with `DATABASE_URL` pointing at it. Provision three distinct
local roles with the runbook's consumer writer/reader and portal session grants;
no role receives corpus writes, and the launcher verifies consumer privileges.
Set these variables in your terminal or local secret configuration:

- `RAG_CONSUMER_WRITER_DATABASE_URL`: restricted consumer writer on the dedicated DB.
- `RAG_CONSUMER_AUTH_DATABASE_URL`: restricted credential reader on the dedicated DB.
- `RAG_PORTAL_SESSION_DATABASE_URL`: restricted session role on the dedicated DB.
- `RAG_PORTAL_DEV_TLS_KEY` and `RAG_PORTAL_DEV_TLS_CERT`: local certificate files.

Set `RAG_PORTAL_DEV_PORT` to use a different loopback port when 3445 is busy,
and set `PORTAL_TEST_BASE_URL` to the matching HTTPS origin for Playwright.

Generate a short-lived localhost certificate outside Git, for example:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/rag-portal-key.pem -out /tmp/rag-portal-cert.pem -days 7 \
  -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
pnpm --filter @forge/rag portal:dev
```

Open `https://localhost:3445/portal` and accept the local development certificate
in your browser. Choose a synthetic identity, then create a consumer using the
UI. This local sign-in does not prove deployed GitHub admission or authorize
production consumer registration.

For repeatable browser verification, install Chromium with
`pnpm --filter @forge/rag exec playwright install chromium`, then run
`pnpm --filter @forge/rag portal:verify` while the launcher is running.
`PORTAL_TEST_CHROMIUM` may point to an existing Chromium executable. The browser
suite creates consumers through Create, verifies real bearer invalidation
and management separation, and renders synthetic key fixtures to prevent
credentials in failure-context artifacts. Trace/video/automatic screenshots are
disabled. Explicit screenshots are taken only after key dismissal. Synthetic
consumers remain in the local database. Evidence lives in ignored `apps/rag/output/`.

### UI conventions

Follow the user-supplied registry mockup: cool neutral background, blue accents,
white table panel and locally served Apercu typography. Navigation has RAG,
Consumers, Usage and Knowledge, without Settings. The two unfinished sections show only
the supplied capybara construction illustration, loaded on demand.

Use semantic rows with name, status, actual member count and owner-only action
popover. Provide name search, All/Active/Suspended/Revoked filters, name sorting and real
pagination (20 rows). Narrow screens scroll the table within the panel. Popovers
support keyboard traversal, Escape and outside dismissal.

Use the mockup's single consumer subtitle; omit additional labels, onboarding
sections and footers. Field labels identify inputs. Show validation messages when
input fails. Retain concise consequence/recovery text for key issuance and
destructive actions. Create submits directly and opens Save your API key; there
is no preview step.

## Usage page (feat-528, draft PR #2455)

Jaco selected **option A**, the comparison table, on 2026-09-29. Open Usage in
`/portal` with the existing GitHub login. Every admitted user sees every consumer,
including revoked consumers' historical reports; management remains owner-only.
Reporting appears when the server report reader and consumer directory are enabled.

The UTC from/to controls use whole minutes and a half-open window of at most 31
days. The default window is the previous seven days, ending one minute before
the current UTC minute. Search consumer names and page through 20 rows at a time.
Each row shows requests, completed successful responses, last activity and coverage.
Open a consumer name for the window, generated time and complete-through watermark.
Unknown/unavailable counts display a dash; partial totals stay marked. A fully
covered zero-usage consumer displays zero. A read failure clears the prior totals.

`usage.js` loads only when Usage opens. One protected `GET /portal/usage/reports`
batch reads at most 20 UUIDs, validates the whole window/page before reading and
rechecks current portal admission once per request. Per-report snapshots retain
their own generated time/coverage. The single-consumer `/portal/usage` route stays
available. All report reads are no-store and excluded from retrieval accounting.
No report data beyond the selected UTC range is stored; leaving the section, session denial or
sign-out clears report data and closes details.

For local real-accounting/report development, optionally configure both
`RAG_USAGE_WRITER_DATABASE_URL` and `RAG_USAGE_REPORT_DATABASE_URL` on the same
exact `forge_rag_portal_dev` database, with the separate grants in
`docs/ops/consumer-usage.md`. The local launcher verifies the roles and records
collector deployment `local-portal-dev`; independently declare its inventory with
the local operator capability. Historical windows before instrumentation or
missing inventory correctly show unavailable. No synthetic coverage is claimed
by the launcher. Without these optional roles, the Usage menu reports that
reporting is not enabled. This setup does not authorize production configuration.

## Production sources

Sources is a read-only top-level catalog available to existing admitted portal
users. It displays the committed production snapshot, not live database counts
or the contents of an individual consumer's retrieval allowlist.

`GET /portal/sources` rechecks admission before returning the display projection.
`src/serving/http/portal-source-brands.ts` explicitly groups existing ingestion
keys into content brands for this view only. Add future sibling keys there during
source onboarding; unmapped keys remain separate entries. Never pass the
namespaced display IDs to retrieval or consumer configuration. The registry,
corpus, `/v1` contracts, filters and citation keys retain their existing meaning.

Only positive embedded-document counts appear. Unidentified-language documents
are included once in totals and separately inspectable in language coverage.
Expected-language warnings are checked on each constituent key before grouping,
so a sibling domain's expected language cannot conceal an unexpected label.
Counts represent stored documents, not deduplicated articles across domains.

After the normal production ingestion job, use the existing `status-dashboard`
workflow to refresh and validate the snapshot, build the committed dashboard,
and hand off its PR. The portal reads `dashboard/compiled-data.json` from the
released application. Its production observation time is shown unchanged;
builds, merges and deployments do not make the observation newer. The reader
caches a successful projection for the application process; a new release starts
with the newly committed file. Failed reads stay local to Sources and can retry.
The public GitHub Pages dashboard and its publication workflow are unchanged.

`sources.js`, `sources.css` and the inventory request are deferred until Sources
opens. Leaving the view or losing admission clears its data and ignores late
responses. Sources stores no data in the browser, starts no background refresh
and issues no new credential.

Local browser verification requires no database or production access:

```sh
pnpm --filter @forge/rag portal:sources:verify
```

It starts an isolated server with synthetic admission and the real committed
snapshot. A separate synthetic 265-language fixture exercises pagination.
Install the Playwright Chromium build or set `PORTAL_TEST_CHROMIUM` to an existing
compatible executable. Screenshots are written beneath ignored `output/sources/`.
