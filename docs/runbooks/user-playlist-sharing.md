# User Playlist sharing rollout and operations

This runbook is the operator boundary for feat-411 User Playlists. It does not
authorize a direct production deploy. Land changes through the normal
pull-request-to-main flow, keep both feature flags off while establishing the
data and control planes, and treat every provider setting as unverified until
the named operator attaches current evidence.

The public-read gate is absolute: **anonymous public reads remain OFF until raw
capability redaction or exclusion is proven at Cloudflare, Railway, Datadog,
every downstream archive, and browser telemetry.** A single retained raw
capability is a failed gate, not an accepted monitoring tradeoff.

## Roles and evidence

Name these people before beginning:

| Responsibility                 | Primary | Backup | Evidence / date |
| ------------------------------ | ------- | ------ | --------------- |
| Forge release operator         |         |        |                 |
| Cloudflare owner               |         |        |                 |
| Railway owner                  |         |        |                 |
| Datadog / analytics owner      |         |        |                 |
| Auth / OAuth owner             |         |        |                 |
| Security / key custodian       |         |        |                 |
| Legal / policy owner           |         |        |                 |
| Playlist moderation owner      |         |        |                 |
| Privacy / erasure owner        |         |        |                 |
| Country / locale product owner |         |        |                 |

Store evidence in the approved restricted operations system. Evidence may
include commit IDs, aggregate counts, configuration screenshots with values
redacted, job run IDs, Cloudflare Ray IDs, and provider query links. Never put a
capability, OAuth token, report detail, playlist title, owner subject, reporter
identifier, or secret in a ticket, screenshot, shell history, or chat.

### Evidence boundary

Keep code-local and external evidence separate. A passing repository test does
not satisfy a provider gate.

| Evidence class                                 | What it can prove                                                                                                                                      | What it cannot prove                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Release-candidate source and tests             | Fail-closed flag parsing, header construction, signed context, no-store behavior, GraphQL variable omission, retention dates, and command availability | Active production revision, provider routing, secret installation, scheduled jobs, or retained telemetry |
| Deployed browser/crawler probes                | Effective public response, HTML, headers, network calls, direct-origin behavior, and immediate revocation                                              | Absence from provider logs, APM, archives, backups, or delayed pipelines                                 |
| Permissioned provider sentinel/control queries | Effective Cloudflare, Railway, Datadog, analytics, and archive exclusion/redaction for the deployed path                                               | Other providers or datasets that were not inventoried and queried                                        |

Public-read approval requires all three evidence classes for the same deployed
revision and time window. Code-local verification alone always leaves public
reads off.

## Flags and enablement order

The Admin values are the authoritative data-boundary controls. Web values and
LaunchDarkly flags are user-interface admission controls only; they must never
be relied on to protect an Admin operation.

| Control                                        | Safe initial value | Service          |
| ---------------------------------------------- | ------------------ | ---------------- |
| `forge.userPlaylist.authoring`                 | off                | Web LaunchDarkly |
| `forge.userPlaylist.publicRead`                | off                | Web LaunchDarkly |
| `FORGE_USER_PLAYLIST_AUTHORING_DEFAULT`        | `false`            | Web and Admin    |
| `FORGE_USER_PLAYLIST_PUBLIC_READ_DEFAULT`      | `false`            | Web and Admin    |
| `USER_PLAYLIST_PUBLIC_READ_EMERGENCY_DISABLED` | `true`             | Web and Admin    |

Missing or malformed opt-in values deny access. A malformed emergency-disable
value engages the kill switch. Record the evaluated value in each running
service without printing unrelated environment values.

Use this sequence:

1. Patch dependencies, deploy code, apply migrations, seed OAuth, install
   secrets, bootstrap lifecycle state, and complete every control-plane gate
   with both LaunchDarkly flags off, both defaults false, and the emergency
   disable true.
2. Enable Admin authoring for an internal verified-social cohort, then Web
   authoring. Run the owner, security, moderation, lifecycle, and deletion
   matrices. Do not enable public reads.
3. Complete the R30 readiness matrix for the named country/locale and run the
   telemetry sentinels. Public-read evidence must be zero raw capabilities at
   every layer and positive evidence that each query pipeline was live.
4. While the emergency disable remains true, set the Admin and Web public-read
   defaults and the LaunchDarkly public-read flag to the approved cohort
   values. This stages configuration without admitting requests.
5. Clear the Web emergency disable first. Re-run browser and crawler probes;
   Admin must still deny anonymous reads.
6. Clear the Admin emergency disable last. Run the complete real-link sentinel,
   immediate-revocation, header, and ordinary-Watch control probes.
