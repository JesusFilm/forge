---
title: "Formal RAG consumer access and usage visibility"
type: feat
status: planned
date: 2026-09-15
---

# Formal RAG consumer access and usage visibility

## Scope and delivery contract

Forge owns this programme. A **consumer** is an integration/application with an
accountable owner, never an individual end user. Use one private bearer token
per integration/environment, mapped server-side to a stable consumer ID. Do not
require a client-ID header plus secret. This private credential is distinct from
the public known-caller Consumer Bearer described in `CONCEPTS.md`.

This PR delivers planning only ([feat-511](../roadmap/rag/feat-511-rag-consumer-access-planning.md)).
Before implementation, [feat-518: consumer access discovery](../roadmap/rag/feat-518-rag-consumer-access-discovery.md)
confirms the remaining engineer allowlist/review rules, portal identity approach,
token hashing/rotation design, database permissions/isolation and usage-report
mechanism. This PR adds the discovery scope and sequencing only; discovery
findings must be delivered in a later, separate documentation-only PR. Discovery
must complete before feat-512 starts; usage, dogfood and portal follow in order.
The approved decisions and acceptance criteria below remain unchanged.

Implementation is explicitly split:

1. [feat-512: access lifecycle](../roadmap/rag/feat-512-rag-consumer-access-lifecycle.md).
2. [feat-513: usage collection and read-only reporting](../roadmap/rag/feat-513-rag-consumer-usage-visibility.md),
   dependent on access identity. Access alone cannot close the programme or permit
   shared-token cutoff; both deliverables and their release gates must pass.
3. [feat-514](../roadmap/rag/feat-514-rag-consumer-dogfood-migration.md): actual ops HTTP dogfood and seven-day migration, after usage.
4. [feat-515](../roadmap/rag/feat-515-rag-consumer-self-service-portal.md): internal self-service portal, after successful dogfood. Its design
   is captured here now because Bible lookup expansion will increase demand.

No product implementation, billing, external consumers, source import, corpus
change or production operation is included in this PR. External access requires
its own future rate-limit design. Initial heavy use is visibility and conversation
only: no new quotas, throttling or automated enforcement.

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
  `POST /v1/search` path. Register either Jaco's VM integration or RAGBot as the
  consumer. The task definition is not tracked in this checkout; record its
  approved workspace path/revision before executing feat-514. Seeker's client,
  direct database retrieval or a substitute curl smoke is not that proof.
- `apps/auth/src/auth/config.ts` conditionally configures Google sign-in and emits
  `email_verified`; `apps/chat/src/auth/oauth-client.ts` validates the OIDC token
  and carries a strictly boolean verified-email claim. Recommend Google/Gmail
  through the existing Forge Auth OIDC integration, with a separately registered
  portal client; do not cross-import app code. This is a design recommendation,
  not a claim that a portal client or Google configuration is deployed. GitHub
  login is an alternative requiring separate verified-email integration work;
  a GitHub account in the allowlist is not proof of a verified email session.
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

Jaco approved the repository engineer allowlist, senior-engineer PR approval,
verified-email self-service, multiple managers per consumer, Jaco/RAGBot-only
report access, durable privacy-minimised aggregates, one-time secrets with
hash-only storage, immediate atomic rotation, seven-day registration grace,
actual ops HTTP dogfood, and portal delivery after dogfood. These are settled.

Before implementation activation, name the senior approver accounts/team and
required CI check, approve the exact allowlist path/schema (proposed
`config/rag-consumer-engineers.json`), select the portal host/client registration
and verify the recommended Google/Forge Auth claim flow. Before dogfood, record
consumer choice, source scope, task revision and permitted environment. Before
production cutover, separately approve the communications owner, grace start
and exact cutoff timestamp. No missing detail blocks this documentation update.

## A. Registration, approval and credential lifecycle

