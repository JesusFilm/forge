---
id: "feat-518"
title: "Confirm RAG consumer access implementation readiness"
owner: "jaco"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 2
depends_on: ["feat-511"]
blocks: ["feat-512"]
tags: ["rag", "planning", "auth", "observability"]
---

## Problem

The approved consumer access programme still needs concrete technical
arrangements before implementation. Planning completion does not establish those
arrangements. This discovery gate precedes access, usage, dogfood and portal work.

## Entry Points — Read These First

1. [Programme plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) — approved decisions and sections A–F.
2. `docs/roadmap/rag/CLAUDE.md` and `apps/rag/AGENTS.md` — lane and service boundaries.
3. `.github/workflows/` — existing CI; portal-user allowlist path/schema and eligibility validation are future implementation details.
4. `apps/auth/src/auth/config.ts` and `apps/chat/src/auth/oauth-client.ts` — reference session flows, not a deployed GitHub portal; no cross-app imports.
5. `apps/rag/src/serving/http/auth.ts`, `app.ts` and `apps/rag/scripts/serve.ts` — authentication, request counting and composition.
6. `apps/rag/prisma/schema.prisma`, `apps/rag/src/adapters/postgres/index.ts` and `apps/rag/docs/ops/environment-and-secrets.md` — metadata/corpus isolation and existing operations.

## Grep These

`TokenRegistry`, `lookupScope`, `SERVE_BEARER_TOKENS`, `owners`,
`ConsumerOwner`, `usage:report`, `coverageStatus`, `completeThrough`.

## What To Build

The [discovery evidence](evidence/feat-518/consumer-access-discovery.md) records
J022 alignment and J021 prototype evidence with implementation handoffs for
these five areas:

1. Specify the repository portal-user allowlist, normal PR changes and narrow CI
   validation of contributor/read-write eligibility as safely verifiable. Record
   exact coverage and unverified results; no special reviewer or added gate.
2. Confirm GitHub OAuth admission from the merged allowlist and independent
   runtime consumer ownership. Specify direct creation with globally unique
   lowercase/numeric/dash names, read-only initial owner, preview/submit and
   immediate one-time secret display. Only existing owners may Add member from
   the predetermined allowlist; members manage/regenerate, with last-owner
   protection and audit. Record publication, stable identity and session removal
   behavior. Inspect pinned J021 evidence and limits without live OAuth/deployment.
3. Confirm the token hashing/verifier lookup and constant-time verification design,
   hash-only storage, one-time display and immediate atomic rotation. Specify
   concurrency/version checks, transaction failure, lost-response recovery and
   revocation behavior without generating or handling credentials.
4. Confirm the database permissions/isolation design: registry/issuance writer,
   serving auth reader, narrow usage writer and aggregate-only report reader.
   Document the privilege matrix, metadata/corpus boundary and proposed isolated
   role tests; no corpus write or report access to verifiers/contacts is permitted.
5. Confirm the usage-report mechanism and bounded command/endpoint/ops-task
   contract for Jaco and RAGBot only. Resolve authentication/authorization design,
   fixed report fields and window validation, exact count/completion accounting,
   durable aggregates and coverage/watermark failure handling against plan C/E.

Documentation discovery is complete. The evidence separates accepted decisions,
proposed technical mechanisms and unverified runtime/provider/deployment work.
Implementation feat-512–515 remains not-started.

## Constraints

This ticket's creation in [PR #2304](https://github.com/JesusFilm/forge/pull/2304)
is scope and sequencing only, with no new discovery findings in that PR.
Discovery is documentation only: no product code, credential handling,
production/Railway access, deployment, merge or corpus/data changes. If evidence
requires unavailable access or an unapproved decision, record the dependency
without claiming confirmation. No implementation starts before this gate closes.
Preserve seven-day migration, actual ops HTTP dogfood, portal-after-dogfood,
Jaco/RAGBot-only reporting and visibility-and-conversation usage policy.

## Verification

Review all five areas against the programme's approved decisions and acceptance
criteria; distinguish confirmed repository evidence from proposed configuration.
Verify that the later findings PR is documentation only and links this ticket.
Run changed-Markdown Prettier checks, relative-link/frontmatter validation,
reciprocal dependency and lane index/count checks, then
`pnpm exec tsx --test scripts/check-hidden-roadmap-lanes.test.ts` and
`pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`.
Confirm sequence: feat-511 → feat-518 → feat-512 → feat-513 → feat-514 → feat-515.

## Resolution

Delivered in separate [draft PR #2325](https://github.com/JesusFilm/forge/pull/2325),
stacked on canonical planning draft #2304. J022 reconciles the portal-user
allowlist, direct consumer creation and runtime owner-only member management.
J021's pinned prototype/run, 16 files, seven tests, audit/smoke/clone/secret-scan
results and cleanup are recorded with their evidence provenance and limitations.
Allowlist integration, durable sessions, real OAuth app registration and Railway
deployment remain unverified; no new workflow or product capability is claimed.
