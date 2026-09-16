---
title: "J011 RAG consumer access discovery and implementation handoff"
date: "2026-09-17"
status: blocked
module: "apps/rag"
tags: ["rag", "auth", "postgresql", "usage", "discovery"]
problem_type: "implementation_readiness"
---

# RAG consumer access discovery evidence

## Outcome, scope and provenance

The five areas below have concrete implementation proposals backed by repository
inspection. Jaco's September 17 continuation settles the senior/recovery roster,
GitHub portal choice and consumer-first RAGBot reporting. **feat-518 cannot close
yet solely because the required review/check enforcement cannot be verified:**
the visible ruleset still requires zero reviews and no status checks. G2/G3 are
resolved design choices, with implementation registration/transport details below.
This is a discovery result, not authorization to provision any of these controls.

### Accepted continuation decisions (September 17)

- Senior RAG approvers: Jaco Brink (`jaco-brink`), Tatai (`tataihono`), Jian Wei
  (`jianwei1`). Jaco alone is the current recovery authority. Approval does not
  delegate recovery to Tatai or Jian Wei.
- Trusted mechanism: protected GitHub PR review plus repository CI required-check
  and approval enforcement. This supersedes this report's earlier proposal to
  choose a new trusted workflow or dedicated App; no invented check names are
  adopted. Exact observed names and the remaining discrepancy are in section 1.
- Portal option A: internal GitHub authentication, matching both an allowlisted
  GitHub account and a verified email in the same registry entry; multiple
  authorized engineers may manage an integration. This supersedes the earlier
  Google/Forge Auth recommendation in the unchanged programme-planning PR.
- Report option A: register RAGBot as an ordinary consumer first, then provide
  aggregate request counts/activity through a narrow internal read-only tool.
  Jaco and RAGBot alone may view aggregate consumer usage. Reports never mean
  query results. Transport/provisioning owner are implementation details, not
  another product decision or a production permission grant.

