---
title: "J011 RAG consumer access discovery and implementation handoff"
date: "2026-09-17"
status: complete
module: "apps/rag"
tags: ["rag", "auth", "postgresql", "usage", "discovery"]
problem_type: "implementation_readiness"
---

# RAG consumer access discovery evidence

## Outcome, scope and provenance

Discovery is complete as documentation. The canonical
[programme plan](../../../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md)
now records Jaco's accepted J014 ownership model. The former special non-author
review policy and option-B enforcement gap are **superseded**, not deferred
implementation requirements. No consumer-specific approver or approval gate is
required. Normal repository merge rules apply. No settings were changed.

### Accepted J014 model (September 17)

- Any engineer with Forge read/write access may propose/register a consumer via
  the normal consumer-registration PR process, without a special approver.
- Each consumer has nonempty GitHub-handle `owners`. GitHub login establishes
  identity; the current merged list authorizes that consumer's management and
  key regeneration. A non-owner adds their handle by PR and waits for normal
  merge. No mutable portal membership grant or global engineer/email allowlist.
- Consumer-specific CI validates nonempty owners and valid Forge/GitHub
  organisation membership to the extent safely verifiable. Unavailable live
  checks are labelled unverified with precise coverage, never replaced by a
  special human approval or a gate on all RAG PRs.
- Keys never enter git/PRs; generate/display once, store a secure verifier only,
  atomically invalidate the prior key and record bounded restricted audit events.
- Register RAGBot as an ordinary consumer first; later expose aggregate usage
  to Jaco and RAGBot through a separate narrow read-only internal tool. No query
  results, raw queries, IPs, tokens/verifiers or corpus telemetry.

