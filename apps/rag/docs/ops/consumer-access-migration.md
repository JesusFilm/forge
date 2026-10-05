# Consumer access migration (feat-527)

The registered consumer credential is an opaque bearer secret. The service returns
it only on creation or rotation, stores only a SHA-256 verifier, and checks current
consumer state on every request. HTTPS protects it in transit; save the one-time
response in the receiver's secret manager. A lost response requires another
owner-authorized rotation. Rotation invalidates the previous credential as soon
as the transaction commits, so coordinate installation with every caller.

## Additive rollout

1. Apply the consumer-credential migration through the normal PR-to-main
   deployment. Do not roll back by dropping restricted tables.
2. Provision two **separate** PostgreSQL roles and connection URLs. The portal
   writer needs `USAGE` on `consumer_private`; `SELECT, INSERT, UPDATE` on
   `consumers` and `credentials`; `SELECT, INSERT, DELETE` on `members`; and
   `INSERT` only on `lifecycle_audit` and `allowlist_revisions`. The serving auth reader needs `USAGE` on the schema and
   `SELECT` only on `consumers` and `credentials`. Neither receives corpus,
   portal-session or usage privileges. The existing portal session role retains
   only `portal_private` privileges. Run
   `pnpm db:verify-consumer-roles` with both URLs to verify these grants and
   denials before enabling the service. Provisioning is an operator action; do
   not use the corpus or portal-session role for either URL.
3. Set `RAG_CONSUMER_WRITER_DATABASE_URL` and
   `RAG_CONSUMER_AUTH_DATABASE_URL` together. Consumer access requires the
   existing portal admission settings. Set `RAG_DEFAULT_CONSUMER_SOURCE_KEYS`
   to an operator-reviewed comma-separated set of source keys. A missing list
   creates consumers with empty scope; `/v1/search` then returns an empty 200.
   A creator cannot supply or widen grants. Verify every key exists in the
   active source registry before activation.
4. Develop and exercise the management UI locally under feat-530, using the
   real backend and a local database. End-to-end user-flow verification is
   deferred to that work. Merging the backend does not claim those checks passed
   or require temporary production consumers or an API-only operator harness.
5. During the historical registration period, the shared token path was
   `legacy-unattributed`; do not infer consumer identity from IP, user agent or
   caller headers. Feat-529 records Jaco's October 6 confirmation that the
   seven-day period and team communication occurred. Feat-609 removes that path
   after registered consumer operation was confirmed.

## Production activation ownership (feat-530)

Activate the already-deployed management backend under feat-530 before usage
reporting (feat-528) and actual ops dogfood (feat-529). A code merge deploys the
UI; it does not create PostgreSQL login roles or populate Railway secrets.
Role provisioning and receiver configuration are authorized operator actions.
The existing `forge` production `@forge/rag` service hosts both UI and retrieval.

Production role names are `forge_rag_consumer_writer` and
`forge_rag_consumer_auth_reader`. These are service accounts, not GitHub/user
roles. Both use the existing RAG database. Give them only the explicit grants
in additive rollout step 2; neither owns tables or receives administrative,
corpus, session, usage, role-switching or sequence privileges. The existing
verifier checks both required grants and forbidden effective/reachable grants.

Doppler `forge-rag/prd` retains the public-endpoint operator connections as
`FORGE_RAG_CONSUMER_WRITER_DATABASE_URL` and
`FORGE_RAG_CONSUMER_AUTH_DATABASE_URL`. Railway uses the same accounts with the
private database endpoint, under `RAG_CONSUMER_WRITER_DATABASE_URL` and
`RAG_CONSUMER_AUTH_DATABASE_URL`. Transfer values directly through process
memory/stdin, never arguments, output or files. Verify both accounts before
setting the receiver. Stage the two URLs without intermediate deployments,
then set the approved source scope and deploy the configuration together.
A source-scope change affects newly created consumers; it does not automatically
rewrite existing consumer grants.

On 2026-09-28, Jaco authorized setup under feat-530. Existing consumer tables
were confirmed; both accounts were created, credentials stored in the vault,
and `db:verify-consumer-roles` passed. Both private-endpoint URLs were staged in Railway with deployments suppressed.
Jaco approved all 59 currently registered sources. The explicit keys are now
configured in `RAG_DEFAULT_CONSUMER_SOURCE_KEYS`; future registry additions require
a policy update. Railway deployment
`39957625-7834-4803-afbc-4ef2493ef68d` succeeded. The authenticated production
portal loads its empty directory and enables Create consumer. Production creation
and one-time key handling remain pending in the feat-530 checklist. No shared-token cutoff or migration
grace starts with this setup.

## Backend contract

