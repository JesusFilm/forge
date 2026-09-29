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
`sessions`; its corpus and `consumer_private` reads were denied in the
operator permission check.

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
all six variables, so the admission portal is enabled. It still cannot create
consumers or issue credentials; that backend work remains in feat-527.

## Consumer UI (feat-530)

`/portal` now serves the management UI. `/portal/identity` provides the protected
JSON identity proof previously returned at `/portal`. The shell and static assets
contain no session data; identity, directory reads and mutations recheck current
admission. Management appears only when the consumer backend is configured.
`GET /portal/members` provides the merged allowlist for member selection; adding
members still checks live eligibility and ownership in the backend transaction.

The UI creates directly from the form, then shows the issued key once with copy/save
controls, and clears the display on dismissal, sign-out and page navigation.
It uses no browser storage or telemetry. Key replacement, suspension and terminal
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
Consumers and Knowledge, without Settings. Usage joins these after layout
selection under feat-528. The two unfinished sections show only
the supplied capybara construction illustration, loaded on demand.

Use semantic rows with name, status, actual member count and owner-only action
popover. Provide name search, All/Active/Revoked filters, name sorting and real
pagination (20 rows). Narrow screens scroll the table within the panel. Popovers
support keyboard traversal, Escape and outside dismissal.

Use the mockup's single consumer subtitle; omit additional labels, onboarding
sections and footers. Field labels identify inputs. Show validation messages when
input fails. Retain concise consequence/recovery text for key issuance and
destructive actions. Create submits directly and opens Save your API key; there
is no preview step.

## Usage page (feat-528, draft PR #2455)

Add Usage navigation and the report page after Jaco selects one of three proposed
layouts: table-first comparison, ranked overview, or consumer list with detail.
No layout is selected yet. Every admitted user sees every consumer, including
revoked consumers' historical reports. Keep management owner-only.
Use a UTC window of at most 31 days with minute-aligned boundaries. Show requests,
completed successes, last activity, complete-through and explicit coverage status.
Unknown/unavailable data is not a reliable zero; partial totals must be marked.
Report reads are excluded from retrieval usage accounting. Validate page loading
and browser authorization after implementing the selected page.