Provide an operator-mediated registration workflow and documented intake form
as the dogfood precursor to the portal. Intake fields: integration label, purpose/registration
intent, accountable owner/contact, intended environment, requested source keys,
expected usage band and operational contact. Avoid open-ended sensitive notes.
Normalize bounded fields and validate source keys against the registry.

Proposed metadata types (implementation names may follow package conventions):

- `Consumer`: immutable opaque `consumerId`, label, accountable owner reference,
  purpose, lifecycle state, creation/update times.
- `ConsumerEnvironment`: consumer ID + environment, requested/approved source
  keys, approval actor/time, status (`pending | approved | suspended | revoked`).
- `Credential`: internal random credential record ID, consumer/environment link,
  non-reversible verifier, issued/expiry/revocation times and replacement relation.
  This internal ID is not a token selector and is never a reporting dimension.
- `LifecycleAudit`: bounded action enum, actor reference, consumer/environment,
  timestamp and outcome; no arbitrary payloads or bearer-related identifiers.

The repository allowlist binds engineers' GitHub accounts to verified emails.
Changes require a specific senior-engineer PR approver, enforced by a required
GitHub CI check against the current PR head. Protect the approver configuration
and workflow too; author self-approval, stale/dismissed reviews and non-approved
reviewers must fail. CODEOWNERS alone is not evidence of enforced approval.
Do not create this file or CI infrastructure in this documentation PR.

An allowlisted engineer with a verified identity may register a consumer and
manage its permitted scopes; no second routine registration approval is required.
Source permissions must remain within the engineer's approved entitlement.
Non-allowlisted, unverified or removed engineers fail closed on every management
action, including existing sessions. Separate `ConsumerMembership` records bind
multiple managers to one integration; consumer identity is never an engineer ID.
Existing authorized managers may add only currently allowlisted engineers and
remove managers. Audit actor, target member, consumer, action, outcome, time and
allowlist revision; recheck authorization transactionally, prevent orphaning the
last manager, and require a designated senior engineer for recovery/ownership
transfer. Membership removal blocks management but does not erase usage history;
review/rotate shared integration credentials if the departing manager knew them.
Keep minimal identity references in restricted audit metadata, never usage rows.

Generate cryptographically random high-entropy opaque credentials inside the
approved issuance process, outside agent transcripts. Persist only a one-way
verifier in the restricted auth store; never raw tokens or selectors. Validate
verifiers using an established constant-time mechanism. The bearer travels only
in the Authorization header over TLS, never query strings or client-ID headers.

Exactly one active credential per integration/environment. An authorized
“Generate new key” action generates a new secret, atomically replaces/revokes the
prior verifier and reveals the new secret once in the authenticated issuance
response. No decryptable/revealable tokens are retained in the database. The
engineer must save it in their own password manager/secret storage. There is no
reveal-again, old/new overlap or delayed revocation waiting for installation.
This programme intentionally supersedes the older receiver-first overlap recipe.

Lost secrets or interrupted one-time display require another authorized rotation;
the old secret cannot be recovered. Multiple managers see status/audit only,
never another manager's secret. Warn that rotation interrupts all callers using
the prior key; managers coordinate installation through their own secret storage.
Serialize rotations with credential-version checks: a stale concurrent action
fails and refreshes rather than unknowingly replacing a just-issued key. Test
transaction failure, lost response and concurrency. Never expose secret material
in logs, tickets, PRs, tests, command output, chat or telemetry; use synthetic
non-secret fixtures for tests and suppress issuance-response capture.

Suspension rejects access reversibly; revocation is terminal for a credential.
Consumer revocation rejects all its credentials across environments. Retain
minimal lifecycle history without adding a retention/deletion implementation now, rather than deleting the consumer
or reusing its ID. Restoration from suspension requires approval; a revoked
credential can never be restored by rollback or replacement.

## B. Storage, privileges and HTTP integration

