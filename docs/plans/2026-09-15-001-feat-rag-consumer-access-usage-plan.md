---
title: "Formal RAG consumer access and usage visibility"
type: feat
status: planned
date: 2026-09-15
---

# Formal RAG consumer access and usage visibility

## Scope and delivery contract

Forge owns this programme. A **consumer** is an integration/application with a
nonempty `owners` list of engineers’ GitHub handles, never an individual end user. Use one private bearer token
per consumer, mapped server-side to its stable consumer ID. Do not
require a client-ID header plus secret. This private credential is distinct from
the public known-caller Consumer Bearer described in `CONCEPTS.md`.

This PR delivers planning only ([feat-526](../roadmap/rag/feat-526-rag-consumer-access-planning.md)).
Before implementation, [feat-518: consumer access discovery](../roadmap/rag/feat-518-rag-consumer-access-discovery.md)
records technical handoffs for the accepted portal allowlist and runtime consumer membership model, narrow
portal-user validation CI, GitHub identity, token verification/rotation, database
isolation and usage reports. Discovery evidence belongs in separate draft
[PR #2325](https://github.com/JesusFilm/forge/pull/2325); this plan is the canonical
policy record in [PR #2304](https://github.com/JesusFilm/forge/pull/2304).
Discovery must complete before feat-527 starts; usage, dogfood and portal follow
in order. J022 reconciles both drafts without moving discovery into this PR.

Implementation is explicitly split:

1. [feat-527: access lifecycle](../roadmap/rag/feat-527-rag-consumer-access-lifecycle.md).
2. [feat-528: usage collection and read-only reporting](../roadmap/rag/feat-528-rag-consumer-usage-visibility.md),
   dependent on access identity. Access alone cannot close the programme or permit
   shared-token cutoff; both deliverables and their release gates must pass.
3. [feat-529](../roadmap/rag/feat-529-rag-consumer-dogfood-migration.md): actual ops HTTP dogfood and seven-day migration, after usage.
4. [feat-530](../roadmap/rag/feat-530-rag-consumer-self-service-portal.md): internal self-service portal, after successful dogfood. Its design
   is captured here now because Bible lookup expansion will increase demand.

No product implementation, billing, external consumers, source import, corpus
change or production operation is included in this PR. External access requires
its own future rate-limit design. Initial heavy use is visibility and conversation
only: no new quotas, throttling or automated enforcement.

## V1 environment decision

Each consumer has exactly one runtime environment. There is no staging
environment and no separate environment table, foreign key, status, credential
slot, portal picker or usage dimension. Source grants and lifecycle state belong
to the consumer; credentials and usage reference its stable ID directly. This
applies to the implementation in [PR #2397](https://github.com/JesusFilm/forge/pull/2397)
and supersedes earlier multi-environment proposals (YAGNI).

Local/CI validation uses isolated databases and synthetic fixtures, not additional
runtime environments on a consumer. Multiple environments would require a later
deliberate redesign of identity, credentials, migration and accounting; V1 adds
no placeholder discriminator for it. GitHub admission, ownership, one-time secret
display, verifier-only storage and atomic rotation are unchanged.

## Current checkout findings and exact entry points

- `apps/rag/src/serving/http/auth.ts`: `TokenRegistry` maps raw bearer strings to
  `TokenScope`; `lookupScope` has no consumer identity or lifecycle lookup.
  `resolveScope` intersects requested sources with approved sources.
- `apps/rag/src/serving/http/app.ts`: `createApp` exposes public `/v1/health` and
  bearer-protected `POST /v1/search`; body limit precedes authentication. Invalid
  auth returns 401; empty permitted source intersection returns an empty 200.
  There is no consumer usage report in this path.
- `apps/rag/scripts/serve.ts`: composition root for HTTP dependencies.
- `apps/rag/prisma/schema.prisma`, `apps/rag/src/adapters/postgres/index.ts`:
  database boundary. Add metadata separately from corpus tables and privileges.
- `packages/rag-contracts/src/retrieval.ts` and `openapi.v1.json`: preserve `/v1`
  request/response shapes; regenerate artifacts only if their contract changes.
- `apps/rag/docs/ops/environment-and-secrets.md`: actual package-local location
  of the operations guide referenced by the package AGENTS file. It documents
  receiver-first issuance/rotation and `SERVE_BEARER_TOKENS` compatibility.
- Dogfood must use the actual `forge-rag-retrieve` ops task through the RAG HTTP
  `POST /v1/search` path. Register RAGBot as an ordinary consumer first. The task definition is not tracked in this checkout; record its
  approved workspace path/revision before executing feat-529. Seeker's client,
  direct database retrieval or a substitute curl smoke is not that proof.
- `apps/auth/src/auth/config.ts` and `apps/chat/src/auth/oauth-client.ts` are
  identity/session reference patterns only; no cross-app imports. GitHub OAuth
  proves identity; the merged repository portal-user allowlist admits users,
  and runtime consumer membership authorizes management. J021's isolated
  prototype is evidence in draft #2325, not a deployed or allowlisted portal.
- `apps/rag/src/main.ts` uses `EMBED_BASE_URL` as primary when configured, with
  OpenRouter fallback; without it, OpenRouter is primary. `FallbackEmbedder`
  catches primary failures and enforces matching model/dimensions. This supports
  the fallback assumption in code, but does not establish that the endpoint is
  local, its capacity/cost, deployment configuration or actual fallback rate.
  Later approved operations must verify these without exposing configuration
  secrets. Existing fallback error-message logging needs leakage review before
  usage instrumentation; do not copy arbitrary error text into telemetry.
- `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
  provides storage tradeoffs. Its example handoff channel is not an approval
  for this programme. No applicable unresolved finding exists in `todos/`.

Useful search: `rg -n 'TokenRegistry|lookupScope|resolveScope|SERVE_BEARER_TOKENS|createApp' apps/rag`.

## Approved decisions and remaining implementation details

J022 supersedes J014's consumer-registration PRs and Git-backed per-consumer
owner lists, and resolves J018's direct-versus-staged and secret-timing choices.
Only the **portal-user allowlist** is maintained in the repository through normal
PRs. CI validates handles against Forge contributor/read-write access to the
extent safely verifiable. After merge, GitHub OAuth accepts only authenticated
handles present in the merged allowlist. Normal repository merge rules apply;
there is no special consumer approver or extra human review gate.

Consumer records and nonempty owner membership live in the runtime database.
Portal admission allows listing all consumers and creating a consumer, but does
not confer management rights to existing consumers. Only an existing owner of a
consumer can Add member, selecting from the predetermined portal-user allowlist.
Added members become owners with the same management and token-regeneration
rights. No per-consumer registration or owner-change PR is involved.

One-time display, verifier-only persistence, immediate atomic replacement,
Jaco/RAGBot-only aggregates, seven-day grace and actual ops HTTP dogfood remain
accepted. RAGBot is the first ordinary consumer. The full portal follows dogfood;
feat-527 supplies the same authenticated creation/membership backend for an
isolated pre-portal dogfood harness, without a SQL, authorization or PR bypass.

Remaining technical details: exact allowlist path/schema, trusted merged-revision
publication/freshness, stable GitHub identity binding across renames, safely
available CI lookup coverage, and portal host/client registration. These do not
reopen the settled creation flow. Record RAGBot's ID, source scope, actual task
revision and approved receiver before dogfood. Production communications,
grace start and cutoff require separate authorization.

### Confirmed portal UX requirements (feat-530)

1. Sign in through GitHub OAuth; reject handles absent from the merged allowlist.
2. Show all consumers with safe metadata; management controls are owner-only.
3. Create consumer accepts a globally unique name matching `^[a-z0-9-]+$`:
   lowercase letters, numbers and dashes only. Enforce the same rule server-side
   and with database uniqueness, including concurrent submissions.
4. Show the signed-in engineer's own GitHub handle read-only as initial owner.
   Preview the consumer name and initial owner before submitting Add.
5. Add directly creates the backend record and owner relationship and generates
   a cryptographically random secret in one transaction. It does not stage a PR.
6. Display plaintext exactly once after successful creation, with a copy action
   and explicit warning to save it in a password manager now; it cannot be
   re-revealed. Lost responses require rotation, not plaintext persistence.
7. Only an existing owner can Add member from the current portal-user allowlist.
   Added members may manage that consumer and Generate new key. Enforce at least
   one owner and audit membership changes server-side.

### Confirmed credential and secret-lifecycle requirements

- The consumer uses the secret as-is in its HTTPS RAG requests. There is no
  separate client-ID header required; the secret alone is the presented
  credential.
- The server never stores the plaintext secret. It hashes/verifies the
  presented secret against a stored verifier and rejects invalid or revoked
  secrets. Hashing is one-way, so the server cannot recover the secret it
  issued; HTTPS protects the secret in transit. Both controls are stated in
  code and runbooks.
- A listed owner can use Generate new key: the portal issues a replacement,
  displays the new secret once, atomically replaces the stored verifier and
  invalidates the old key.
- Lost keys are replaced, not recovered.
- Never put secrets in Git, PRs, logs, tests, chat, command output or telemetry.
  Tests use synthetic non-secret fixtures.
- Every consumer has at least one runtime owner. Only an existing owner may
  add members from the current portal-user allowlist; members have owner rights.
- CI validates the repository portal-user allowlist, not runtime membership.
  Last-owner protection and membership authorization belong to the backend.

The credential format, verifier digest and lookup mechanism remain the
discovery-proposed implementation choices; the requirements above constrain
them but do not mandate any particular algorithm or transport.

## A. Portal admission, runtime membership and credential lifecycle

### Repository portal-user allowlist and narrow CI

Maintain the predetermined GitHub-handle allowlist through normal repository PRs.
Validate schema, handle syntax and case-insensitive duplicates. Safely available
read-only GitHub evidence must distinguish account existence, contribution
history, organisation membership and Forge read/write permission; none proves
all the others. Public-membership absence is not proof of non-membership.
Record exactly which contributor/access predicate was checked, candidate SHA,
result and reason. Missing permission, private visibility, rate limits, skipped
checks or network errors mean **unverified**, never a verified pass or confirmed
ineligibility. Known ineligible entries fail validation. Before activation,
feat-527 must document actual verification coverage and fail closed on unresolved
eligibility; do not silently add credentials, settings or a human approval gate.
J022 performs no live eligibility lookup and changes no CI workflow.

Publish only the trusted merged allowlist, with its applied SHA and freshness
contract. OAuth login admits only its signed-in handles; recheck current admission
on existing-session reads and mutations. Unmerged additions grant nothing,
removal denies the next portal action, and unavailable/stale authoritative state
fails closed. Bind handles to verified stable GitHub IDs so rename/reassignment
cannot silently transfer admission. Resolve changed bindings deliberately through
the allowlist PR path. The allowlist never stores consumer owner lists or secrets.

### Runtime creation, membership and audit

Authenticated users can list all consumers' safe names/status and create directly
through the backend. Validate the globally unique lowercase/numeric/dash name,
previewed values and authenticated initial owner; never accept a client-supplied
owner identity. Source grants are explicit bounded server-side policy on the
consumer, not arbitrary grants supplied by the creator; rotation cannot widen them.
Keep sensitive free text and private contacts out of the directory and git.

Proposed metadata types (names may follow package conventions):

- `Consumer`: immutable opaque `consumerId`, globally unique name, bounded purpose,
  lifecycle state, explicit allowed source keys, credential version and
  creation/update times. There is no separate environment record or state.
- `ConsumerOwner`: authoritative runtime relationship between consumer and stable
  GitHub account ID/handle, with membership version; at least one per consumer.
- `Credential`: internal random record ID, consumer link, one-way
  verifier, issued/expiry/revocation times and replacement relation.
- `LifecycleAudit`: bounded action/outcome, actor/target account, consumer ID,
  timestamp, membership/credential version and applied allowlist SHA where relevant.

Only an existing owner of the target consumer may Add member from the current
allowlist. Added members have owner-equivalent management/regeneration rights.
Recheck admission, ownership, target eligibility and lifecycle state inside the
transaction after locks. Other-consumer ownership grants no rights. Enforce
last-owner protection under concurrency. Directory access does not expose
owner-restricted audit, secrets, verifiers or aggregate reports.

Owner removal denies the next management action, including existing sessions;
it cannot retract a copied secret, so coordinate rotation/revocation. Removing a
portal user denies portal access even if runtime memberships remain for audit.
If no owner remains eligible, management fails closed; retain the last ownership
record, and restore an existing owner's eligibility through normal allowlist PR
before an authenticated ownership transfer. Jaco has no implicit bypass.

Audit creation, membership additions/removals, allowlist revision application,
issuance/rotation, suspension/revocation, recovery and denied actions. Link
allowlist changes to PR/SHA; runtime member changes to actor and membership
version. Keep append-only restricted audit separate from usage. Never log secrets,
verifiers, queries, IPs, corpus or arbitrary request bodies.

Generate cryptographically random high-entropy opaque credentials inside the
approved issuance process, outside agent transcripts. Persist only a one-way
verifier in the restricted auth store; never raw tokens or selectors. Validate
verifiers using an established constant-time mechanism. The bearer travels only
in the Authorization header over TLS, never query strings or client-ID headers.
Confirmed semantics: the server never stores the plaintext secret and cannot
recover the secret it issued, because the stored verifier is a one-way hash of
the presented secret; HTTPS protects the secret in transit while the hash-only
store protects it at rest. The consumer presents the secret as-is with no
separate client-ID header, and invalid or revoked secrets are rejected.

Exactly one active credential per consumer. An authorized
“Generate new key” action, available to any listed owner, generates a new
secret, atomically replaces/revokes the prior verifier and reveals the new
secret once in the authenticated issuance response; the old key is invalid
immediately and the replacement is the only active secret. No
decryptable/revealable tokens are retained in the database. The engineer must
save it in their own password manager/secret storage. There is no reveal-again,
old/new overlap or delayed revocation waiting for installation. This programme
intentionally supersedes the older receiver-first overlap recipe.

Lost secrets or interrupted one-time display require another authorized rotation;
the old secret cannot be recovered. Multiple owners see status/audit only,
never another owner's secret. Warn that rotation interrupts all callers using
the prior key; owners coordinate installation through their own secret storage.
Serialize rotations with credential-version checks: a stale concurrent action
fails and refreshes rather than unknowingly replacing a just-issued key. Test
transaction failure, lost response and concurrency. Never expose secret material
in logs, tickets, PRs, tests, command output, chat or telemetry; use synthetic
non-secret fixtures for tests and suppress issuance-response capture.

Suspension rejects access reversibly; revocation is terminal for a credential.
Consumer revocation rejects its current credential and prevents further issuance. Retain
minimal lifecycle history without adding a retention/deletion implementation now, rather than deleting the consumer
or reusing its ID. Restoration from suspension requires current owner authorization; a revoked
credential can never be restored by rollback or replacement.

## B. Storage, privileges and HTTP integration

Use separate restricted metadata tables/schema within RAG's bounded database;
do not place credentials in Admin or widen the corpus reader's rights. Separate
principals/capabilities: registry/issuance writer, serving auth reader, narrow
usage writer, report reader over approved aggregate views. Reporter cannot read
verifiers, contacts, corpus, lifecycle free text or mutate anything. Serving
continues to read corpus only; its new write capability is limited to usage
metadata, with an explicit boundary adapter/port and dependency-law tests.

Authenticate server-side to `AuthenticatedConsumer { consumerId, allowedSourceKeys }`.
There is no environment selector, header or environment-specific authorization
state. Validate current consumer and credential state on
every request; avoid positive caching in V1 so revocation after commit applies
to the next authentication. Auth-store failures fail closed with a generic
service-unavailable response, never legacy fallback. Requests already admitted
at revocation may finish; record this race boundary in tests and runbooks.

Preserve source intersection behavior and never broaden scope on unknown or
empty source keys. Document that empty authorized results are successful 200s,
not source access grants. Keep `/v1/health` public and out of consumer totals.
Retain request size/validation protections and generic unauthorized responses.
Inspect error, reverse proxy, access-log and tracing paths for header/body/IP
capture; use explicit bounded event enums instead of arbitrary error names or
objects in newly instrumented paths. Do not commit production evidence.

## C. Separate observable deliverable

Build a repeatable operator-only read-only report command (proposed
`usage:report --consumer <stable-id> --from <UTC> --to <UTC>`)
and a documented report schema, not a public dashboard. Initially only Jaco and
RAGBot may read reports. Give RAGBot a dedicated authenticated, read-only report
capability through a bounded endpoint/ops task with fixed aggregate fields and
validated windows, not a general database credential or arbitrary SQL. The
server-side report role reads aggregate views only. Other engineers
and consumer owners gain no report access by virtue of ownership. The command is future
work; it does not exist in this PR. Report rows contain only consumer ID, approved
label, `windowStart`, `windowEnd`, `requestCount`,
`successfulRequestCount`, `lastActivityAt`, `generatedAt`, `completeThrough` and
`coverageStatus` (`complete | partial | unavailable`). No owner contact in rows.

Counting contract:

- UTC half-open windows `[from, to)`, keyed to request admission time. Each HTTP
  attempt authenticated to an active integration increments request count once;
  retries are separate attempts. Count validation/retrieval errors after auth.
- Success means a completed server 2xx response, including empty retrieval;
  it does not claim the caller received or used it. Disconnects before response
  completion, failures and denied auth never count as successful.
- Last activity is latest authenticated admission in the window, null for none.
  Totals are grouped by stable consumer ID, unaffected by rotation.
- Unknown/invalid/revoked auth and pre-auth body-limit rejection remain bounded
  aggregate service denial counters, not guessed integration identity. After
  revocation neither successful count nor authenticated request count increases.
- Never record token values/selectors/verifiers, IPs, user agents, raw query text,
  corpus/result text, arbitrary URLs or personal end-user identifiers in usage.
  Keep auth verifiers solely in the restricted credential store.

Proposed mechanism: atomically maintain bounded per-minute aggregates and
pending/completed attempt accounting in a dedicated metadata adapter. A random,
server-created attempt ID may deduplicate completion writes internally; do not
expose it or derive it from request content/credentials. Short-lived pending
records contain only consumer identity and timestamps. Durable aggregate consumer-usage metrics are kept going forward for product-growth
insight. Raw/sensitive events are not collected; minimal pending accounting is
operational state, not a raw event archive. Do not implement deletion/retention
policy now. Storage growth, granularity, pending-state capacity and backup cost
need a future operational capacity review before volume expansion; durable does
not promise infinite unbounded storage.
Do not sample counts. Test atomic increments and idempotent completion under
concurrency, retry, process crash and rotation.

Telemetry failure must not masquerade as zero: report independent collector
heartbeat/watermark and unresolved pending intervals; window coverage is complete
only after all participating instances have reconciled and flushed it. Preserve
gaps durably after recovery. If a write fails, bounded retrieval may continue,
but the report must mark the affected interval partial/unavailable; if the gap
cannot be durably recorded, stale heartbeat/watermark must force unavailable.
Never return a clean zero on DB failure, unavailable historical coverage, delayed flush,
missing deployment instrumentation or unknown consumer. Unknown consumer is a
report error; zero is only an existing consumer in a fully covered retained window.
A report exits nonzero on unavailable coverage and visibly marks partial coverage.

## D. Shared-token migration and rollback

Inventory integrations by accountable owner without recording credential values
or selectors. Create each through the authenticated backend with runtime ownership. During the seven-day registration/support grace,
legacy auth remains an explicit separate mode labelled `legacy-unattributed`;
a shared token cannot provide honest per-integration usage. Never infer identity
from IP, user-agent or a supplied client-ID header. Registered-credential lookup
failure cannot fall through into legacy authorization.

After foundation and usage visibility, dogfood/support existing callers for
seven days to register through the new path. Record a communicated start and
cutoff timestamp in the separately approved production cutover scope. After the
seven days, disable the shared legacy bearer path under that approval, with
owner migration status, successful actual ops dogfood and complete reporting
coverage as cutover checks. Escalate unmet checks to the cutover owner; this plan
authorizes neither automatic production action nor a silent grace extension.

Use additive schema rollout and normal PR-to-main deployments only. Roll back
reporting independently while marking coverage unavailable. Auth rollback must
preserve current deny state and cannot revive revoked credentials or automatically
reenable shared tokens; prefer disabling retrieval to restoring unauthorized
access. Rehearse rollback with synthetic metadata before rollout. No destructive
schema rollback or corpus write is needed. Define operator ownership and recovery
steps for auth DB failure, telemetry loss, failed handoff and partial cutover.

## E. Acceptance and release verification

Implementation tests use isolated local/CI databases and synthetic fixtures.
Real dogfood is a later approved environment operation, not performed by these documentation jobs, including J014.

1. Apply the approved decisions. Locate the actual `forge-rag-retrieve` task path/revision and
   approved receiver; absent client access blocks release proof.
2. Register RAGBot first through the authenticated creation backend with an
   allowlisted initial owner and one-time issuance. Before full portal delivery,
   use an isolated harness exercising the same authorization. Register a second synthetic
   integration for isolation. No privileged bypass or special auth path.
3. Establish a retained, fully covered UTC report window and obtain a baseline
   using the report reader. Existing unused integration reports 0/0/null.
4. Through the **actual `forge-rag-retrieve` ops task and real `POST /v1/search` endpoint**, send
   three known synthetic successful requests. Disable retries or record actual
   HTTP attempts. Suppress bodies/headers in all captured output. Wait for the
   watermark to cover them: report deltas must be requests +3, successes +3,
   last activity inside the stated window.
5. Send two more: deltas become +5/+5. Send one request with the second integration:
   its delta is +1/+1 and the dogfood consumer stays +5/+5. Repeat the same read-only report and
   assert stable output for the closed window, excluding generation time.
6. Test a post-auth invalid request and retrieval failure: request count rises,
   successful count does not. Verify empty 200, disconnect and retry semantics.
7. Revoke the dogfood credential, then issue new requests: 401, no success increment.
   Issue its approved replacement and verify identity continuity; revoke the
   consumer and verify new requests reject its credential. Check
   suspension/resumption, source isolation and concurrent revoke.
8. Interrupt collector/storage and simulate missing instrumentation, delayed flush,
   crash and unavailable historical coverage. Reports visibly become partial/unavailable, never
   clean zero. Recover and demonstrate gap handling and exact concurrent counts.
9. Verify report principal cannot write, read credentials/contacts or read corpus;
   inspect report schema/log sinks using synthetic sentinel values for leakage.
10. Rehearse shared-token grace/cutoff and rollback. Record only synthetic counts,
    window, coverage, pass/fail, receiver label and code revision in release
    evidence; no tokens, selectors, IPs, raw queries, corpus or production evidence.

Admission/membership acceptance for feat-527/530: malformed/duplicate handles,
known ineligibility, private visibility and unavailable lookup have explicit CI
outcomes. An unmerged allowlist addition denies login; trusted merged publication
admits it; removal denies existing sessions. All admitted users see all consumers,
but only owners manage a target consumer. Test direct creation, invalid names,
global duplicate/concurrent-name conflicts, read-only initial owner tampering,
preview/submit consistency and one-time display. Only owners can Add member;
reject non-allowlisted targets and cross-consumer or concurrent removal/rotation
races. Prove last-owner protection, stable identity/rename safety, stale allowlist
denial, restricted audits, atomic rotation, old-key rejection and response-loss
recovery without secret leakage. CI is never the runtime membership authority.

Future code verification: `pnpm --filter @forge/rag test`, `typecheck`, `lint`,
`depcruise`, isolated `db:verify` plus new role/integration tests; run contract
tests/drift if contracts change. Measure added auth/telemetry latency and concurrency
against an agreed pre-change synthetic baseline; set the acceptance budget before
release. No live retrieval or runtime test is claimed by this documentation PR.

## F. Portal design captured now (feat-530)

After successful feat-529 dogfood, deliver the confirmed UX above using the
feat-527 authenticated backend. GitHub OAuth plus the current merged portal-user
allowlist controls admission. Show all consumers; runtime membership controls
management. No environment picker or environment-scoped route is needed. Create directly with a globally unique `^[a-z0-9-]+$` name, read-only
signed-in initial owner, preview and submit. Return the random secret once with
copy/password-manager warning. Only existing owners can Add member from the
predetermined allowlist; members can manage and regenerate. No consumer PR or
Git-backed owner projection exists in this model.

Enforce CSRF/session protections, no-store issuance responses and no analytics or
session replay on secret displays. Warn that rotation immediately invalidates the
old key. Store only the one-way verifier and never offer reveal-again. Reports
remain Jaco/RAGBot-only through the separate narrow tool. Validate eventual UI
page-load performance as well as authorization/concurrency and response-loss cases.

J021 proves an isolated OAuth/session skeleton, not production readiness. Its
pinned evidence and limitations belong to discovery draft #2325. Allowlist
integration, durable sessions, live OAuth registration and Railway deployment are
not proven. All production changes still require separate authorization and the
normal PR-to-main flow. No deployment is authorized by this plan.