7. Expand only after the time-bounded pilot passes its predeclared continuation
   thresholds. A failed country or pilot remains disabled.

Never change public-read and authoring controls simultaneously. Never clear the
Admin emergency disable until current telemetry evidence is attached.

## Deployment prerequisites

### Dependency and artifact gate

The deployed lockfile must resolve the approved patched versions currently
required by this feature:

```bash
pnpm --filter @forge/admin list next --depth 0
pnpm --filter @forge/auth list next better-auth @better-auth/oauth-provider @better-auth/expo --depth 0
pnpm --filter @forge/web list next --depth 0
```

The expected release baseline is Next `16.2.11` in Admin, Auth, and Web, and
Better Auth packages `1.6.22` in Auth. Stop if the deployed revision differs
from the reviewed lockfile. Regenerate GraphQL artifacts with repository
commands; never edit generated `*-env.d.ts` files.

### Migrations

Keep all flags off. Apply and verify these committed migrations:

- Admin:
  `apps/admin/prisma/migrations/0053_user_playlists/migration.sql`
- Admin reports:
  `apps/admin/prisma/migrations/0054_user_playlist_reports/migration.sql`
- Auth lifecycle outbox:
  `apps/auth/prisma/migrations/0004_consumer_lifecycle_outbox/migration.sql`

Run from the exact deployed revision:

```bash
pnpm --filter @forge/admin db:migrate:deploy
pnpm --filter @forge/auth db:migrate:deploy
```

`apps/admin/railway.toml` declares an Admin pre-deploy migration command only
when that config-as-code path is active. Production Auth configuration is
documented in `apps/auth/railway.toml` as dashboard-canonical and ignored by
Railway, while stage has no Auth database. Inspect the actual target service
and dashboard before running a command; do not infer live migration behavior
from either file.

### OAuth seed and provider gate

After the Auth migration, run:

```bash
pnpm --filter @forge/auth seed:first-party-apps
```

Verify the seeded production Web client without copying its secret:

- client ID: `jfp_web_production`
- audience: `https://admin.jesusfilm.org/api/graphql`
- redirect URIs:
  - `https://www.jesusfilm.org/watch/api/auth/callback`
  - `https://watch.jesusfilm.org/watch/api/auth/callback`
- allowed origins:
  - `https://www.jesusfilm.org`
  - `https://watch.jesusfilm.org`
- exact scopes: `openid`, `profile:read`, `email:read`,
  `web:watch-events:write`, `playlist:read`, `playlist:write`, and
  `playlist:share`

Author eligibility requires a persisted verified Google or Apple account
binding. A matching email/password account is not sufficient. Confirm the
production Google and Apple provider registrations, consent screens, callback
allowlists, and country availability. Provider completion rates are an R30
country gate; repository configuration alone is not proof.

### Policy and moderation gate

The legal owner must approve exact non-empty versions for Terms, Privacy, and
Community Guidelines. Web and Admin version values must match exactly. Web URLs
must be HTTPS and return a successful response without redirects to an
unapproved host. Record the approved versions, URLs, owner, and effective date.

Name a primary and backup operator with `moderate:user-playlists`, verify access
to `/dashboard/user-playlist-moderation`, and complete the moderation exercise
below before enabling authoring. The current queue supports category filtering;
do not claim moderation-state or aggregate report-count filtering without a
separately verified backend contract.

## Exact environment and secret inventory

Install values in the provider secret store. Compare names and secret-version
identifiers, never plaintext values.

### Web

- `FORGE_USER_PLAYLIST_AUTHORING_DEFAULT`
- `FORGE_USER_PLAYLIST_PUBLIC_READ_DEFAULT`
- `USER_PLAYLIST_PUBLIC_READ_EMERGENCY_DISABLED`
- `LAUNCHDARKLY_SDK_KEY`
- `USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET`
- `USER_PLAYLIST_TERMS_VERSION`
- `USER_PLAYLIST_PRIVACY_VERSION`
- `USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION`
- `USER_PLAYLIST_TERMS_URL` (HTTPS)
- `USER_PLAYLIST_PRIVACY_URL` (HTTPS)
- `USER_PLAYLIST_COMMUNITY_GUIDELINES_URL` (HTTPS)
- `ADMIN_GRAPHQL_URL`
- `WEB_ADMIN_API_KEYS`
- `WEB_AUTH_BASE_URL`
- `WEB_AUTH_ISSUER_URL`
- `WEB_AUTH_CLIENT_ID`
- `WEB_BASE_URL`
- `WEB_SESSION_SECRET`
- `NEXT_PUBLIC_CANONICAL_ORIGIN`
- `REDIS_URL`

