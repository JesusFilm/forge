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
5. Use the existing shared token path only during the separately authorized
   seven-day registration/support grace. It is `legacy-unattributed`; do not
   infer consumer identity from IP, user agent or caller headers. A credential
   beginning `rag_` always uses registered lookup; lookup failure never falls
   through to the shared token map. Feat-529 owns the actual ops HTTP dogfood,
   grace start, communications and cutoff. No cutoff is automatic in feat-527.

## Backend contract

All mutations require a current admitted session and same-origin request.
`/portal` serves the management UI; `GET /portal/identity` is the protected
identity proof, and `GET /portal/members` supplies admitted users for selection.
`GET /portal/consumers` lists safe names and states for all admitted users,
with `owned`, `credentialVersion` and `membershipVersion` for owners. `POST /portal/consumers`
accepts only `{ "name": "lowercase-name" }`; the initial owner is the
authenticated GitHub ID. `GET/POST /portal/consumers/:id/members` lists and
adds owners; addition accepts only `{ "githubUserId": 123, "expectedVersion": 1 }` present in the
current merged allowlist and still eligible. `DELETE
/portal/consumers/:id/members/:memberId` accepts `{ "expectedVersion": 2 }` and removes an owner while retaining at
least one. `POST /portal/consumers/:id/rotate` requires the current
`expectedVersion` and optionally accepts `reason: "lost"` to audit recovery;
it returns the replacement secret once. `POST
/portal/consumers/:id/state` accepts `active`, `suspended` or `revoked`;
only a suspended consumer can resume, and revocation is terminal. Ownership
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

Feat-528 adds usage visibility and the reporting UI can follow it. Feat-529 owns
actual RAGBot HTTP dogfood and separately authorized grace/cutoff. The portal
management UI now precedes dogfood; shared-token retirement remains later work.

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
