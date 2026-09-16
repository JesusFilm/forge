---
id: "feat-518"
title: "Confirm RAG consumer access implementation readiness"
owner: "jaco"
priority: "P1"
status: "blocked"
start_date: "2026-09-16"
duration: 2
depends_on: ["feat-511"]
blocks: ["feat-512"]
tags: ["rag", "planning", "auth", "observability"]
---

## Problem

The approved consumer access programme still needs concrete technical and review
arrangements before implementation. Planning completion does not establish those
arrangements. This discovery gate precedes access, usage, dogfood and portal work.

## Entry Points — Read These First

1. [Programme plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) — approved decisions and sections A–F.
2. `docs/roadmap/rag/CLAUDE.md` and `apps/rag/AGENTS.md` — lane and service boundaries.
3. `.github/workflows/` — existing review checks; `config/rag-consumer-engineers.json` is a proposed path, not an existing allowlist.
4. `apps/auth/src/auth/config.ts` and `apps/chat/src/auth/oauth-client.ts` — reference patterns only; the approved portal uses GitHub account/verified-email authentication, not the earlier Google recommendation. See the evidence for provider endpoints; no cross-app imports.
5. `apps/rag/src/serving/http/auth.ts`, `app.ts` and `apps/rag/scripts/serve.ts` — authentication, request counting and composition.
6. `apps/rag/prisma/schema.prisma`, `apps/rag/src/adapters/postgres/index.ts` and `apps/rag/docs/ops/environment-and-secrets.md` — metadata/corpus isolation and existing operations.

## Grep These

`TokenRegistry`, `lookupScope`, `SERVE_BEARER_TOKENS`, `githubUserId`,
`ConsumerMembership`, `usage:report`, `coverageStatus`, `completeThrough`.

## What To Build

Deliver findings in a later, separate documentation-only PR, with repository
path/revision evidence, confirmed decisions, unresolved blockers and an
implementation handoff for each of these five areas:

1. Confirm the engineer allowlist path/schema and GitHub-to-verified-email mapping,
   senior approver accounts/team, exact required review/CI checks and protection
   of their configuration. Specify current-head enforcement and rejection of
   self-approval, stale/dismissed reviews and unauthorized reviewers.
2. Confirm the portal login/identity approach, host/client registration design,
   verified-email claim validation, session removal behavior and management API
   boundary. Document the September 17 discovery choice of GitHub authentication
   with same-entry account/verified-email allowlist matching. Existing Forge Auth
   and Chat patterns are references, not a deployed GitHub provider claim.
3. Confirm the token hashing/verifier lookup and constant-time verification design,
   hash-only storage, one-time display and immediate atomic rotation. Specify
   concurrency/version checks, transaction failure, lost-response recovery and
   revocation behavior without generating or handling credentials.
4. Confirm the database permissions/isolation design: approval/issuance writer,
   serving auth reader, narrow usage writer and aggregate-only report reader.
   Document the privilege matrix, metadata/corpus boundary and proposed isolated
   role tests; no corpus write or report access to verifiers/contacts is permitted.
5. Confirm the usage-report mechanism and bounded command/endpoint/ops-task
   contract for Jaco and RAGBot only. Resolve authentication/authorization design,
   fixed report fields and window validation, exact count/completion accounting,
   durable aggregates and coverage/watermark failure handling against plan C/E.

Carry the approved decisions and all existing acceptance criteria forward
unchanged. Mark this ticket complete only when the separate discovery PR records
these confirmations and resolves pre-implementation blockers; link that PR in a
Resolution section and update the lane index. Do not complete it merely because
PR #2304 adds this ticket.

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

## Discovery evidence (J011)

[Implementation handoff and investigation report](evidence/feat-518/consumer-access-discovery.md)
records repository/revision evidence, read-only GitHub protection observations,
proposed allowlist/review and identity contracts, token lifecycle, schema/role
matrix, exact usage accounting and bounded report access. Findings are delivered in
[draft PR #2325](https://github.com/JesusFilm/forge/pull/2325) on `docs/rag-consumer-access-discovery`, stacked on PR #2304 head
`e5b22f7235385ee67d0e9aeda54916b8394408e3`; the parent PR is unchanged.

## September 17 owner decisions and remaining dependency

Senior approvers are Jaco Brink (`jaco-brink`, GitHub ID `219753371`), Tatai
(`tataihono`, `802117`) and Jian Wei (`jianwei1`, `17999235`). **Jaco alone** is
the recovery authority; the others are not recovery delegates. Public account
lookups verified the IDs without inferring any private email binding.

The portal uses GitHub authentication with an allowlisted account and verified
email in the same registry entry, plus multiple authorized managers per consumer.
RAGBot is registered as a consumer first, then receives aggregate usage summaries
through a narrow internal read-only tool. Jaco and RAGBot alone may view request
counts/activity; reports never mean query results. Transport/provisioning owner
and portal host registration are documented implementation handoffs, not renewed
product-choice questions or production permission.

**Only G1 enforcement verification remains blocked.** The approved mechanism is
protected GitHub PR review plus repository CI. Rechecked exact names: ruleset
`Main` (`12972651`), workflow `forge-ci`, aggregate check `ci-gate`. The ruleset
still requires zero approvals and returns no required-check rule; CI contains
no named-senior approval evaluator. The earlier hypothetical RAG check names are
withdrawn. Jaco/repository admin must identify the intended effective rule/check
or explicitly accept implementing the missing control under feat-512 before this
discovery gate closes. No repository protection was changed.

The report's G2/G3 choices and G1 senior/recovery roster are settled. feat-512–515
remain not-started, and no runtime/production readiness is claimed. Record the
remaining control evidence/correction and a Resolution linked to discovery PR
#2325 before completing feat-518; do not repeat already-answered decisions.