Also inventory all browser telemetry values, including
`NEXT_PUBLIC_DATADOG_APPLICATION_ID`, `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN`, and
`NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID`. Public capability pages must
initialize neither RUM nor Google Analytics, or an independently reviewed
before-first-event sanitizer must be proven. The launch gate is zero RUM and
analytics collection requests from the capability page.

`WEB_ADMIN_API_KEYS` is the anonymous Web-to-Admin consumer bearer ring. Web
uses its first comma-separated value and Admin accepts any current entry.
`REDIS_URL` is required by Web playlist ingress limiters, which fail closed when
Redis is unavailable.

### Admin

- `FORGE_USER_PLAYLIST_AUTHORING_DEFAULT`
- `FORGE_USER_PLAYLIST_PUBLIC_READ_DEFAULT`
- `USER_PLAYLIST_PUBLIC_READ_EMERGENCY_DISABLED`
- `USER_PLAYLIST_CAPABILITY_LOOKUP_KEYS`
- `USER_PLAYLIST_CAPABILITY_ENCRYPTION_KEYS`
- `USER_PLAYLIST_REPORT_INTENT_KEYS`
- `USER_PLAYLIST_REPORT_DETAIL_KEYS`
- `USER_PLAYLIST_REPORT_IP_KEYS`
- `USER_PLAYLIST_TRUSTED_CONTEXT_HMAC_SECRET`
- `USER_PLAYLIST_TERMS_VERSION`
- `USER_PLAYLIST_PRIVACY_VERSION`
- `USER_PLAYLIST_COMMUNITY_GUIDELINES_VERSION`
- `USER_PLAYLIST_LIFECYCLE_HMAC_SECRET`
- `USER_PLAYLIST_ERASURE_API_KEYS`
- `USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY`
- `AUTH_ISSUER_URL`
- `AUTH_WEB_USER_INTROSPECTION_CLIENT_ID`
- `AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET`
- `AUTH_WEB_USER_CLIENT_IDS`
- `AUTH_WEB_USER_TOKEN_ENVIRONMENT`
- `AUTH_WEB_USER_TOKEN_AUDIENCE`
- `WEB_ADMIN_API_KEYS`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`

For production, pin `AUTH_WEB_USER_CLIENT_IDS` to `jfp_web_production`,
`AUTH_WEB_USER_TOKEN_ENVIRONMENT` to `production`, and
`AUTH_WEB_USER_TOKEN_AUDIENCE` to
`https://admin.jesusfilm.org/api/graphql`. Production GraphQL and report-write
rate limits require Redis; report writes fail closed without it.

### Auth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID`
- `APPLE_CLIENT_SECRET`
- `APPLE_APP_BUNDLE_ID`
- `APPLE_NATIVE_CLIENT_SECRET`
- `ADMIN_USER_PLAYLIST_LIFECYCLE_URL`
- `USER_PLAYLIST_LIFECYCLE_HMAC_SECRET`
- `ADMIN_USER_PLAYLIST_ERASURE_URL`
- `ADMIN_USER_PLAYLIST_ERASURE_API_KEY`
- `DATABASE_URL`

The production internal targets are:

- `ADMIN_USER_PLAYLIST_LIFECYCLE_URL=https://admin.jesusfilm.org/api/internal/user-playlists/lifecycle`
- `ADMIN_USER_PLAYLIST_ERASURE_URL=https://admin.jesusfilm.org/api/internal/user-playlists/erasure`

The lifecycle HMAC secret must match Admin. The Auth erasure key must match one
entry in Admin's comma-separated `USER_PLAYLIST_ERASURE_API_KEYS` ring.

### JSON key-ring format and custody

These five Admin variables use the same strict JSON-array format:

- `USER_PLAYLIST_CAPABILITY_LOOKUP_KEYS`
- `USER_PLAYLIST_CAPABILITY_ENCRYPTION_KEYS`
- `USER_PLAYLIST_REPORT_INTENT_KEYS`
- `USER_PLAYLIST_REPORT_DETAIL_KEYS`
- `USER_PLAYLIST_REPORT_IP_KEYS`

Each array contains one or more strict objects with `id`, `key`, and `active`:

```json
[
  {
    "id": "<1-64 characters from A-Z, a-z, 0-9, dot, underscore, or hyphen>",
    "key": "<canonical unpadded base64url encoding of exactly 32 random bytes>",
    "active": true
  }
]
```

