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

This PR delivers planning only ([feat-501](../roadmap/rag/feat-501-rag-consumer-access-planning.md)).
Implementation is explicitly split:

1. [feat-502: access lifecycle](../roadmap/rag/feat-502-rag-consumer-access-lifecycle.md).
2. [feat-503: usage collection, read-only reporting and RAGBot proof](../roadmap/rag/feat-503-rag-consumer-usage-visibility.md),
   dependent on access identity. Access alone cannot close the programme or permit
   shared-token cutoff; both deliverables and their release gates must pass.

No portal, billing system, end-user tracking, source import, corpus change,
production operation, or consumer generation policy is included. A portal is a
future decision, not a V1 prerequisite.

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
- `apps/mastra/src/services/jesusfilm-rag-client.ts` is Seeker's client, **not**
  proof of the RAGBot client. No RAGBot client was found in Forge. Locate the
  actual client in the approved RAGBot workspace before implementation; record
  its exact path/revision then. Do not substitute Seeker, curl, or a fake client.
- `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
  provides storage tradeoffs. Its example handoff channel is not an approval
  for this programme. No applicable unresolved finding exists in `todos/`.

Useful search: `rg -n 'TokenRegistry|lookupScope|resolveScope|SERVE_BEARER_TOKENS|createApp' apps/rag`.

## Pending Jaco decisions (release gates, not invented defaults)

| Decision                                                               | Required before                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Named approver and permitted delegate; ownership transfer authority    | Enabling registration approvals                                            |
| Secure one-time credential delivery channel and recipient verification | Any credential issuance/handoff                                            |
| Retention duration, reporting viewers, owner-metadata access           | Persisting real metadata or usage                                          |
| Shared-token grace duration, cutoff timestamp and communications owner | Enabling migration grace or cutoff                                         |
| Heavy-usage warning versus enforcement, thresholds and authority       | Activating warnings/limits; V1 measurement grants no enforcement authority |
| Labelled dogfood integration owner, source scope and environment       | Real RAGBot dogfood exercise                                               |
| Whether a self-service portal is needed later                          | Any portal follow-up scope                                                 |

Ticket owner `jaco`, P1 priority, start date and duration are planning bookkeeping,
not appointment of an approver or an agreed delivery schedule. Durations below
are estimates. These unresolved decisions do not prevent merging the plan.

## A. Registration, approval and credential lifecycle

Provide an operator-mediated registration workflow and documented intake form
before considering UI. Intake fields: integration label, purpose/registration
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

Reject self-approval unless Jaco explicitly authorizes that policy. Pending or
rejected registration cannot issue credentials. Ownership changes require the
approved authority, audit trail and revalidation of the operational contact;
never silently transfer credentials with a label edit.

Generate cryptographically random high-entropy opaque credentials inside the
approved issuance process, outside agent transcripts. Persist only a one-way
verifier in the restricted auth store; never raw tokens or selectors. Validate
verifiers using an established constant-time mechanism. The bearer travels only
in the Authorization header over TLS, never query strings or client-ID headers.

One active credential per integration/environment is the normal invariant.
Receiver-first rotation may temporarily allow a documented, bounded old/new
pair linked to the same consumer ID. Secure handoff is one-time and recipient-
verified through Jaco's selected channel; never print into shell output, tickets,
PRs or chat. Failed/expired handoff revokes the unused credential and creates a
replacement; there is no reveal-again operation. Confirm caller installation
before revoking the old credential. Test interrupted issuance, handoff failure,
concurrent rotations and duplicate approvals without orphaned active tokens.

Suspension rejects access reversibly; revocation is terminal for a credential.
Consumer revocation rejects all its credentials across environments. Retain
minimal lifecycle history according to policy rather than deleting the consumer
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
and a documented report schema, not a public dashboard. The command is future
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
records contain only identity, environment and timestamps. Retention/purge must
cover pending records, aggregates, audits and backups under the selected policy.
Do not sample counts. Test atomic increments and idempotent completion under
concurrency, retry, process crash and rotation.

Telemetry failure must not masquerade as zero: report independent collector
heartbeat/watermark and unresolved pending intervals; window coverage is complete
only after all participating instances have reconciled and flushed it. Preserve
gaps durably after recovery. If a write fails, bounded retrieval may continue,
but the report must mark the affected interval partial/unavailable; if the gap
cannot be durably recorded, stale heartbeat/watermark must force unavailable.
Never return a clean zero on DB failure, expired retention, delayed flush,
missing deployment instrumentation or unknown consumer. Unknown consumer is a
report error; zero is only an existing consumer in a fully covered retained window.
A report exits nonzero on unavailable coverage and visibly marks partial coverage.

## D. Shared-token migration and rollback

Inventory integrations by accountable owner without recording credential values
or selectors. Register each through normal approval. During approved grace,
legacy auth remains an explicit separate mode labelled `legacy-unattributed`;
a shared token cannot provide honest per-integration usage. Never infer identity
from IP, user-agent or a supplied client-ID header. Registered-credential lookup
failure cannot fall through into legacy authorization.

Before cutoff: both tickets pass, every owner confirms migration, RAGBot proof
passes, reporting coverage is complete, and Jaco signs the exact grace/cutoff.
Retire the shared-token compatibility configuration and verify rejection. No
cutoff date is implied by this plan. Warnings or quotas require the separate
heavy-usage decision; counters alone are not quotas or billing.

Use additive schema rollout and normal PR-to-main deployments only. Roll back
reporting independently while marking coverage unavailable. Auth rollback must
preserve current deny state and cannot revive revoked credentials or automatically
reenable shared tokens; prefer disabling retrieval to restoring unauthorized
access. Rehearse rollback with synthetic metadata before rollout. No destructive
schema rollback or corpus write is needed. Define operator ownership and recovery
steps for auth DB failure, telemetry loss, failed handoff and partial cutover.

## E. Acceptance and release verification

Implementation tests use isolated local/CI databases and synthetic fixtures.
Real dogfood is a later approved environment operation, not performed by J007.

1. Record Jaco decisions. Locate actual RAGBot HTTP client path/revision and
   permitted test environment; absent client access blocks release proof.
2. Register `RAGBot dogfood — <approved environment>` with an accountable owner
   through ordinary intake/approval/handoff. Register a second synthetic
   integration for isolation. No privileged bypass or special auth path.
3. Establish a retained, fully covered UTC report window and obtain a baseline
   using the report reader. Existing unused integration reports 0/0/null.
4. Through the **actual RAGBot client and real `POST /v1/search` endpoint**, send
   three known synthetic successful requests. Disable retries or record actual
   HTTP attempts. Suppress bodies/headers in all captured output. Wait for the
   watermark to cover them: report deltas must be requests +3, successes +3,
   last activity inside the stated window.
5. Send two more: deltas become +5/+5. Send one request with the second integration:
   its delta is +1/+1 and RAGBot stays +5/+5. Repeat the same read-only report and
   assert stable output for the closed window, excluding generation time.
6. Test a post-auth invalid request and retrieval failure: request count rises,
   successful count does not. Verify empty 200, disconnect and retry semantics.
7. Revoke the RAGBot credential, then issue new requests: 401, no success increment.
   Issue its approved replacement and verify identity continuity; revoke the
   consumer and verify all credentials/environments reject new requests. Check
   suspension/resumption, wrong environment, source isolation and concurrent revoke.
8. Interrupt collector/storage and simulate missing instrumentation, delayed flush,
   crash and expired retention. Reports visibly become partial/unavailable, never
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