Parent draft [PR #2304](https://github.com/JesusFilm/forge/pull/2304), branch
`docs/rag-consumer-access-usage-plan`, owns policy and planning. Discovery draft
[PR #2325](https://github.com/JesusFilm/forge/pull/2325), branch
`docs/rag-consumer-access-discovery`, owns this evidence and feat-518 completion.
J014 updates both in place, bringing parent documentation into the child without
moving discovery into the parent. After the parent lands, rebase the remaining
discovery changes onto main and retarget the draft. The historical evidence below
was inspected at parent `e5b22f7235385ee67d0e9aeda54916b8394408e3`; J014 started
from discovery `81009793a3caedbd154f9a206c5ca33fd805b1b3`. Read the
[J014 report](../../../../plans/2026-09-17-j014-consumer-ownership-report.md) for
current validation and delivery, not the historical receipts at the end.

### Earlier repository inspection provenance (not reverified deployment facts)

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
multiple authorized owners; hash-only tokens displayed once; immediate atomic
rotation; durable aggregate usage going forward, with no retention implementation;
heavy-use visibility and conversation first; no quotas or external-consumer rate
limits. Portal design is now, delivery after dogfood. The seven-day registration
and shared-token cutoff remain a later separately approved production action.
RAGBot dogfood must use the real `forge-rag-retrieve` HTTP path.

## 1. Consumer registry and narrow owner-validation CI

The programme plan section A is authoritative. Proposed registry entries contain
`consumerId`, bounded label/purpose, environment/source grants and nonempty
`owners: string[]` of GitHub handles. Exact registry path/schema is a feat-512
implementation choice. The earlier `config/rag-consumer-engineers.json` and
schema proposal are retired; do not create a second global engineer/email list.
No registry file or validator is implemented by this documentation PR.

Normal registration/owner-change PRs use existing repository merge rules. Any
Forge read/write engineer may propose a registration; an engineer absent from
that consumer's merged owners has no management rights until their owner-addition
PR merges. Reviewing/authoring a PR, organisation membership or owning another
consumer does not grant rights. Source grants remain explicit per-consumer
registration metadata, not a union of mutable engineer entitlements.

CI checks every consumer has at least one owner, well-formed GitHub handles and
no case-insensitive duplicates. Validate owner changes, including last-owner
removal, against the whole candidate registry. Consumer-specific CI has no
review-state evaluator, senior/team/CODEOWNER roster or special approval gate.
Existing unrelated CI and normal repository rules are unaffected.

### Exact verification coverage and limitations

A future safely authorized read-only lookup can establish organisation membership.
GitHub's [membership endpoint](https://docs.github.com/en/rest/orgs/members#check-organization-membership-for-a-user)
documents the required context and Members-read permission for fine-grained access.
[Public membership](https://docs.github.com/en/rest/orgs/members#check-public-organization-membership-for-a-user)
is incomplete: a miss cannot establish non-membership. Profile resolution proves
account existence, not organisation membership or Forge repository write access.

J014 performs no live membership lookup, permission provisioning or credential
inspection. Without a safe reader, deterministic CI proves only registry shape,
nonempty owners and valid handle syntax; account existence is an additional
check only when safely available. Label membership **unverified**, with reason
and checked SHA, on missing permissions, inaccessible private membership,
rate-limit, API/network failure or skipped checks. Do not mark these verified or
confirmed non-member. Confirmed non-members fail the membership check.

feat-512 must record actual lookup capability, check coverage and treatment of
unverified membership before activation. This is an implementation handoff, not
another product/reviewer decision. Do not silently request elevated credentials,
introduce an approver, or use a private-membership false negative as exclusion.
No live member set, CI result name or enforcement configuration is asserted here.

### Ownership publication and future acceptance

The management store may project the merged registry with its exact SHA and
resolved stable GitHub account IDs. It must not independently grant membership.
Prove trustworthy merged-source ingestion and freshness on every action: unmerged
owner additions deny; merged additions allow only after trusted application;
removed owners lose management even with existing sessions. Unknown/stale revision
fails closed. Handle rename/reassignment must not silently transfer ownership;
resolve bindings deliberately through the normal PR path and restricted audit.

Test at least one owner, malformed/duplicate handles, known member/non-member,
private membership and unavailable lookup, unrelated PRs with no added review
wait, non-owner/cross-consumer denial, PR-before/after-merge, stale publication,
last-owner protection and concurrent owner removal/rotation. Audit registration,
owner changes, revision application, issuance/rotation, suspension/revocation,
recovery and denied actions: actor/target account, consumer/environment, bounded
action/outcome, time, merged PR/SHA and internal version. No secrets, raw query,
IP, corpus or arbitrary payload in audit; no identity/contact in usage rows.

### Retired approval-enforcement investigation

The following J011 findings explain why the earlier option-B record existed.
They are historical snapshots, not current repository settings or a request to
implement the old gate. J014 did not reread/change repository settings. The old
reviewer predicate, approval matrix, global registry schema and recovery bypass
are superseded by the programme's merged per-consumer ownership model; Git history
at `81009793a` preserves their full historical text.

### Historical review-settings evidence (J011; not a J014 requirement)

The current parent has neither `config/` nor `.github/CODEOWNERS`. There is no
consumer registry, review evaluator or approval workflow. Read-only API recheck
on September 17 returned ruleset **`Main` (`12972651`)**, targeted to the default
branch, with `deletion`, `non_fast_forward` and `pull_request` rules. The latter
has `required_approving_review_count: 0`, `required_reviewers: []`,
`require_code_owner_review: false`, `require_last_push_approval: false` and
`dismiss_stale_reviews_on_push: false`. No required-status-check rule was returned.
`required_review_thread_resolution` and squash-only are enabled; they do not
establish the desired approval gate. `bypass_actors: null` is not evidence that
privileged bypass is impossible. The earlier legacy protection API 404 is not
used as proof that no other protection exists.

The exact existing workflow is **`forge-ci`**, `.github/workflows/ci.yml`, and its
aggregate job is **`ci-gate`**. The job checks dependency results; it neither lists
PR reviews nor tests changed consumer paths. Events are `pull_request` and main
`push`, not `pull_request_review`. Its comment says main _can_ require this stable
check; current effective settings do not show that requirement. The actual
supporting jobs are `commit-lint`, `affected`, `format`, `patched-deps-guard`,
`hidden-roadmap-lanes`, `dev-port-contract`, `experiment-ledger`,
`admin-graphql-generate`, `admin-schema-drift`, `web-redis-integration`,
`auth-postgres-integration`, `rag-postgres-integration`, `lint`, `test`,
`expo-doctor` and `build`. None is the missing approval evaluator. Earlier
hypothetical RAG check names remain withdrawn; no new configured name is asserted.

Main is now `8151e5518f019d314b995ebe71cbc1ace0e19342`; comparison found no relevant
changes to `.github`, RAG, Auth config or Chat auth from the inspected source.
PR #2304 is still an open draft at `e5b22f723`; discovery resumed at `4b4531b26`.
No settings or credentials were read through production services or changed.

### Historical options for the superseded approval policy

| Mechanism                                                         | Actual capability                                                                                                                        | Fit for this policy                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch/ruleset `pull_request.required_approving_review_count = 1` | Requires reviews for PRs targeting the branch; this count has no changed-path condition.                                                 | Reject: would add approvals to unrelated Forge/RAG PRs. Leave the global count unchanged.                                                                                                                           |
| Ruleset `pull_request.required_reviewers[]`                       | Each entry has `file_patterns`, `minimum_approvals`, and `reviewer: { id, type: "Team" }`. This is genuine native path-specific support. | Not an exact fit: only approval from the specified write-enabled team counts. An all-engineers team would still narrow “any non-author approval” and create membership administration. No team is selected.         |
| `require_code_owner_review` plus path-only CODEOWNERS             | Matches paths and accepts approval from an assigned owner.                                                                               | Not an exact fit: a valid non-owner approval would fail. No CODEOWNERS file or broad ownership rule is added.                                                                                                       |
| Push ruleset path restrictions                                    | Reject selected file pushes.                                                                                                             | Not an approval requirement; cannot translate into “allow with a non-author approval.”                                                                                                                              |
| Required workflow using only `on.pull_request.paths`              | Can avoid workflow execution for irrelevant files, but a skipped required workflow can remain pending and block unrelated merges.        | Reject as a shortcut. Workflow filters alone neither implement review state nor preserve unaffected PRs.                                                                                                            |
| New conditional review evaluator integrated with CI               | Could compute the exact path predicate and accept any valid non-author review while returning not-applicable success elsewhere.          | Possible later implementation, not a reliable existing control. Current CI lacks the evaluator, review events, trust boundary and merge protection; review-dismissal races and spoofable/stale statuses need proof. |

Native capabilities are documented in GitHub's
[available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
and [rules REST schema](https://docs.github.com/en/rest/repos/rules).
[CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
requires designated owners. GitHub's
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
explains skipped required workflows and path-diff limits. Review-state events are
separate [workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_review).
These sources establish available primitives, not configured Forge enforcement.

## 2. GitHub portal identity and merged consumer ownership

### Repository evidence and proposed implementation boundary

The previously inspected `apps/auth/src/auth/config.ts` conditionally wired
Google/Facebook/Apple, with no GitHub provider or RAG portal client in
`apps/auth/src/domain/apps.ts`. Chat's state/PKCE/session patterns are references,
not a GitHub portal or authorization proof; no cross-app imports. Its eight-hour
identity snapshot must not become a consumer-authorization snapshot. These are
repository observations, not claims of current deployed identity configuration.

Accepted login is GitHub identity. Proposed implementation is a RAG-owned,
server-side GitHub OAuth flow and same-origin management backend separate from
public retrieval `/v1`. Host, per-environment client/callback registration, scopes,
provisioning and publication design remain feat-515 implementation details.
Keep provider tokens/codes out of logs, browser persistence and telemetry.
No OAuth flow, registration or credential is exercised here.

Validate state, redirect binding and provider response using the supported flow;
resolve the authenticated GitHub account to its stable numeric ID and handle.
The provider proves identity; authorization comes only from that consumer's
current merged `owners`. Do not trust a submitted handle, profile/commit email,
organisation membership, PR review or repository access as an ownership grant.
The former same-entry verified-email allowlist is superseded. Email collection
or `user:email` scope is not a requirement of the accepted model.

Use revocable server-side sessions, HttpOnly/Secure/host-only cookies, CSRF/origin
checks, no-store responses and no analytics/replay on secret displays. A one-hour
maximum and fresh provider validation before key issuance are proposals to prove,
not deployed guarantees. Recheck session, current merged revision, owner binding,
consumer/environment and lifecycle state inside the mutation transaction after
locks. Provider logout is distinct from local-session revocation; neither a long
session nor provider-login success bypasses fresh consumer authorization.

The pre-portal dogfood issuance surface must use this same ownership check; no
SQL or operator bypass. Registration and owner additions/removals go through
normal PR merge, not immediate portal edits. A `ConsumerOwner` table, if used,
is a projection keyed by consumer and authenticated account, never an independent
grant. Prevent last-owner removal; unavailable valid ownership suspends management
until a normal merged repair. Jaco may coordinate recovery, but he also needs
his handle in the merged owners list to manage a consumer; no special recovery
identity overrides the list. Preserve usage history and coordinate rotation if
removed owners knew the old key; removal cannot retract a copied secret.

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

1. Authorize GitHub session/current merged owner/source grants and expected credential version;
   lock consumer then environment in deterministic order. Recheck authorization
   after locks, including current merged registry version and current consumer state.
2. Generate replacement in process memory, compute verifier, revoke old active
   row, insert replacement, increment environment credential version, append
   bounded audit and commit together. A partial unique index allows at most one
   non-revoked credential per `(consumerId, environment)`. Suspended/expired keys
   are never accepted; expiration does not bypass the single-slot constraint.
3. Reveal plaintext once only after commit in the authenticated no-store response.
   No logging, tracing, response recording, browser persistence, CLI stdout,
   audit payload, retry cache or reveal-again endpoint contains it. Other owners
   see version/status only. The UI warns replacement immediately interrupts callers.
4. A failed transaction leaves the prior key valid and reveals nothing. Concurrent
   stale versions return conflict; no silent retry rotates a winner's newly issued
   key. On response loss after commit, status reveals only that the version changed;
   the engineer explicitly rotates again. No idempotent replay of plaintext.
5. Suspend is reversible; credential revoke is terminal. Consumer revoke gates all
   environments in the same authorization state. No rollback can restore revoked
   keys or shared-token mode. A request whose authorization linearized before the
   revoke commit may finish; the next auth statement after commit must reject.

Test commit/response failure, simultaneous owners, rotate/revoke races, wrong
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

| Schema/model                                                | Keys and invariants                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rag_access.RegistryRevision`, `EngineerIdentity`           | Current merged SHA/version and application state; stable GitHub numeric ID/handle binding; unique `(provider, githubUserId)`. No global email allowlist. Restricted identity metadata only.                                    |
| `rag_access.Consumer`, `ConsumerEnvironment`                | Stable UUID, approved bounded label, projected merged owners, bounded purpose, state/times; environment PK `(consumerId, environment)`, approved source set, credential version; terminal consumer revoke.                     |
| `rag_access.ConsumerOwner`, `PortalSession`                 | Projection of merged consumer/account ownership only; revocable session digest and expiry; last-owner and current-revision rules under transaction locks.                                                                      |
| `rag_access.Credential`, `LifecycleAudit`                   | Random internal row UUID, verifier/environment uniqueness, single active slot, issue/expiry/revoke/replacement/version; bounded actions/actors, append-only audit. Row ID never travels in token/report.                       |
| `rag_access.ReportPrincipal`                                | Separate Jaco human binding and RAGBot machine capability; report-only purpose/environment/status/expiry, separate verifier namespace from retrieval keys. No owner auto-enrollment.                                           |
| `rag_usage.ConsumerDimension`, `UsageMinute`                | Only stable consumer ID, approved label history and environment/existence times; aggregates keyed by consumer/environment/UTC minute, 64-bit requests/successes, latest admission time. No contact, credential or corpus join. |
| `rag_usage.PendingAttempt`, `CollectorEpoch`, `CoverageGap` | Random internal attempt ID, consumer/environment/admission, collector epoch/sequence, completion state; fixed gap reason enum and interval, heartbeat and safe watermark. No request content.                                  |
| `rag_reporting` views                                       | Explicit aggregate/dimension/coverage columns only; no `SELECT *`, credential, contact, membership, pending-attempt or corpus exposure.                                                                                        |

Use nonnegative checks and `successes <= requests`. Keep minimal pending/dedup
state operational; compact resolved accounting through safe epoch/sequence
checkpointing, not a raw event archive or time-based retention policy. Durable
aggregates and gap history are kept going forward. Capacity/backup review remains
required before volume expansion; no retention/deletion implementation now.

### Proposed roles and processes

| Principal                          | Allowed                                                                                                               | Explicitly denied                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Metadata migration owner (offline) | DDL for new schemas, role grants/functions/views                                                                      | Runtime use; new authority over corpus                                              |
| Existing corpus runtime reader     | Existing corpus SELECT only                                                                                           | New schema access, verifier/contact reads, all metadata/corpus writes               |
| Access administration process      | Restricted registry/identity/consumer/owner/session/credential lifecycle and audit; bounded dimension synchronization | Corpus SELECT/DML, arbitrary usage mutation, report access through membership       |
| Serving auth reader                | Narrow current-state/verifier/source projection                                                                       | Contact/session/audit reads, writes, report capability verifier                     |
| Serving usage writer               | Execute fixed admission/completion/heartbeat functions                                                                | Table-wide writes, auth data, corpus, report views                                  |
| Usage reconciler                   | Bounded checkpoint/gap/pending reconciliation functions                                                               | Corpus/auth data, credential or consumer authority                                  |
| Report process reader              | SELECT approved aggregate/dimension/coverage views                                                                    | Any mutation, base pending tables, identities/contacts, retrieval verifiers, corpus |
| Report authentication reader       | Narrow report-principal state/verifier view                                                                           | Retrieval credentials, membership and corpus; separate from report-data pool        |

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

Human reports require Jaco's authenticated GitHub binding (`githubUserId` =
`219753371`, historically resolved by J011) and a separately authorized report
session; a display name or consumer ownership alone is insufficient. No global
engineer/email allowlist is required. First register **RAGBot as an ordinary retrieval
consumer**, then give it a separate narrow internal read-only usage tool. This
ordering and aggregate-only access follow the accepted consumer-first model. RAGBot gets one dedicated report-only opaque capability, separately
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
implementer owns recording that handoff, with recovery coordinated by Jaco through the normal ownership PR path.
No identity is inferred from an agent process name or a caller-supplied header.
Provisioning remains a later authorized operation.

RAGBot's **retrieval** dogfood credential is its first, separate ordinary consumer
credential used by actual `forge-rag-retrieve` over `POST /v1/search`. Report access
does not substitute for that proof. Other engineers/owners receive neither
report capability nor report access through consumer ownership.

Preserve programme E's exact later proof: known covered baseline 0/0/null; real
ops HTTP attempts +3/+3 then +5/+5; second consumer +1/+1 while first stays +5/+5;
repeat closed report; post-auth validation/retrieval failures; empty 200;
disconnects/retries; revoke and identity-preserving replacement; all-environment
consumer revoke; collector failure/recovery/gaps; forbidden role reads/writes;
synthetic grace/cutoff/rollback. No execution of that proof occurred here.

## Readiness gates and handoff

| Gate                          | Current finding / remaining handoff                                                                                                                                                                                            | Owner and timing                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| G1 — accepted owner model     | Normal registration PR; nonempty per-consumer GitHub owners; no special approver. CI validates owners/membership with explicit unverified coverage when safe live lookup is unavailable. Old option-B approval gap is retired. | feat-512; exact registry, safe lookup and merged-revision publication before activation.                             |
| G2 — accepted identity        | GitHub login; current merged owners authorize management. No global email allowlist or in-portal ownership grant.                                                                                                              | feat-512/515; stable account binding, per-environment host/client and session/freshness tests; portal after dogfood. |
| G3 — accepted reporting       | RAGBot registers first; Jaco/RAGBot aggregate-only internal tool with separate narrow capability, no query results or DB access.                                                                                               | feat-513 tool/runtime binding and provisioning handoff; feat-514 actual consumer-first HTTP proof.                   |
| G4 — implementation proofs    | Owner publication/removal races, one-time credential rotation, restricted roles, completion counts, crash/gap handling and latency budget.                                                                                     | feat-512/513/515; no runtime tests claimed here.                                                                     |
| G5 — actual dogfood           | Actual forge-rag-retrieve task path/revision, RAGBot ID, source/environment and HTTP evidence. Task definition remains absent from the inspected checkout.                                                                     | feat-514, later authorized environment.                                                                              |
| G6 — production authorization | Communications owner, seven-day grace/cutoff, complete dogfood/report coverage and rollback approval.                                                                                                                          | Separately authorized production action, never implied by these docs.                                                |

feat-518 is **complete as documentation**; feat-512–515 remain not-started. The
J014 accepted model removes the old approval-enforcement gap rather than claiming
it implemented. No new feature ID/dependency is needed. The plan and discovery
now agree; shared `/v1` contracts, product code and operational runbooks remain
unchanged. Portal, metadata schemas/roles, membership lookup, deployment and
embedding infrastructure are not proven operational by this report.

## Review and durable lessons

Self-review found and incorporated five important failure cases: a same-name CI
check was not proof of the historical approval policy; the Chat identity cookie is not a portal
authorization session; public-schema default grants defeat metadata isolation;
returning a response is not socket completion; and a fresh heartbeat cannot erase
lost usage increments. The pending completion crash window must produce incomplete
coverage, not a fabricated exact count. These RAG-specific lessons are preserved
here rather than rewriting unrelated auth systems or operational runbooks.

## Historical J011 receipts (superseded policy; results at prior revisions only)

The following dated receipts preserve earlier execution evidence, including the
now-retired option-B policy, account/email allowlist and parent-unchanged statements.
They are not current requirements or J014 verification. Follow the programme plan,
sections 1–2 above and the J014 report for the current model and branch relationship.

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
  adds this PR link and final checks. The initial delivery changed this report,
  feat-518 and the RAG README. The final path-policy handoff also updates feat-512
  and feat-515 to remove superseded senior-only/Google guidance: five docs only.
- PR #2304 was re-read before delivery and remained an open draft at the same
  head; it was neither modified nor merged. No deployment or production action.
- Final outcome: discovery complete under the approved option-B fallback;
  enforcement remains an explicit feat-512 implementation gap, not a claim of
  current protection. Current-head CI is recorded in the final job receipt.

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
was accessed. At that checkpoint, exact enforcement was the remaining discovery
dependency; the later path-policy decision below resolves its disposition.

Continuation local checks passed: changed Markdown Prettier 3.8.1,
`git diff --check`, all 33 lane frontmatters/index rows and counts, 38 relative
links, reciprocal consumer-programme dependencies, hidden-lane tests (2/2) and
the hidden-lane checker. The same pre-existing feat-461/435 reciprocal-edge
mismatch and 18 public-lane missing-frontmatter warnings remain outside scope.
The September 16 results above remain historical evidence. Full repository
`prettier --check .` also passed on September 17 (all matched files use Prettier
code style); the final report edit receives a targeted recheck. Revised-head
GitHub CI is reported separately in the job's final receipt.

## Path-policy continuation: final decision and verification

The user superseded senior-only approval with any valid non-author approval on
consumer-registry/allowlist changes only, and explicitly authorized option B if
exact reliable enforcement could not be established. Investigated native minimum
reviews, path-specific required-team reviewers, CODEOWNERS, push path rules and
conditional CI. Selected option B for the reasons in section 1; the current
capabilities are not misrepresented as a platform-wide limitation.

Self-review removed broader reviewer, latest-pusher and unrelated-path approval
requirements, separated Jaco recovery from review eligibility, assigned the gap
to existing feat-512 and corrected the feat-515 handoff. The five-area discovery
is now complete; implementation, actual dogfood and production cutoff are not.
No settings or executable files changed. Final local checks are recorded below.

Final targeted checks passed: all five changed Markdown files, whitespace, all
33 lane frontmatters/index rows (21 complete, 1 in-progress, 11 not-started,
0 blocked), reciprocal programme dependencies, completed-ticket Resolution/PR
link and 44 relative links. Hidden-lane tests pass 2/2 and the checker passes.
The existing feat-461/435 reciprocal-edge mismatch and 18 public-lane warnings
remain unchanged. No implementation or live enforcement test is claimed.

Full repository Prettier 3.8.1 also passed for this final continuation (all matched
files use Prettier code style). The final receipt edit is checked separately.
The worktree's hooks remain absent; checks were run explicitly without bypass.
Current-head GitHub CI and the pushed commit are reported in the final job result.