IDs and keys must be unique, and exactly one entry must be active. Do not use
standard padded Base64. Generate all material in the approved secrets system;
never use examples, zero material, or material from another ring. Record the
custodian, creation time, active key ID, and secret-store version without
recording the key.

The lifecycle and trusted-context HMAC secrets are single shared secrets, not
rings. The erasure bearer is a comma-separated Admin ring with one current Auth
value. `USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY` is a single long-lived root
key: losing or rotating it without a data migration can break erased-subject
replay denial, so keep it under the highest available custody.

### Rotation procedures

- Capability lookup and encryption: add a new inactive entry so all readers
  know it, then deploy a ring with exactly one new active entry. Existing
  digests and ciphertext retain their old key IDs. The repository has no
  bounded re-HMAC/re-encryption command, so old capability keys must not be
  retired. If tested retirement is a launch requirement, public reads remain
  off until that gap is implemented and exercised.
- Report intents: overlap the old verifier for longer than the 10-minute
  maximum intent lifetime, verify new issuance and replay denial, then retire
  it.
- Report IP digests: retain old keys through the seven-day ceiling and the
  applicable backup window; retire only after purge and restore evidence.
- Report detail: retain old keys until every old-key row has been purged and
  every backup that could contain it has expired. Use at least 35 days after
  last use unless the recorded backup window is longer.
- Lifecycle HMAC: keep authoring and public reads off, pause the lifecycle
  worker, drain in-flight requests, update Admin and Auth, resume the worker,
  and reconcile. The boundary fails closed during a mismatch.
- Trusted context HMAC: keep public reads off, update Admin, update Web, run the
  signed-context sentinel, and restore access only after it passes.
- Erasure bearer: add the new value to Admin, switch Auth, verify a retry, then
  remove the old value.
- `WEB_ADMIN_API_KEYS`: add the new value to Admin, put it first on Web, verify
  an anonymous boundary call, then remove the old value.
- Erasure subject digest: do not rotate without an approved migration that
  preserves receipts and replay denial.

## Lifecycle bootstrap and recurring schedules

### Bootstrap gate

The Auth outbox is the source of versioned consumer lifecycle transitions.
With both features off, run:

```bash
pnpm --filter @forge/auth consumer-lifecycle:run
```

The command reconciles all human users, delivers bounded outbox batches, and
also retries account deletions. Require JSON output with `failed: 0` and
`deletion.failed: 0`. Repeat until there is no eligible pending, leased, or dead
backlog. Use permissioned aggregate queries such as:

```sql
SELECT status, count(*), min(next_attempt_at)
FROM consumer_lifecycle_outbox
GROUP BY status
ORDER BY status;

SELECT count(*)
FROM "user"
WHERE consumer_lifecycle_state = 'deleting';
```

On Admin, confirm projections are active and leases are future-dated but no
more than five minutes ahead:

```sql
SELECT state,
       count(*),
       min(active_lease_expires_at),
       max(active_lease_expires_at)
FROM consumer_lifecycle_projection
GROUP BY state
ORDER BY state;
```

Save aggregate counts only. Then use a synthetic eligible owner to prove an
owner mutation and anonymous read, and prove an expired or unknown projection
fails closed.

### Required two-minute lifecycle and deletion retry schedule

Run this command at least once every two minutes:

```bash
pnpm --filter @forge/auth consumer-lifecycle:run
```

Do not separately schedule `account-deletion:retry` during normal operation;
the combined lifecycle command already invokes it. Use
`pnpm --filter @forge/auth account-deletion:retry` only as a controlled recovery
seam. Alert on a missed run, nonzero exit, any `failed` count, any
`deletion.failed` count, or a lease/backlog older than the service objective.