All mutations require a current admitted session and same-origin request.
`/portal` serves the management UI; `GET /portal/identity` is the protected
identity proof, and `GET /portal/members` supplies admitted users for selection.
`GET /portal/consumers` lists all names and states for admitted users,
with `owned`, `credentialVersion`, `membershipVersion` and `lifecycleVersion` for owners.
`GET /portal/consumers/history` lists names, states and UUIDs for the Usage page. `POST /portal/consumers`
accepts only `{ "name": "lowercase-name" }`; the initial owner is the
authenticated GitHub ID. `GET/POST /portal/consumers/:id/members` lists and
adds owners; addition accepts only `{ "githubUserId": 123, "expectedVersion": 1 }` present in the
current merged allowlist and still eligible. `DELETE
/portal/consumers/:id/members/:memberId` accepts `{ "expectedVersion": 2 }` and removes an owner while retaining at
least one. `POST /portal/consumers/:id/rotate` requires the current
`expectedVersion` and optionally accepts `reason: "lost"` to audit recovery;
it returns the replacement secret once. `POST
/portal/consumers/:id/state` accepts `active`, `suspended`, or `revoked` with an expected
lifecycle version; only a suspended consumer can resume, and active or suspended
consumers can be revoked. Revocation disables the current key immediately while
keeping the name reserved and history intact. Revoked consumers can use `POST
/portal/consumers/:id/recover` with expected credential and lifecycle versions;
this restores the consumer with a new one-time key and never reactivates the old one. Ownership
checks and changes are serialized by a row lock. A stale rotation gets 409.

The directory never returns verifiers or another owner's secret. Restricted
audit rows contain consumer ID, numeric actor and target IDs, bounded action,
timestamp, membership or credential version, and the admission SHA when
available. The restricted allowlist revision table records SHA and first
observed time; the repository PR history links that SHA to the change.
Authentication store failure returns 503; registered credential rejection
returns 401. Requests already admitted when revocation commits may finish.

The lifecycle audit records owner-operation authorization denials and version or
state conflicts against an existing consumer as `denied`. Invalid request bodies,
unknown consumer IDs and admission/origin rejection before the consumer operation
do not create lifecycle rows; no untrusted identity or request body is persisted.

## Verification sequence (updated 2026-09-28)

Merge the backend as an incremental delivery with incomplete live verification
recorded. The consumer lifecycle requires both dedicated database URLs to activate;
merging application code alone does not provision those roles or register consumers.

Next, build feat-530's management UI on a local branch using a local database and
local-only test identities/data. Exercise creation, ownership, member management,
key rotation, suspension and revocation through the actual UI. Fix schema and
backend/UI wiring there. Test data stays in local databases; it is not a deployed
feature or a temporary CI provisioning workflow.

Existing automated tests remain regression coverage. `pnpm db:verify` uses its
existing database test job; restricted-role checks are optional local checks when
both dedicated test-role URLs are supplied. This change adds no CI role provisioning
or checked-in SQL fixture credentials. Never point integration tests at production.

A consumer is an API client; the portal login identifies its human owner. When the
UI is ready, an admitted user creates the real consumer through that UI. The server
derives the initial owner and displays the credential once. The receiving operator
saves it into the receiver's secret manager. No consumer creation is needed from
Jaco during backend review.

Still unverified: the complete browser management flow, live session persistence,
allowlist-removal behavior, outage/stale publication, cookie/replay and leakage
inspection, and operational latency/concurrency. Track these honestly as follow-up
work rather than prerequisites for merging this backend slice. Standard production
role separation and source configuration remain necessary to enable access.

Feat-528 added usage visibility. Feat-529 recorded the historical dogfood and
registration period; feat-609 owns the subsequent static-token cutoff.

## Static token retirement — October 6, 2026

Jaco reports that the registration period is complete, the team has the new
consumer instructions, and active consumers show separately increasing usage and
confirm working retrieval. Feat-609 removes the `SERVE_BEARER_TOKENS` lookup and
startup requirement. The `/v1/search` Authorization header still carries each
registered consumer's own Bearer credential; current source grants and usage
identity remain unchanged.

Deploy the registered-only code through the normal PR-to-main path while the
old Railway variable is still present. The new code ignores it, so the static
credentials lose authorization when that build is deployed. Verify service
health, portal access, registered consumers and usage, and HTTP 401 for a retired
static token without recording its value. Only then remove
`SERVE_BEARER_TOKENS` from `forge/production/@forge/rag` and retire its old
caller-side copies. A removed variable on the pre-cutoff build prevents startup.
Removing the value after the new build is healthy also prevents an accidental
return of the old map during rollback.
Keep the registered consumer database roles, credentials and source grants.
Record a redacted deployment/verification receipt in feat-609; do not claim
production revocation from this code PR alone. Rollback must preserve revoked
credential denials and must not restore static-token access.

## Recovery and rollback

- Auth database unavailable: investigate the reader role and database, keep
  registered auth failing closed, and do not re-enable a revoked credential.
- Lost creation response: an existing owner uses rotation; no plaintext can be
  recovered from storage. If no owner remains admitted, restore an existing
  owner's allowlist eligibility through a normal PR before management.
- Failed rotation handoff: use another owner-authorized rotation and update the
  receiver's secret manager. The old credential is never reactivated.
- Rollback application code only after verifying current deny state. Leave the
  additive schema in place; never restore shared-token access as an incidental
  rollback. Production grace/cutoff or emergency access changes need separate
  authorization.