- Parent: draft [PR #2304](https://github.com/JesusFilm/forge/pull/2304), branch
  `docs/rag-consumer-access-usage-plan`, head
  `e5b22f7235385ee67d0e9aeda54916b8394408e3`, observed open on 2026-09-16.
- Discovery branch: `docs/rag-consumer-access-discovery`, stacked on that exact
  head. The parent owns the programme and original ticket; this PR owns this
  evidence and only discovery ticket/index updates. No parent branch or PR edit.
  After the parent lands, rebase only discovery commits onto main and retarget;
  do not merge discovery into the parent as an evidence-delivery shortcut.
- Main at inspection: `19b8f062e0b62b84e14882fc828166998265a2da`.
  Compared the cited RAG files, Chat auth directory, Auth config and seed entry
  points, and CI workflow against main. Only the inspected Auth seed script
  differed (Manager backend scope additions), unrelated to the portal proposal.
  Evidence below is pinned to the parent revision, not a deployment inventory.
- Read root/lane/RAG guides, `CONCEPTS.md`, the programme plan, RAG role tests,
  RAG evidence precedent and credential-storage solution. No relevant unresolved
  consumer-access finding was found in `todos/`; no tracked executable
  `forge-rag-retrieve` task was found. No environment/credential files were read.
- Work loop: plan the five questions against feat-518; inspect code and read-only
  GitHub metadata; review adversarial cases; compound the findings here.
  Compound Engineering commands are unavailable in this session. No delegation.
- Boundaries: documentation only. No application edits, production/Railway calls,
  live retrieval, token generation, migrations, data/corpus changes or deployments.
  Public vendor documentation was consulted only to verify underlying primitives.

The [approved programme](../../../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md)
remains authoritative: internal engineers initially; one integration identity with
multiple authorized managers; hash-only tokens displayed once; immediate atomic
rotation; durable aggregate usage going forward, with no retention implementation;
heavy-use visibility and conversation first; no quotas or external-consumer rate
limits. Portal design is now, delivery after dogfood. The seven-day registration
and shared-token cutoff remain a later separately approved production action.
RAGBot dogfood must use the real `forge-rag-retrieve` HTTP path.

## 1. Engineer allowlist and protected review

### Observed evidence

At the parent revision `config/` and `.github/CODEOWNERS` are absent. There is no
RAG engineer registry, senior reviewer policy, or RAG access-approval check.
`.github/workflows/ci.yml` has `format`, `hidden-roadmap-lanes` and `ci-gate`, but
none establishes senior approval. Its events do not include review changes.

Read-only GitHub API observations on 2026-09-16, rechecked unchanged on 2026-09-17:

- `GET /repos/JesusFilm/forge/branches/main/protection` returned 404. This alone
  does not establish absence of protection or distinguish visibility limits.
- `GET /repos/JesusFilm/forge/rulesets` returned active branch ruleset `12972651`,
  `Main`; its condition is the default branch.
- `GET /repos/JesusFilm/forge/rules/branches/main` and the ruleset detail returned
  deletion/non-fast-forward protections and a pull-request rule: squash only,
  thread resolution required, **0 required approving reviews**, no code-owner
  requirement, no last-push approval, stale-review dismissal false. No required
  status-check rule was returned. `require_extra_approval_for_unattributed_changes`
  is true; that does not establish the requested named senior approver policy.
- Ruleset detail exposed `bypass_actors: null`; do not interpret that as proof
  that privileged bypass is impossible. A repository administrator must attest
  effective protection and check-writer authority before activation.

These are GitHub configuration observations, not production service findings.
No review/protection setting was changed. Both PRs remain open drafts at the
original heads before this continuation; neither has comments/reviews containing
an additional enforcement description. The inspected workflow/config files on
current main `19b8f062e0b62b84e14882fc828166998265a2da` match the relevant source
in this branch. No effective rule for named senior approval was found.

| Verified name                                                                                                               | Location / observation                                                               | What it establishes                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `Main` (ID `12972651`)                                                                                                      | GitHub ruleset, default branch; rules `pull_request`, `deletion`, `non_fast_forward` | Protected PR/squash and history controls, but zero required approvals and no required checks in returned rules. |
| `forge-ci`                                                                                                                  | `.github/workflows/ci.yml` workflow                                                  | Repository CI runs on pull requests; not evidence that its checks are required for merge.                       |
| `ci-gate`                                                                                                                   | Aggregate job in `forge-ci`                                                          | Fails on failed/cancelled prerequisite jobs; does not inspect senior reviews.                                   |
| `commit-lint`, `affected`, `format`, `patched-deps-guard`, `hidden-roadmap-lanes`, `dev-port-contract`, `experiment-ledger` | Actual checks on discovery head `7621524cc`                                          | All passed in run `35062914744`; no named-senior approval check appears.                                        |

Other `ci-gate` prerequisites are exactly `admin-graphql-generate`,
`admin-schema-drift`, `web-redis-integration`, `auth-postgres-integration`,
`rag-postgres-integration`, `lint`, `test`, `expo-doctor`, and `build`; these
were skipped for this documentation-only diff. Check success does not establish
required-check protection. The comment immediately above `ci-gate` describes
it as the stable name that main _can_ require; it does not assert that a ruleset
currently requires it. The existing solution
`docs/solutions/auth/better-auth-authorization-resource-binding-upgrade.md` also
separates job execution from external merge enforcement. No alternative RAG
approval control was found in the scoped guidance/solutions search. The names `rag-access-policy-schema` and
`rag-access-policy-approval` in the previous report revision were hypothetical;
they are withdrawn, not existing or newly approved requirements.

### Proposed schema and enforcement contract

Keep the programme's proposed `config/rag-consumer-engineers.json`. Define its
strict schema in a future `config/rag-consumer-engineers.schema.json`:

```ts
type EngineerRegistry = {
  schemaVersion: 1
  engineers: Array<{
    engineerId: string // immutable UUID, never an integration/usage identity
    githubUserId: string // immutable numeric GitHub ID represented as a string
    githubLogin: string // current display/login spelling; not the identity key
    verifiedEmails: string[] // explicitly reviewed complete email addresses
    environments: Array<"local" | "staging" | "production">
    allowedSourceKeys: string[] // explicit registered keys, no wildcard
    status: "active" | "disabled"
  }>
}
```

Reject unknown properties, empty/duplicate IDs, logins or normalized emails,
malformed addresses, unknown environments/sources and wildcard/domain grants.
Normalize email with trim + lowercase consistently at review and login; never
collapse Gmail dots/plus aliases. Proposed validation bounds: 100 engineers, five emails per engineer, 254
characters per email, 39 per GitHub login, and 128 per source key; source lists
cannot exceed the registered source inventory. UUID and numeric-ID formats are
validated separately. A GitHub account/email pairing is a senior-reviewed identity mapping;
it is not derived from Git commit author emails, public GitHub profile emails,
a matching name, or domain membership. Record approved public approver account
IDs below, but do not collect private email addresses or create the runtime registry
in this documentation PR. Actual engineer email bindings are populated through
the protected registration process during implementation.

A future protected `config/rag-consumer-approvers.json` records separate
`approverGithubUserIds` and `recoveryGithubUserIds` fields plus schema version;
only Jaco's ID belongs in the recovery field. The authoritative roster is the
user's continuation, not account biographies or inferred organization roles.
Public `GET /users/{login}` on September 17 verified these identity bindings:

| Approved person | GitHub login | Numeric GitHub ID | Authority                    |
| --------------- | ------------ | ----------------- | ---------------------------- |
| Jaco Brink      | `jaco-brink` | `219753371`       | Senior approval and recovery |
| Tatai           | `tataihono`  | `802117`          | Senior approval only         |
| Jian Wei        | `jianwei1`   | `17999235`        | Senior approval only         |

Bind privileges to these immutable IDs; login names are labels. Do not infer
portal membership, verified email, code-review permission or recovery delegation
from the public lookup. No engineer can appoint themselves by editing PR-head
policy. Jaco recovery still requires a verified authorized session and bounded
audit; it is not a direct database or production bypass.
The canonical reviewed revision is the merged protected-main commit SHA, recorded
in the restricted access store and audit. The management service reads the active
registry revision on every action. A controlled publisher imports only an exact
merged revision with passing checks, transactionally disables removed engineers,
and invalidates their sessions. No fallback to a bundled older revision; activation
fails if synchronization cannot be established. The publication lag is a release
test/operational gate, not a claim of immediate effect at GitHub merge time.

Use the approved protected-PR plus repository-CI mechanism, with existing
`ci-gate` as the verified aggregate check entry point. The exact approval-check
name/implementation and effective required-check rule are **not found**; discovery
cannot certify that `ci-gate` enforces either today. G1 needs Jaco/repository-admin
evidence naming the intended existing control, or an explicit correction that
it must be implemented under feat-512. No new check name, App, workflow service,
or repository setting is chosen or created here.

The future enforcement must protect registry/schema, approver/recovery policy,
validator source, relevant workflow definitions, CODEOWNERS and dependencies.
Evaluate authorization from protected base/default-branch policy, never PR-head
policy with privileged permissions. A same-name Actions result is not proof of
trusted approval; the repository mechanism must prevent replacement/spoofing of
its evaluator and required checks. These are acceptance requirements for the
approved mechanism, not a request to choose a different authentication product.

Required approval behavior to verify in that repository mechanism:

1. Load approver policy from the protected base revision. Read all changed paths
   and all reviews with pagination; API errors, incomplete pages or missing
   policy fail closed. For security-policy changes require at least one named
   senior's current approval in addition to normal CI.
2. Fetch current PR head H. Ignore pending reviews; reduce each reviewer's
   decisive submitted state so a later dismissal/request-changes invalidates an
   earlier approval. A comment-only review cannot create approval. Require an
   undismissed `APPROVED` review with `commit_id == H` from a currently approved
   senior ID other than the PR author and latest pusher. Unresolved senior
   change requests fail the check. Added approvers cannot approve their own
   addition under the head policy.
3. Re-evaluate on opened/reopened/synchronize/base edit, submitted/dismissed
   reviews and trusted policy changes. Re-fetch H before publishing; discard
   the result if H moved. Bind result to H, not a stale workflow event SHA.
   Use concurrency ordering so an older approval event cannot overwrite a
   later dismissal result. Revalidate at merge, with native stale-dismissal,
   last-push approval, current-base and no-bypass protections as defense in depth.
4. Do not use path-filtered skipped/neutral jobs as approval. For irrelevant
   changes explicitly evaluate applicability. Bootstrap of the first policy
   must be an owner-approved protected change; an absent base policy is a block,
   never automatic success. Future stacked implementation branches are not
   security-policy authorities until their policy reaches protected main.

GitHub documents stale-review dismissal, last-push approval, administrator bypass
and source-pinned status checks in [protected branch controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
Its [reviews API](https://docs.github.com/en/rest/pulls/reviews) exposes review
state and commit association. The algorithm above is this discovery's proposal;
GitHub does not implement the full named-account policy merely because CI exists.

Acceptance fixtures: self-approval; newly self-added senior; renamed/recreated
login; unapproved reviewer; stale SHA; dismissal after success; later changes
requested; more than one review page; missing API permission; edited validator;
forged same-name check; push during evaluation; base/policy update; native merge
attempt with no trusted successful check. None was executed in this docs job.

## 2. Portal identity and multi-engineer ownership

### Reusable evidence and selected approach

`apps/auth/src/auth/config.ts` has conditional Google/Facebook/Apple provider
wiring but no GitHub provider. `apps/auth/src/domain/apps.ts` has no RAG portal
client. No existing Forge GitHub portal login can be claimed from this source.
`apps/chat/src/auth/oauth-state.ts` and `oauth-client.ts` offer state, PKCE and
bounded exchange patterns; their OIDC id-token/JWKS verifier does not validate
GitHub OAuth identity. `identity.ts`/`session-cookie.ts` explicitly describe an
8-hour snapshot unsuitable for general authorization. No cross-app imports.

Jaco selected **GitHub authentication**. Implement a RAG-owned server-side GitHub
OAuth web flow; do not silently substitute the earlier Google/Forge Auth design
or assume that adding GitHub to Forge Auth already happened. This keeps the
portal within RAG while using Forge's established session/CSRF implementation
patterns as reference. A future shared Auth integration would require proving
that it preserves the GitHub numeric account and verified-email binding.

### GitHub account and verified-email contract

Use a dedicated OAuth app registration per environment with only `read:user`
and `user:email`, no repository/org/admin or offline-access scopes. Fixed callback
`<approved-origin>/api/auth/callback/github`; exact per-environment origin and
client binding, no wildcard/preview callbacks or browser-supplied issuer/base URL.
Host selection, GitHub app registration and secret provisioning are feat-515
implementation tasks; no origin or registration is claimed to exist today.

Use authorization code flow with single-use random state, PKCE S256 and exact
redirect matching; exchange only from the backend with bounded network timeouts.
GitHub documents the [web authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
and [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).
These are protocol references, not proof of a configured client.

After each exchange, use that same access token to fetch the
[authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
and all [authenticated email addresses](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user),
following pagination. Require numeric user `id` equal to an active registry
`githubUserId`, and at least one email with `verified === true` whose normalized
value is in **that same engineer's** `verifiedEmails`. `primary` alone does not
mean verified. Missing email scope, incomplete pages, API error, no verified
match or account mismatch deny login. Do not treat public profile email, Git
commit email, login spelling, an Actions OIDC token, or a browser claim as proof.
Do not join account A with allowlisted email belonging only to account B.

Persist only the restricted binding `(provider: github, githubUserId)` to
`engineerId`, matched-email reference, verification time and local session state.
A changed login cannot transfer the numeric identity; conflicting bindings require
Jaco recovery. Discard OAuth token material after callback identity checks; no
provider-token persistence/refresh is needed for this short local session.
Keep tokens, authorization codes, PKCE values and email API responses out of
logging/analytics and out of the browser. No OAuth flow or credential was exercised
by discovery; the public account-ID lookup was the only account API inspection.

### RAG management and session boundary

Keep a separate RAG management entrypoint/pools with a same-origin portal backend,
not management routes on public retrieval `/v1`. The operator-mediated dogfood
precursor calls the same lifecycle authorization using a verified GitHub session;
it is not a SQL bypass. Multiple allowlisted engineers manage one integration
through membership records below, never by becoming separate usage consumers.

Use opaque server-side sessions, hashed session secrets, HttpOnly/Secure/host-only
cookies, CSRF/origin checks on mutations, no-store management responses and no
analytics/replay on issuance pages. Proposed maximum lifetime is one hour without
silent extension; issuance/recovery requires a fresh GitHub authorization callback
and account/email API revalidation. Do not claim that an OAuth callback forces a
new GitHub password challenge. Every read/mutation checks local session status,
expiry, active registry revision, engineer binding and consumer membership plus
environment/source rights. Removal/disable is effective on the next action after
the registry revision is activated, including existing sessions.

GitHub logout, provider email removal or OAuth-grant revocation does not itself
revoke an already-issued local session. Bound that snapshot to one hour; use
local session revocation/engineer disable for immediate administrative removal.
Revalidation before issuance/recovery prevents stale provider identity from
issuing keys. Document and test the distinction in feat-515; do not advertise
instant provider-wide logout propagation. Registration owner and final host are
implementation assignments, not unresolved G2 choices or permission to provision.

`ConsumerMembership(consumerId, engineerId)` is distinct from the integration's
credential. Existing managers can add only active, mapped engineers; an invited
engineer must complete verified binding before exercising management rights.
Serialize membership/scope changes, rotations and recovery on the consumer row,
then re-read authorization and registry version inside the transaction. Prevent
removal of the last active manager; if registry removal disables all managers,
suspend management and require Jaco, the sole recovery authority, to act. Do not auto-delete
or transfer the consumer or its usage history. Audit actor/target/action/outcome,
consumer/environment, time and registry revision, never secrets or arbitrary notes.

A manager may approve or issue only source/environment rights within their own
current entitlement. Effective retrieval scope remains integration-level; any
registry entitlement reduction must transactionally intersect affected integration
grants with the union of active managers' entitlements (never auto-expand grants).
Last-manager loss requires senior review of the integration's continued access;
manager removal does not claim to revoke a secret already copied. Coordinate
rotation/revocation explicitly. Recovery cannot self-authorize via portal input.

## 3. Credentials, lookup, rotation and environment binding

Evidence: `apps/rag/src/serving/http/auth.ts` uses a plaintext-keyed `TokenRegistry`
and exposes scope only. `scripts/serve.ts` loads `SERVE_BEARER_TOKENS` at startup.
There is no credential lifecycle database. The older receiver-first overlap in
`apps/rag/docs/ops/environment-and-secrets.md` stays accurate for the existing
system; the approved new lifecycle deliberately replaces it. Do not rewrite that
runbook until implementation changes the actual mechanism.

Proposed registered credential format: a fixed version marker plus 32 CSPRNG
bytes encoded as canonical base64url (256 random bits), with no embedded consumer,
environment, credential ID or selector. Generation is server-side only. Restrict
header/format length before hashing; no query-string or client-ID header auth.
No credential is generated by this discovery.

Store only `SHA-256(domain || trustedEnvironment || fullToken)` as 32-byte verifier,
with fixed, unambiguous domain/version/environment separators. An indexed unique
`(environment, verifier)` lookup joins current consumer/environment/credential
state, then uses `node:crypto.timingSafeEqual` on equal-length digest buffers;
perform the same fixed-size dummy comparison on misses. A fast digest is chosen
for uniformly random high-entropy keys, not human passwords. No pepper/key
management dependency or reversible encryption is needed for this proposal.
A digest in the credential store is itself sensitive auth data, never telemetry.

The lookup is not globally constant-time: database hit/miss latency differs.
Do not claim that a constant-time comparison removes database timing or all
surrounding-code side channels; use uniform generic auth errors and never expose
an identifier that permits selecting someone else's verifier. Node documents
[random generation, hashing and timing-safe comparison](https://nodejs.org/api/crypto.html).
These primitives do not replace the state/authorization checks.

Use the receiver's immutable configured environment, checked against the database
installation environment marker, never a caller parameter. A staging database
copy must not authenticate production credentials: both receiver/db mismatch and
cross-environment lookup fail closed. No positive auth cache in V1. Auth-store
outage returns generic service unavailable; it must never retry as legacy auth.
A distinct registered-token marker selects that path even on lookup failure;
legacy compatibility is a separately enabled, clearly unattributed path only
during the later approved grace period. Existing scope intersection, empty 200,
body limit and public health semantics remain unchanged.

Rotation transaction (initial issue uses expected version 0):

1. Authorize verified session/manager/entitlements and expected credential version;
   lock consumer then environment in deterministic order. Recheck authorization
   after locks, including active registry version and current consumer state.
2. Generate replacement in process memory, compute verifier, revoke old active
   row, insert replacement, increment environment credential version, append
   bounded audit and commit together. A partial unique index allows at most one
   non-revoked credential per `(consumerId, environment)`. Suspended/expired keys
   are never accepted; expiration does not bypass the single-slot constraint.
3. Reveal plaintext once only after commit in the authenticated no-store response.
   No logging, tracing, response recording, browser persistence, CLI stdout,
   audit payload, retry cache or reveal-again endpoint contains it. Other managers
   see version/status only. The UI warns replacement immediately interrupts callers.
4. A failed transaction leaves the prior key valid and reveals nothing. Concurrent
   stale versions return conflict; no silent retry rotates a winner's newly issued
   key. On response loss after commit, status reveals only that the version changed;
   the engineer explicitly rotates again. No idempotent replay of plaintext.
5. Suspend is reversible; credential revoke is terminal. Consumer revoke gates all
   environments in the same authorization state. No rollback can restore revoked
   keys or shared-token mode. A request whose authorization linearized before the
   revoke commit may finish; the next auth statement after commit must reject.

Test commit/response failure, simultaneous managers, rotate/revoke races, wrong
environment/database copy, expired credentials, malformed input, source reduction,
unknown registered token during legacy grace and DB outage. Use synthetic fixtures.

## 4. PostgreSQL, Prisma and privilege isolation

### Why another schema is necessary

`apps/rag/prisma/schema.prisma` models corpus/cache/staging/audit tables without
multi-schema declarations. `src/main.ts` constructs one Prisma client and wires
both search and write adapters; the HTTP handler only uses retrieval. This is
code composition, not proof of the deployed database role.

`scripts/provision-readonly.ts` grants `forge_rag_readonly` SELECT on **all public
tables**, plus future tables through owner default privileges. Its integration
test deliberately proves future public-table visibility. Access tables in public
would therefore expose verifiers/contacts to the existing corpus/evaluation reader.
A table naming prefix or Prisma model is not isolation.

Propose schemas `rag_access`, `rag_usage`, `rag_reporting`; leave existing corpus
in `public`. Extend the existing Prisma 6.19.3 schema with explicit schema names
and `@@schema("public")` for existing models; new models map to their restricted
schema. Regenerate, never hand-edit the Prisma client. Prisma documents this
[multi-schema mapping](https://www.prisma.io/docs/orm/v6/prisma-schema/data-model/multi-schema).
Audit generated migration SQL for zero corpus relocation/drop/rebuild. Fully
qualify new raw SQL. Privilege SQL, partial indexes, report views and bounded
functions require explicit migrations and independent schema/role tests; Prisma
model visibility does not grant database privileges. Extend `check-schema-drift.ts`
with precise new expected objects, not a blanket ignore of metadata drift.

### Proposed logical schema

| Schema/model                                                  | Keys and invariants                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rag_access.RegistryRevision`, `Engineer`, `EngineerIdentity` | Active reviewed SHA/version; immutable engineer UUID and unique GitHub ID/email mapping; unique `(provider, githubUserId)`; disabled state. Restricted identities only.                                                        |
| `rag_access.Consumer`, `ConsumerEnvironment`                  | Stable UUID, approved bounded label, accountable-owner reference, bounded purpose/contact, state/times; environment PK `(consumerId, environment)`, approved source set, credential version; terminal consumer revoke.         |
| `rag_access.ConsumerMembership`, `PortalSession`              | Unique consumer/engineer pair; revocable session digest and expiry; last-manager rule enforced under transaction locks.                                                                                                        |
| `rag_access.Credential`, `LifecycleAudit`                     | Random internal row UUID, verifier/environment uniqueness, single active slot, issue/expiry/revoke/replacement/version; bounded actions/actors, append-only audit. Row ID never travels in token/report.                       |
| `rag_access.ReportPrincipal`                                  | Separate Jaco human binding and RAGBot machine capability; report-only purpose/environment/status/expiry, separate verifier namespace from retrieval keys. No manager auto-enrollment.                                         |
| `rag_usage.ConsumerDimension`, `UsageMinute`                  | Only stable consumer ID, approved label history and environment/existence times; aggregates keyed by consumer/environment/UTC minute, 64-bit requests/successes, latest admission time. No contact, credential or corpus join. |
| `rag_usage.PendingAttempt`, `CollectorEpoch`, `CoverageGap`   | Random internal attempt ID, consumer/environment/admission, collector epoch/sequence, completion state; fixed gap reason enum and interval, heartbeat and safe watermark. No request content.                                  |
| `rag_reporting` views                                         | Explicit aggregate/dimension/coverage columns only; no `SELECT *`, credential, contact, membership, pending-attempt or corpus exposure.                                                                                        |

Use nonnegative checks and `successes <= requests`. Keep minimal pending/dedup
state operational; compact resolved accounting through safe epoch/sequence
checkpointing, not a raw event archive or time-based retention policy. Durable
aggregates and gap history are kept going forward. Capacity/backup review remains
required before volume expansion; no retention/deletion implementation now.

### Proposed roles and processes

| Principal                          | Allowed                                                                                                                | Explicitly denied                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Metadata migration owner (offline) | DDL for new schemas, role grants/functions/views                                                                       | Runtime use; new authority over corpus                                              |
| Existing corpus runtime reader     | Existing corpus SELECT only                                                                                            | New schema access, verifier/contact reads, all metadata/corpus writes               |
| Access administration process      | Restricted registry/identity/consumer/member/session/credential lifecycle and audit; bounded dimension synchronization | Corpus SELECT/DML, arbitrary usage mutation, report access through membership       |
| Serving auth reader                | Narrow current-state/verifier/source projection                                                                        | Contact/session/audit reads, writes, report capability verifier                     |
| Serving usage writer               | Execute fixed admission/completion/heartbeat functions                                                                 | Table-wide writes, auth data, corpus, report views                                  |
| Usage reconciler                   | Bounded checkpoint/gap/pending reconciliation functions                                                                | Corpus/auth data, credential or consumer authority                                  |
| Report process reader              | SELECT approved aggregate/dimension/coverage views                                                                     | Any mutation, base pending tables, identities/contacts, retrieval verifiers, corpus |
| Report authentication reader       | Narrow report-principal state/verifier view                                                                            | Retrieval credentials, membership and corpus; separate from report-data pool        |

All runtime logins: non-owner, no superuser/createdb/createrole/bypassrls, no role
membership allowing escalation. Revoke PUBLIC schema creation and function
EXECUTE for new metadata objects; explicit owner-scoped default privileges.
Avoid `GRANT SELECT ON ALL TABLES` outside the existing corpus reader. No new
metadata role inherits `forge_rag_readonly`. Do not pass a broad owner URL to
serving. Separate processes prevent a public retrieval compromise from acquiring
the administration/report pools; multiple pools in one process alone do not.

For narrow `SECURITY DEFINER` functions: dedicated non-login owner with only
required metadata rights, qualified objects and fixed safe `search_path` including
`pg_temp` last, no dynamic SQL, bounded arguments, PUBLIC EXECUTE revoked in the
creation transaction, and EXECUTE only to the matching role. These precautions
follow PostgreSQL's [security-definer guidance](https://www.postgresql.org/docs/current/sql-createfunction.html).
Keep the existing corpus verifier's prohibition on callable security-definer
functions; grant these new functions only to metadata roles with explicit tests.

Tests must connect as every real restricted role to a disposable local/CI DB,
force `SET TRANSACTION READ WRITE`, and prove prohibited reads/DDL/DML still fail.
Cover future public and metadata tables/default privileges, views/functions,
role inheritance/SET ROLE, TEMP, sequences, large objects and corpus writes.
Assert report query plans cannot reach access/corpus tables and synthetic secret,
contact, IP, query and corpus sentinels never appear in reports/logs. Use the
existing `tests/readonly-role.integration.test.ts` pattern without weakening it.
Ports in `src/contracts/` and metadata adapters behind `src/main.ts` preserve
`.dependency-cruiser.cjs`; serving must not import Prisma/adapters directly.

## 5. Authenticated accounting and narrow reports

### Exact count/completion boundary

Current `src/serving/http/app.ts` applies a 16 KiB body limit before authentication,
then JSON/schema validation, source intersection and retrieval. It has no consumer
identity, usage hooks or report route. `scripts/serve.ts` currently calls
`serve({ fetch: app.fetch })`; returning a Hono Response does not prove a completed
server response. New instrumentation must bridge the Node response `finish` and
premature `close` events to the admitted attempt. Node's [HTTP event contract](https://nodejs.org/api/http.html#event-finish_2)
allows server completion evidence but does not prove client receipt.

1. Authenticate current consumer/environment and admit each actual HTTP attempt
   exactly once before JSON parsing. Use a server random internal attempt ID and
   a trusted UTC admission timestamp; atomically insert pending state and increment
   its minute request count/update last activity. Retries are separate attempts.
2. On Node `finish` with status 2xx, idempotently settle the same attempt and
   increment success in its **admission** bucket. Empty-source/empty-result 200
   qualifies. On pre-finish disconnect, 4xx or 5xx, settle without success. A
   `close` after `finish` cannot undo or double-count it. Replayed completion
   cannot create success without an admitted attempt. Bound request lifetime.
3. A crash after network finish but before durable completion is unknowable from
   the database alone: retain a coverage gap and partial success count, never
   guess success or silently declare complete. This prevents a false exactness
   claim. In-process idempotence alone does not close that crash window.
4. Pre-auth body-limit/unknown/expired/revoked auth, health and legacy traffic
   stay out of consumer totals. Optional service counters use fixed denial enums
   and `legacy-unattributed`, with no guessed identity. Auth failures after revoke
   increment neither consumer count. Already-admitted work follows the race
   boundary in section 3.

Only consumer ID/environment, approved label and aggregate times/counts flow to
reports. No token/selector/verifier, IP, user-agent, raw query/result/corpus,
end-user identity, free-form error or arbitrary URL is collected. Do not add
per-source/query dimensions. Existing `app.ts` error-name output and raw error
logging in `serve.ts`/embedding fallback must receive sentinel leakage tests
before instrumentation ships; never copy these patterns into telemetry. A later
approved deployment review must check proxy/access-log/tracing capture separately.

### Coverage that cannot silently become zero

Register each serving instance's collector epoch before accepting requests. It
must renew bounded leases and persist safe checkpoints. The reporting coverage
starts only with a known instrumented deployment epoch; an uninstrumented receiver
or incomplete fleet manifest cannot produce complete coverage. Keep safe checkpoints and durable gap intervals per environment; all instance
checkpoints must cover the requested interval and all pending attempts must be
settled before marking it complete.

If usage persistence fails, bounded retrieval may continue under the approved
policy, but the instance stops advancing its safe frontier immediately. On
recovery, persist a conservative gap from its last confirmed safe checkpoint
through recovery, before resuming checkpoints. A crash/stale lease similarly
opens an unrecoverable interval until reconciliation; a heartbeat alone never
proves that no increments were lost. If gap persistence also fails, stale
checkpoints force unavailable coverage. A process restart cannot reset gaps or
advance past lost attempts as though they never existed.

Reports inspect overlap with gaps, deployment epochs, pending attempts and lease
health in one consistent snapshot. `completeThrough` is the report-window contiguous safe UTC frontier from
`windowStart`, capped at `windowEnd` (null if no frontier can be established).
A complete row reports `windowEnd`, so later heartbeats cannot change an already
certified closed-window report. A window can be complete after an older
historical gap only if its own interval is fully certified. Return partial
when known counts exist with an identified gap/pending tail, unavailable when
coverage itself cannot be established. Never synthesize 0/0 for unavailable
storage/history or an unknown consumer. For known unused consumers in fully
covered retained windows, the correct values are 0/0/null. Retired consumers and
old label versions stay reportable; do not reuse IDs.

### Proposed command, endpoint and authentication

Implement a private `POST /internal/rag/usage-report` separate from public `/v1`,
with only `{ consumerId?, environment, from, to }`. The corresponding operator
command is `usage:report --consumer <id> --environment <env> --from <UTC> --to <UTC>`;
a bounded all-consumer mode supports heavy-use visibility without arbitrary SQL.
This command/endpoint does not exist today. Use strict UTC `Z` timestamps,
minute-aligned half-open windows `[from,to)`, `from < to <= now`, maximum 31 days
per request. Reject nonaligned input instead of silently rounding: minute
aggregates cannot answer arbitrary sub-minute windows exactly. Longer historical
analysis composes adjacent bounded windows; retention is not limited to 31 days.

Single-consumer reports return one row, unknown consumer returns a typed error.
All-consumer mode uses bounded pages (proposed 100 rows) and snapshot-bound opaque
pagination; fixed ordering by request count descending then consumer ID. No
caller-selectable SQL/columns/joins/order expressions. Include zero-use consumers
and coverage status; partial counts are lower bounds, not heavy-use rankings
certified as complete. Labels are approved labels as of window end so closed
report windows remain stable across renames. Snapshot IDs/cursors are operational
pagination metadata, not additional per-request telemetry.

Fixed row contract (matches programme C): `consumerId`, `label`, `environment`,
`windowStart`, `windowEnd`, `requestCount`, `successfulRequestCount`,
`lastActivityAt`, `generatedAt`, `completeThrough`, `coverageStatus`.
Use lossless decimal strings for database bigint counts in JSON. Generate from
one repeatable-read snapshot; the same closed certified window is stable except
`generatedAt`. An unavailable report is visibly unavailable and CLI exits nonzero;
partial rows are visibly labelled (proposed exit 2), complete exit 0. Storage
outage returns generic service unavailable, not rows fabricated from defaults.

Human reports require Jaco's verified GitHub binding (`githubUserId` =
`219753371`) and active allowlisted RAG session; a matching display name or email
string alone is insufficient. First register **RAGBot as an ordinary retrieval
consumer**, then give it a separate narrow internal read-only usage tool. This
ordering and aggregate-only access are approved G3 option A. RAGBot gets one dedicated report-only opaque capability, separately
hashed/domain-bound to `rag-usage-report` and the receiver environment, with
current-state checks and revocation. It grants only this endpoint, not retrieval,
registration, rotation, membership changes or general database access. The
bounded future `forge-rag-usage-report` ops task accepts only the fixed filters,
never a URL/SQL/header override, and obtains its capability out of band from the
approved secret store. No credential on command line, stdout or agent transcript.
The report server uses the aggregate-only database role; the bot receives no DB
credential. This endpoint/capability is a concrete transport proposal for the
approved narrow tool, not a new approval prerequisite. feat-513 must document
the actual tool transport, registered RAGBot consumer ID, runtime binding and
named provisioning/rotation owner before activation; the RAG access/usage
implementer owns recording that handoff, with Jaco retaining recovery authority.
No identity is inferred from an agent process name or a caller-supplied header.
Provisioning remains a later authorized operation.

RAGBot's **retrieval** dogfood credential is its first, separate ordinary consumer
credential used by actual `forge-rag-retrieve` over `POST /v1/search`. Report access
does not substitute for that proof. Other engineers/managers receive neither
report capability nor report access through their membership.

Preserve programme E's exact later proof: known covered baseline 0/0/null; real
ops HTTP attempts +3/+3 then +5/+5; second consumer +1/+1 while first stays +5/+5;
repeat closed report; post-auth validation/retrieval failures; empty 200;
disconnects/retries; revoke and identity-preserving replacement; all-environment
consumer revoke; collector failure/recovery/gaps; forbidden role reads/writes;
synthetic grace/cutoff/rollback. No execution of that proof occurred here.

## Readiness gates and handoff

| Gate                                                  | Current finding / remaining handoff                                                                                                                                                                                                                                                                                                                                                                                                                                 | Owner and timing                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 — roster resolved; enforcement discrepancy remains | Jaco/Tatai/Jian Wei are named seniors with verified public IDs; Jaco alone recovers. Approved mechanism is protected PR review plus repository CI. Exact observed rule is `Main`, workflow `forge-ci`, aggregate check `ci-gate`; none of the returned settings/source proves required named-senior approval or required-check enforcement. Supply the intended rule/check reference or explicitly move the missing enforcement into feat-512 implementation scope. | Jaco/repository administrator; resolve discrepancy before feat-518 closes/feat-512 begins. No settings change authorized here.                       |
| G2 — design resolved                                  | GitHub OAuth, same-entry allowlisted account plus verified email, multiple managers. No Google fallback. Register per-environment portal apps/origins and assign provisioning owner; implement the one-hour revocable local session and issuance-time provider revalidation.                                                                                                                                                                                        | feat-515 implementation; host/registration and synthetic login proof before activation, portal delivery after dogfood.                               |
| G3 — design resolved                                  | RAGBot consumer first; Jaco/RAGBot aggregate counts/activity only through narrow read-only tool. Document actual transport, consumer binding and provisioning owner under the proposed endpoint/capability contract. No query results or general DB capability.                                                                                                                                                                                                     | feat-513 transport/handoff and feat-514 consumer-first dogfood; concrete runtime assignments before activation, not another discovery approval gate. |
| G4 — implementation proofs                            | Synthetic credential races, role isolation/default grants, Node completion, crash/gap tests, account/email mismatch and removal/session cases, latency budget.                                                                                                                                                                                                                                                                                                      | feat-512/513/515 as applicable; no runtime tests claimed here.                                                                                       |
| G5 — actual dogfood                                   | Actual `forge-rag-retrieve` task path/revision, selected consumer/source scope/environment, retries and real HTTP acceptance evidence.                                                                                                                                                                                                                                                                                                                              | feat-514; tracked task definition still absent; no outside Ops workspace inspected.                                                                  |
| G6 — production authorization                         | Communications owner, seven-day grace start/cutoff, complete dogfood/report coverage and rollback approval.                                                                                                                                                                                                                                                                                                                                                         | Separately approved production action only, never authorized by G1–G3 answers.                                                                       |

Existing feat-512–515 own implementation/release work; no new ticket duplicates
those scopes. feat-518 stays **blocked only on G1 enforcement verification**.
Do not ask again for senior identities, GitHub-versus-Google choice, recovery
delegation or report product choice. Once the precise control is evidenced or
its absence is explicitly accepted as feat-512 work, record that correction and
close the discovery resolution through this separate PR. Operational runbooks,
programme PR #2304 and shared `/v1` contracts remain untouched.

## Review and durable lessons

Self-review found and incorporated five important failure cases: a same-name CI
check is not a trusted approval source; the Chat identity cookie is not a portal
authorization session; public-schema default grants defeat metadata isolation;
returning a response is not socket completion; and a fresh heartbeat cannot erase
lost usage increments. The pending completion crash window must produce incomplete
coverage, not a fabricated exact count. These RAG-specific lessons are preserved
here rather than rewriting unrelated auth systems or operational runbooks.

## Documentation verification

Local documentation results on 2026-09-16:

- PASS: changed-file `npx --no-install --prefix /tmp/j007-doc-tools prettier
--check` (Prettier 3.8.1) and `git diff --check`.
- PASS: targeted Node/gray-matter validation of all 33 lane frontmatters and
  index rows/counts (20 complete, 1 in-progress, 11 not-started, 1 blocked),
  reciprocal programme dependencies, sequence feat-511 → 518 → 512 → 513 →
  514 → 515, evidence metadata and 38 relative links.
- PASS: `tsx --test scripts/check-hidden-roadmap-lanes.test.ts` (2/2) and
  `tsx scripts/check-hidden-roadmap-lanes.ts`. Reused external tool installation
  `/tmp/j007-doc-tools/node_modules` through `NODE_PATH`; no dependency/lockfile
  changes. Local runner is Node 22.22.1; repository CI uses `.nvmrc` Node 24.
- Existing broader findings: whole-lane dependency scan flags
  `feat-461.blocks: feat-435` without reverse `feat-435.depends_on: feat-461`.
  Verified unchanged in parent `e5b22f723`; all consumer programme edges pass.
  Hidden-lane checker emits 18 existing unrelated public-lane missing-frontmatter
  warnings. Neither finding was introduced or repaired by this scoped PR.
- `.husky/_` is absent in this supplied worktree; no hook was bypassed. Required
  checks were run explicitly.
- PASS: full repository `prettier --check .` (3.8.1): all matched files use
  Prettier code style; final report/PR-link edits receive the targeted check.
- Initial commit attempt found no configured author. Verified the authenticated
  GitHub account is `jaco-brink` and used its GitHub noreply identity for this
  job's commits via per-command Git options; no global/shared Git config change.

No runtime, role, crypto, HTTP, page performance, live claim, production or
cutover verification was performed or is implied by these documentation checks.

## Draft delivery receipt

- Discovery PR: [#2325](https://github.com/JesusFilm/forge/pull/2325), created as a draft.
- Branch/base: `docs/rag-consumer-access-discovery` →
  `docs/rag-consumer-access-usage-plan` at parent `e5b22f7235385ee67d0e9aeda54916b8394408e3`.
- Investigation commit: `886743382`; subsequent documentation receipt commit
  adds this PR link and final checks. Exactly three documentation files differ
  from the parent: this report, feat-518 and the RAG README.
- PR #2304 was re-read before delivery and remained an open draft at the same
  head; it was neither modified nor merged. No deployment or production action.
- Outcome: evidence delivered; implementation readiness remains blocked by
  the G1 enforcement discrepancy after the September 17 decisions. G2/G3 and
  the G1 roster/recovery authority are resolved; do not re-request those choices. Local check results above are distinct
  from GitHub CI, whose latest state is reported in the job's final receipt.

## September 17 continuation review and verification

The existing discovery PR is updated, not replaced. Jaco's explicit GitHub choice
supersedes the earlier portal recommendation; no changes to the parent planning
PR are needed to record that precedence. Self-review checked account/email
same-entry binding, numeric identity versus rename, recovery versus approval,
consumer-first bot registration versus report capability, and actual check names
versus suggested names. No new production permission is inferred.

Repository/API recheck: PR #2304 remains at `e5b22f723`; this continuation starts
from discovery head `7621524cc`. The parent and main evidence revisions above
are unchanged. Public numeric account lookups and effective-rule reads succeeded;
legacy branch-protection endpoint again returned 404. Current PR comments/reviews
contain no additional control description. No credentials or private email API
was accessed. Exact enforcement remains the only discovery dependency.

Continuation local checks passed: changed Markdown Prettier 3.8.1,
`git diff --check`, all 33 lane frontmatters/index rows and counts, 38 relative
links, reciprocal consumer-programme dependencies, hidden-lane tests (2/2) and
the hidden-lane checker. The same pre-existing feat-461/435 reciprocal-edge
mismatch and 18 public-lane missing-frontmatter warnings remain outside scope.
The September 16 results above remain historical evidence. Full repository
`prettier --check .` also passed on September 17 (all matched files use Prettier
code style); the final report edit receives a targeted recheck. Revised-head
GitHub CI is reported separately in the job's final receipt.