Railway cron has a five-minute minimum interval and skips a scheduled run when
the previous run is still active. It therefore cannot satisfy this feature's
two-minute requirement. Before authoring is enabled, attach evidence for an
approved external scheduler with a maximum two-minute interval or an
always-on, overlap-safe worker. The repository currently provides the one-shot
command but does not establish that production scheduler; this is a launch
blocker until provider evidence exists. See
[Railway cron jobs](https://docs.railway.com/cron-jobs) and
[Railway cron workers and queues](https://docs.railway.com/guides/cron-workers-queues).

### Daily sensitive-report retention schedule

Schedule this Admin command daily at `03:17 UTC` (`17 3 * * *`):

```bash
pnpm --filter @forge/admin user-playlist-reports:purge-sensitive
```

It removes report detail scheduled at 28 days and reporter IP digests scheduled
at five days, leaving two days of operating headroom below the hard 30-day and
seven-day ceilings. Require successful JSON count output, alert on a missing or
nonzero run, and investigate an overlapping skipped run. Railway cron can meet
the daily cadence, but the dashboard job and alerts remain unverified until the
operator attaches current production evidence.

## Control-plane launch gates

### Cloudflare origin and edge

1. Require Authenticated Origin Pulls or an equivalent origin-enforced client
   certificate for the Web and Admin production hostnames. The origin, not only
   Cloudflare, must reject a request without the certificate. Prefer a
   per-hostname or zone certificate; the shared Cloudflare certificate proves
   only that traffic came from the Cloudflare network. See
   [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/explanation/)
   and its
   [setup guide](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/).
2. Disable, protect, or make unroutable every direct Railway public origin,
   including generated `*.up.railway.app` domains. A direct-origin probe must
   fail TLS or return 403 while the public hostname succeeds.
3. Do not add a WAF/Bot challenge or deny rule to `/watch/p/*`. Unlisted is not
   bot-blocked: crawlers receive the same real response and headers as a
   browser.
4. Do not cache `/watch/p/*` or its internal `/p/*` form. Confirm no cache rule,
   Transform Rule, Worker, or CDN default overrides `private, no-store`.
5. Exclude or irreversibly redact capabilities before Logpush and every archive.
   Sensitive fields include `ClientRequestPath`, `ClientRequestURI`, and
   `ClientRequestReferer`. If using a Logpush filter, combine each negative
   predicate with the job's existing `AND` conditions:
   - path does not start with `/watch/p/`
   - URI does not contain `/watch/p/`
   - referer does not contain `/watch/p/`

   Logpush filters are inclusion gates, not exclusion lists, so test null and
   referer behavior with both a sentinel and an ordinary control event. If a
   provider-owned Cloudflare dataset retains the raw value beyond the approved
   boundary, public reads stay off. See
   [Logpush filters](https://developers.cloudflare.com/logs/logpush/logpush-job/filters/).

### Railway origin and logs

- Suppress or irreversibly template both `/watch/p/<capability>` and
  `/p/<capability>` in proxy, access, deploy, and application logs.
- Do not log GraphQL bodies or variables. The server-owned Web-to-Admin request
  carries the capability in a GraphQL variable even when the public route is
  redacted.
- Disable request/response body capture and confirm error logs and stack traces
  cannot echo variables.
- Probe every generated public domain directly and require failure outside the
  Cloudflare path.
- Record the Web, Admin, and Auth service IDs, active commit IDs, log sink and
  archive destinations, retention, and redaction configuration. Repository
  files do not prove live Railway dashboard state.

### Datadog and browser analytics

Use this canonical detector in every telemetry system:

```text
(?:/watch)?/p/[A-Za-z0-9_-]{43}
```

Drop or irreversibly replace matches before indexing and archiving in at least:

- logs: `message`, structured URL/path/referrer fields, error messages, and
  stack traces;
- APM: `http.url`, `http.route`, `http.target`, `url.path`, `resource.name`,
  error message, and error stack tags;
- RUM: `view.url`, `view.url_path`, `resource.url`, action names, error fields,
  session-replay metadata, and event context.

Set sensitive-data scanning to 100%, not sampled, and verify that the chosen
action cannot be reversed to the raw value. Agent-side replacement such as
`DD_APM_REPLACE_TAGS` may supplement but does not replace full-pipeline proof.
See [Datadog APM data security](https://docs.datadoghq.com/tracing/configure_data_security/)
and the
[Sensitive Data Scanner](https://docs.datadoghq.com/security/sensitive_data_scanner/).

The code-level GraphQL instrumentation omits variables, but external APM,
AppSec, log processors, RUM, analytics, and archives are independent gates.
Prefer not loading Datadog RUM or Google Analytics at all on the public
capability route. In browser developer tools, require zero RUM, session-replay,
or analytics collection requests before declaring the page safe.

## Capability sentinel and header probes

Use synthetic data only. Read the capability silently into a shell variable
with `read -rs`; do not put it in command history, a command-line argument, a
saved URL, CI output, or an evidence document. If a temporary file is necessary,
create it with owner-only permissions and destroy it immediately after the
probe. Record timestamps and Cloudflare Ray IDs, never the URL. Rotate or
unshare the synthetic playlist at the end.

### Redaction sentinel

1. With public reads off, generate a synthetic 43-character base64url value and
   request the external `/watch/p/<value>` path. This exercises Cloudflare,
   Railway, Web, and the Web-to-Admin GraphQL hop even when Admin returns 404.
   In the same window, request ordinary `/watch` and record its separate Ray ID
   as the positive pipeline control.
2. Query the Cloudflare Logpush destination. The exact sentinel must be absent.
   The control must be present; if capability-route events are intentionally
   excluded, the sentinel Ray ID must also be absent.
3. Query Railway Web, Admin, and Auth logs for the exact sentinel and require
   zero matches. Prove each queried source is live using the ordinary control
   window or a sanitized marker.
4. Query Datadog logs, APM, RUM, archives, and security datasets for the exact
   sentinel across `service:(forge-web OR forge-admin) env:prod`; require zero
   matches. Require a positive sanitized `/watch/p/[redacted]` control or
   documented route exclusion so a broken ingestion pipeline cannot pass.
5. Inspect browser network traffic and require that only the initial navigation
   and the server-owned Admin hop handle the capability. Require no Referer on
   media or outbound requests and zero Datadog RUM, replay, or Google Analytics
   requests.
6. In a production-like environment, create a real synthetic playlist and
   exercise create, share, reveal, view, report, rotate, unshare, and delete.
   Query every layer again. The old link must immediately return 404 after
   rotation and the replacement link must work until unshared.
7. If the raw sentinel appears anywhere, set the Admin public emergency disable
   to true immediately, identify provider/dataset/field/archive/retention,
   purge it under provider procedure, rotate the affected capability, correct
   the control, and repeat the entire sentinel. Public reads remain off.

### Browser and crawler header probe

Run the same uncached request with a current browser user agent and a Googlebot
user agent. For a valid shared link require 200; for invalid, revoked, rotated,
blocked, suspended-owner, killed, and deleted links require a real and uniform 404. Upstream unavailability may return 503 but must not disclose link validity.
Every 200, 404, and 503 must include:

```text
Cache-Control: private, no-store, max-age=0
X-Robots-Tag: noindex, nofollow, noarchive
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cross-Origin-Resource-Policy: same-origin
```

Also require CSP `frame-ancestors 'none'` and the restrictive
`Permissions-Policy` emitted by the route. Confirm the response is not a
Cloudflare cache hit. The crawler must not be challenged or denied merely for
being a bot.

Inspect HTML and discovery controls:

- the raw capability is absent from rendered HTML;
- there is no canonical, hreflang, JSON-LD, or other discovery metadata;
- `robots.txt` does not disallow the link path;
- the sitemap contains no `/watch/p/` entry;
- media requests and outbound navigation send no capability referrer.

After unshare, rotate, moderation block, owner suspension, emergency disable,
or account deletion, repeat an uncached request and require immediate 404.
Verify ordinary `/watch`, home, video, and editorial Experience responses keep
their existing cache, latency, HTML, and portfolio behavior.

## Moderation triage

The moderation queue is `/dashboard/user-playlist-moderation` and requires the
explicit `moderate:user-playlists` permission. Categories are:

- `INAPPROPRIATE_CONTENT`
- `MISLEADING_OR_SPAM`
- `COPYRIGHT_OR_RIGHTS`
- `PRIVACY_OR_PERSONAL_DATA`
- `OTHER_SAFETY`

At the start of each coverage window, the primary acknowledges the queue and
the backup confirms availability. Prioritize privacy/personal-data,
copyright/rights, and safety reports; use legal or safeguarding escalation
without copying plaintext report detail into tickets or logs.

For a takedown:

1. Review only within the restricted moderation UI and record the permitted
   audit reference.
2. Choose a reason: `ABUSE`, `COPYRIGHT`, `PRIVACY`, `SAFETY`, `SPAM`, or
   `OTHER_POLICY`.
3. Confirm Block, then request the public link uncached and require immediate
   uniform 404.
4. Preserve the audit trail and notify the legal/privacy owner when applicable.
5. Restore only after documented clearance, using `REVIEW_CLEARED`,
   `APPEAL_APPROVED`, or `ERROR_CORRECTED`. Restore never overrides an inactive
   owner lifecycle state.

Use the global public-read kill switch for systemic unsafe content, queue
failure, telemetry leakage, or uncertain moderation coverage. Do not mass-edit
playlist rows as a substitute for the switch.

## Kill switch and restoration

### Public-read kill

1. Set Admin `USER_PLAYLIST_PUBLIC_READ_EMERGENCY_DISABLED=true` first.
2. Prove known synthetic shared links return uncached uniform 404.
3. Set Web `USER_PLAYLIST_PUBLIC_READ_EMERGENCY_DISABLED=true`, turn off
   `forge.userPlaylist.publicRead`, and set Web/Admin public-read defaults false.
4. Confirm owner drafts remain available, ordinary Watch is unaffected, and no
   new capability page is served.
5. Record incident time, actor, reason, provider evidence, and affected
   capability rotations without recording raw capabilities.

For a broader authoring kill, set Admin authoring false first, then Web
authoring false and its LaunchDarkly flag off. Existing data is preserved.

### Restore

Restore authoring before public reads. Do not restore public reads until the
incident is closed, raw-data purge and sentinel queries pass at every provider,
the moderation primary and backup are available, the two-minute lifecycle and
daily retention schedules are healthy, no stale lifecycle lease remains,
policies and OAuth are current, and the R30 cohort decision is still valid.
Stage public settings behind the emergency disable, clear Web first, and clear
Admin last.

## Account erasure, pseudonymization, and backups

Deletion is a fail-closed saga:

1. Auth enters `DELETING` and revokes sessions, grants, and token families.
2. Auth revokes an Apple refresh credential when one exists.
3. Auth delivers the signed lifecycle version to Admin.
4. Auth sends the bearer-authorized erasure request with the matching lifecycle
   version and idempotency key.
5. Admin atomically unshares and removes capability material, deletes reports,
   playlists, quota and lifecycle projection state, pseudonymizes playlist
   audits, and records an erasure receipt.
6. Auth deletes the identity only after Admin acknowledges the erasure.

The two-minute lifecycle command performs deletion retries. Alert whenever an
identity remains deleting beyond the service objective or a delivery becomes
dead. Do not manually delete the Auth identity before Admin acknowledgement.

Admin retains the minimum audit boundary:

- playlist audit `owner_subject` becomes null and
  `owner_subject_digest` retains the keyed pseudonym;
- the erasure receipt retains the digest, lifecycle version, aggregate counts,
  and idempotency reference;
- moderation audit playlist foreign keys become null on cascade, while the
  moderator actor remains for accountability.

Using a secure, permissioned subject parameter, verify aggregate zero rows for
playlists, owner quota, reports, and raw owner subject; verify audits have null
raw subjects and non-null digests; and verify one matching receipt. Do not paste
the subject or row output into evidence.

Inventory Railway database backups, point-in-time recovery, offsite copies,
support exports, and telemetry archives. Encrypted report detail and reporter
IP digests must be unrecoverable no later than 35 days. Record each maximum
retention and deletion method. At or after the cutoff, restore the oldest
allowed backup into an isolated restricted environment, run the sensitive-data
purge before granting interactive access, and use aggregate queries to prove
absence. Destroy the restore through the approved provider process.

If any backup or archive can retain recoverable sensitive report material past
35 days, or restore-and-purge cannot be proven, public reads remain off.

## R30 cohort and pilot readiness

Complete this matrix before naming any external country or locale. Predeclare
the observation window, minimum sample sizes, thresholds, evidence sources, and
decision rules before collecting results.

### Pre-cohort readiness matrix

| Country / locale | Product / ministry owner | Legal / moderation owner | Intended providers | Google attempts / completions / rate | Google minimum sample / threshold / pass | Apple attempts / completions / rate | Apple minimum sample / threshold / pass | Eligible searchable media numerator / denominator / coverage | Coverage threshold / pass | Representative creator tasks invited / completed / rate | Task threshold / critical failures / device mix / pass | Evidence | Decision / remediation |
| ---------------- | ------------------------ | ------------------------ | ------------------ | ------------------------------------ | ---------------------------------------- | ----------------------------------- | --------------------------------------- | ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | -------- | ---------------------- |
|                  |                          |                          |                    |                                      |                                          |                                     |                                         |                                                              |                           |                                                         |                                                        |          |                        |

Countries below the provider-completion threshold remain out of the cohort and
receive a follow-up for transactional email verification. Countries below the
eligible catalog or representative-task threshold remain out until remediated.
Do not reinterpret thresholds after seeing results.

### Time-bounded pilot continuation matrix

| Country / locale | Pilot dates | Aggregate creates | Aggregate shares | Successful link opens | Creator interviews completed / themes | Reports per 100 opens | Rate-limited mutations | 5xx / error rate | Storage growth | Public-read p95 latency | Predeclared minimum / maximum thresholds | Actual / pass | Evidence | Expand, hold, or disable |
| ---------------- | ----------- | ----------------- | ---------------- | --------------------- | ------------------------------------- | --------------------- | ---------------------- | ---------------- | -------------- | ----------------------- | ---------------------------------------- | ------------- | -------- | ------------------------ |
|                  |             |                   |                  |                       |                                       |                       |                        |                  |                |                         |                                          |               |          |                          |

Use privacy-minimized first-party aggregates and structured interview themes.
Do not create user-level behavioral profiles, retain raw token paths, attach
owner/reporter IDs, or enable public discovery. Do not source public-open counts
from page-level RUM or Google Analytics. A pilot missing any continuation or
guardrail threshold does not expand.

## Final enablement checklist

- [ ] Reviewed dependency versions and deployed commit IDs match.
- [ ] Admin and Auth migrations applied and verified.
- [ ] OAuth seed and provider registrations verified in production.
- [ ] Legal approved policy versions and HTTPS links; Web/Admin values match.
- [ ] Moderator primary/backup and escalation path exercised.
- [ ] All exact environment names are present; secret/key custody is recorded.
- [ ] Lifecycle bootstrap has zero eligible backlog and valid Admin projections.
- [ ] An approved maximum-two-minute scheduler/worker is live and alerted.
- [ ] Daily `03:17 UTC` retention purge is live and alerted.
- [ ] Cloudflare AOP/direct-origin, no-cache, and Logpush gates pass.
- [ ] Railway direct-origin and log/body suppression gates pass.
- [ ] Datadog logs/APM/RUM/archive and browser analytics gates pass.
- [ ] Synthetic and real-link sentinel queries prove zero raw capabilities.
- [ ] Browser and Googlebot headers, discovery absence, and revocation pass.
- [ ] Erasure retry, pseudonymization, and receipt verification pass.
- [ ] Backup/PITR/archive maximum retention and restore purge pass 35-day policy.
- [ ] R30 country readiness passes predeclared thresholds.
- [ ] Authoring internal pilot passes adversarial and browser gates.
- [ ] Public-read emergency switch has been tested and restored in order.
- [ ] Time-bounded pilot passes every continuation and guardrail threshold.

## Repository verification commands

Run from a clean checkout of the release candidate. These are gates, not
permission to edit generated output or deploy directly:

```bash
pnpm --filter @forge/auth lint
pnpm --filter @forge/auth typecheck
pnpm --filter @forge/auth test
pnpm --filter @forge/admin schema:print
pnpm --filter @forge/admin lint
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin test
pnpm --filter @forge/admin-graphql generate
pnpm --filter @forge/admin-graphql typecheck
pnpm --filter @forge/web lint
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web test
pnpm format:check
```

Also run the focused migration, principal/adversarial, browser, crawler,
revocation, accessibility, and ordinary-Watch performance checks from the
release candidate. Record command, commit, environment, timestamp, exit code,
and artifact link.

## Provider-state uncertainties and stop conditions

The repository does not prove any of the following live state. Each item is
`UNKNOWN` until its owner attaches current provider evidence:

| External state                                | Required evidence                                     | Stop condition                                  |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Production flags and secret versions          | Redacted service and LaunchDarkly inventory           | Missing/mismatched value                        |
| Google/Apple production and country readiness | Provider config plus completion matrix                | Unverified provider or missed threshold         |
| Two-minute lifecycle scheduler                | Run history, overlap behavior, and alerts             | Railway cron alone or cadence over two minutes  |
| Daily purge scheduler                         | Job config, successful history, and alert             | Missed/nonzero run                              |
| Cloudflare AOP and direct-origin closure      | Public success and direct-origin failure probes       | Any bypass reaches origin                       |
| Cloudflare Logpush and archives               | Job fields/filters, sentinel/control query, retention | Raw capability retained or pipeline unproven    |
| Railway domains, logs, and archives           | Domain inventory and sentinel/control queries         | Direct origin or raw capability/body retained   |
| Datadog logs/APM/RUM/security/archives        | Processors plus exact sentinel/control queries        | Raw capability or sampled/unproven scanning     |
| Browser RUM and analytics                     | Network capture from capability route                 | Any collection request with link context        |
| Backup/PITR/offsite retention                 | Maximum windows and isolated restore drill            | Recoverable sensitive material after 35 days    |
| Policy publication and operational owners     | Approval records and on-call exercise                 | Missing owner, version, HTTPS link, or coverage |
| R30 catalog, tasks, and thresholds            | Completed predeclared matrices                        | Missing evidence or failed gate                 |
| Privacy-minimized pilot aggregate source      | Sanitized schema, query, access policy, and control   | Raw paths/identifiers or user-level profiles    |
| Capability-key retirement                     | Tested bounded re-key procedure                       | Old key would need retirement without migration |

Any uncertainty affecting access control, erasure, telemetry, origin
restriction, moderation, lifecycle freshness, or legal readiness is fail-closed.
Keep public reads off; keep authoring off when the uncertainty can affect owner
or platform safety.
