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

The consumer access programme needed a separate RAG discovery handoff before
implementation: registry/review policy, portal identity, credential lifecycle,
database isolation and aggregate usage. Planning completion was not that proof.

## Entry Points — Read These First

1. [Discovery evidence and final decisions](evidence/feat-518/consumer-access-discovery.md) — all five implementation handoffs and option-B enforcement disposition.
2. [Programme plan](../../plans/2026-09-15-001-feat-rag-consumer-access-usage-plan.md) — original scope; later explicit review/identity decisions in the evidence take precedence.
3. `.github/workflows/ci.yml` — actual `forge-ci` / `ci-gate`; no existing registry review evaluator.
4. `apps/rag/src/serving/http/auth.ts`, `app.ts`, `scripts/serve.ts` — auth, attribution and response-completion boundary.
5. `apps/rag/prisma/schema.prisma`, `scripts/provision-readonly.ts` — restricted metadata schemas needed because corpus-reader defaults grant public-table reads.
6. `apps/auth/src/auth/config.ts`, `apps/chat/src/auth/oauth-client.ts` — reference patterns only; selected portal is GitHub account plus verified-email authentication.

## Grep These

`githubUserId`, `required_reviewers`, `file_patterns`, `ci-gate`, `TokenRegistry`,
`ConsumerMembership`, `usage:report`, `coverageStatus`, `completeThrough`.

## What To Build

Documentation-only discovery is delivered. Latest accepted review policy: one
valid approval by anyone other than the PR author, only for consumer-registry/
allowlist-area changes. It is not senior-only and must not affect other RAG or
Forge PRs. Exact proposed paths are `config/rag-consumer-engineers.json` and
`config/rag-consumer-engineers.schema.json`; handle deletions/renames explicitly.

Investigated native branch reviews, path-specific team reviewers, CODEOWNERS,
push restrictions and conditional CI. **Option B selected:** current mechanisms
do not establish reliable enforcement of the exact policy. Native path-specific
team/owner requirements narrow who may approve; a whole-branch minimum broadens
scope; current CI lacks a trustworthy conditional evaluator. This is not a claim
that a future custom mechanism is impossible. The user explicitly authorized
carrying this gap into later implementation rather than broadening approvals.

[feat-512](feat-512-rag-consumer-access-lifecycle.md) owns that gap and the report's
scope/review-state/trust/merge-race acceptance tests. It remains not-started.
Portal uses GitHub authentication with the account and a verified email matching
the same allowlist entry; several engineers may manage one integration. Jaco
alone recovers. Register RAGBot as a consumer first, then provide Jaco/RAGBot
aggregate request counts/activity through a narrow internal read-only tool.
Token rotation, restricted metadata roles and coverage-versus-zero-use handoffs
are recorded with the unchanged programme acceptance criteria.

## Constraints

No product implementation, settings change, credentials, production/Railway,
corpus/data, deployment or merge. No claim that approval enforcement is configured.
No new global minimum reviews, team-only approval, latest-pusher restriction or
broad path glob. Reports are aggregate usage, never query results. Seven-day
migration/cutoff still needs separate production approval; portal follows actual
`forge-rag-retrieve` dogfood. External consumers/rate limits and retention-policy
implementation remain future/outside scope. PR #2304 is not modified.

## Verification

Check the five-area evidence and exact option-B handoff. Validate Markdown,
frontmatter, relative links, reciprocal dependencies, lane index/counts and
`git diff --check`. Run `pnpm exec tsx --test scripts/check-hidden-roadmap-lanes.test.ts`
and `pnpm exec tsx scripts/check-hidden-roadmap-lanes.ts`.
Sequence remains feat-511 → feat-518 → feat-512 → feat-513 → feat-514 → feat-515.
Local/CI documentation checks are distinct from future implementation tests.

## Resolution

Delivered in separate [draft PR #2325](https://github.com/JesusFilm/forge/pull/2325),
branch `docs/rag-consumer-access-discovery`, stacked on PR #2304 head
`e5b22f7235385ee67d0e9aeda54916b8394408e3`. The parent is unchanged.

All discovery decisions are resolved, including the user's authorized **option B**
for narrow approval enforcement. The gap is preserved in feat-512, not erased or
claimed operational. Exact observed names remain ruleset `Main` (`12972651`),
workflow `forge-ci`, aggregate `ci-gate`; effective rules return zero approvals
and no required-status-check rule. No new check name is invented. Completing
this ticket closes documentation discovery only; feat-512–515 remain not-started.