Use separate restricted metadata tables/schema within RAG's bounded database;
do not place credentials in Admin or widen the corpus reader's rights. Separate
principals/capabilities: approval/issuance writer, serving auth reader, narrow
usage writer, report reader over approved aggregate views. Reporter cannot read
verifiers, contacts, corpus, lifecycle free text or mutate anything. Serving
continues to read corpus only; its new write capability is limited to usage
metadata, with an explicit boundary adapter/port and dependency-law tests.

Authenticate server-side to `AuthenticatedConsumer { consumerId, environment,
allowedSourceKeys }`. Environment derives from trusted receiver configuration,
not caller input. Validate current consumer, environment and credential state on
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
`usage:report --consumer <stable-id> --environment <env> --from <UTC> --to <UTC>`)
and a documented report schema, not a public dashboard. Initially only Jaco and
RAGBot may read reports. Give RAGBot a dedicated authenticated, read-only report
capability through a bounded endpoint/ops task with fixed aggregate fields and
validated windows, not a general database credential or arbitrary SQL. The
server-side report role reads aggregate views only. Other allowlisted engineers
and consumer managers gain no report access by virtue of membership. The command is future
work; it does not exist in this PR. Report rows contain only consumer ID, approved
label, environment, `windowStart`, `windowEnd`, `requestCount`,
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
  Totals are grouped by stable consumer ID and environment, unaffected by rotation.
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
records contain only identity, environment and timestamps. Durable aggregate consumer-usage metrics are kept going forward for product-growth
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
or selectors. Register each through the allowlisted registration path. During the seven-day registration/support grace,
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
Real dogfood is a later approved environment operation, not performed by J007 or J008.

1. Apply the approved decisions. Locate the actual `forge-rag-retrieve` task path/revision and
   permitted test environment; absent client access blocks release proof.
2. Register Jaco’s VM integration or RAGBot with an accountable owner
   through ordinary allowlisted registration and one-time issuance. Register a second synthetic
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
   consumer and verify all credentials/environments reject new requests. Check
   suspension/resumption, wrong environment, source isolation and concurrent revoke.
8. Interrupt collector/storage and simulate missing instrumentation, delayed flush,
   crash and unavailable historical coverage. Reports visibly become partial/unavailable, never
   clean zero. Recover and demonstrate gap handling and exact concurrent counts.
9. Verify report principal cannot write, read credentials/contacts or read corpus;
   inspect report schema/log sinks using synthetic sentinel values for leakage.
10. Rehearse shared-token grace/cutoff and rollback. Record only synthetic counts,
    window, coverage, pass/fail, environment label and code revision in release
    evidence; no tokens, selectors, IPs, raw queries, corpus or production evidence.

Future code verification: `pnpm --filter @forge/rag test`, `typecheck`, `lint`,
`depcruise`, isolated `db:verify` plus new role/integration tests; run contract
tests/drift if contracts change. Measure added auth/telemetry latency and concurrency
against an agreed pre-change synthetic baseline; set the acceptance budget before
release. No live retrieval or runtime test is claimed by this documentation PR.

## F. Portal design captured now (feat-515)

After successful feat-514 dogfood, build an internal portal for verified,
allowlisted engineers: register integrations, list only managed consumers,
manage membership and approved scopes, inspect credential status, and Generate
new key with one-time display. Enforce authorization server-side on every read
and mutation, CSRF/session protections, no-store issuance responses and no
analytics/session replay on secret displays. Report access remains Jaco/RAGBot
only. Show the affected integration/environment and immediate replacement
consequence before rotation. Never offer token retrieval or reveal-again.

Before coding, refine the host/Forge Auth client design, restricted management
API boundary, senior recovery workflow and claim/allowlist synchronization.
Acceptance includes verified/unverified and removed-member sessions, cross-
consumer denial, concurrent membership/rotation, one-time response loss and
no secret leakage. Validate page-load performance for the eventual UI. No
external registration, billing or rate-limit design is included.
