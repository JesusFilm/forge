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
4. Exercise the authenticated backend with a nonproduction portal session,
   following the verification sequence below. Create disposable consumers for
   this check. Real receiver registration follows the rollout decision; RAGBot
   dogfood belongs to feat-529. Record only consumer IDs and approved receiver
   labels. Never capture issuance response bodies in logs or test evidence.
5. Use the existing shared token path only during the separately authorized
   seven-day registration/support grace. It is `legacy-unattributed`; do not
   infer consumer identity from IP, user agent or caller headers. A credential
   beginning `rag_` always uses registered lookup; lookup failure never falls
   through to the shared token map. Feat-529 owns the actual ops HTTP dogfood,
   grace start, communications and cutoff. No cutoff is automatic in feat-527.

## Backend contract

All mutations require a current admitted session and same-origin request.
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

## Verification before the management UI

A consumer is an API client, not a portal login. The portal login establishes
which GitHub person is allowed to create and manage that client. Signing in alone
does not register a consumer.

### Automated verification — agent or CI

Use a disposable local PostgreSQL database, apply migrations, and provision the
two restricted roles above. Run `pnpm db:verify` with `DATABASE_URL` pointing to
the disposable owner connection and both consumer URLs pointing to its restricted
roles. The tests create synthetic consumers and credentials themselves. No real
GitHub account or production credential is needed. They exercise the portal HTTP
routes and `/v1` authentication with synthetic admission and database persistence.
Delete the disposable database and its test roles after recording sanitized test
counts. Never run the fixture suite against production.

### Authenticated API verification — operator with an admitted account

After the backend is merged, deployed and configured, use a nonproduction portal
and sign in with an allowlisted GitHub account. The existing identity page is
sufficient; the feat-530 management UI is not needed. Same-origin browser requests
to `/portal/consumers` carry the HttpOnly session cookie automatically. Do not
copy that cookie into a terminal, transcript or API client.

An operator can perform the browser actions, or an agent can drive that signed-in
browser when authorized. The server derives the initial owner from the signed-in
account. The operator retains the one-time credential securely; evidence contains
only status codes, consumer IDs, versions and approved labels.

| Check                   | Request or action                                                                 | Expected result                                               |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Admission and directory | Sign in; `GET /portal/consumers`                                                  | Safe metadata; no credential/verifier                         |
| Create                  | Same-origin `POST /portal/consumers` with a unique synthetic name                 | Active consumer; signed-in user owns it; secret returned once |
| Authenticate and scope  | Use the issued secret in memory for `/v1/search`                                  | Authorized source intersection; no widening from caller input |
| Rotate                  | Owner posts current `expectedVersion` to `/:id/rotate`                            | New secret works; old secret returns 401                      |
| Lost response           | Rotate again with `reason: "lost"`                                                | Recovery issues a replacement; no stored plaintext to reveal  |
| Other admitted person   | Second admitted account lists and attempts mutation                               | Directory visible; mutation denied unless an owner            |
| Membership              | Add eligible owner; attempt to remove the final owner                             | Eligible addition succeeds; final-owner removal fails         |
| Suspend/resume          | Owner posts state changes to `/:id/state`                                         | Suspended key returns 401; resumed key works                  |
| Revoke                  | Owner posts `revoked`                                                             | Key returns 401; reactivation fails                           |
| Removed admission       | Merge removal of a test account, then attempt mutation using its existing session | Next action denied                                            |

Use a controlled receiver for bearer requests so credentials are never printed,
saved in browser console history or included in exported network captures.
Also complete the existing admission evidence gates: session persistence across
restart, forced GitHub outage/stale publication, cookie/state replay inspection,
and a redacted browser/network/log leakage review. Record an agreed synthetic
latency/concurrency baseline and acceptance budget before release. These live
checks remain open until an operator records their results; local tests do not
stand in for them.

### Real consumer registration

Create the real consumer only after the release gates and source grant are agreed.
An admitted owner creates it through the same API. The receiving operator saves
the one-time secret directly into the receiver's secret manager and installs it.
Feat-528 adds usage visibility; feat-529 verifies RAGBot's actual HTTP traffic and
owns the separately authorized grace/cutoff. No real consumer is required to
verify this PR locally.

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
