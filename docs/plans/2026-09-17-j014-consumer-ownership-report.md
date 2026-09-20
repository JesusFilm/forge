---
title: "J014 accepted RAG consumer ownership and CI model"
date: "2026-09-17"
status: complete
module: "apps/rag"
tags: ["rag", "planning", "auth", "consumer-ownership"]
problem_type: "planning_alignment"
---

> Historical receipt: J022 supersedes earlier authorization/registration choices.
> Follow the [canonical plan](2026-09-15-001-feat-rag-consumer-access-usage-plan.md)
> for PR-maintained portal admission and direct creation/runtime membership.

# J014 investigation and review

## Outcome and documentation boundaries

The accepted policy is recorded in the existing programme plan,
[2026-09-15-001-feat-rag-consumer-access-usage-plan.md](2026-09-15-001-feat-rag-consumer-access-usage-plan.md),
in draft [PR #2304](https://github.com/JesusFilm/forge/pull/2304), branch
`docs/rag-consumer-access-usage-plan`. It is the canonical decision record.
Separate draft [PR #2325](https://github.com/JesusFilm/forge/pull/2325), branch
`docs/rag-consumer-access-discovery`, owns discovery evidence and its completed
feat-518 handoff. It remains stacked on the planning branch. Do not copy the
whole discovery report into the parent or create another programme/ticket.

Inspected remote heads before edits: parent `e5b22f7235385ee67d0e9aeda54916b8394408e3`,
discovery `81009793a3caedbd154f9a206c5ca33fd805b1b3`; both open drafts. This job
works only in J014, using job-local branches and explicit fast-forward push targets
because the named PR branches are checked out in other sessions. No other
worktree is reset, pulled or modified. Parent updates flow into the discovery
branch; discovery evidence is never merged back into the parent.

Read root, RAG lane, RAG service and contracts guidance, relevant domain vocabulary,
credential-storage and RAG architecture solutions, the programme records and
both PR bodies. No relevant unresolved consumer task was found in `todos/`.
Compound Engineering commands are unavailable; performed plan/work/review/compound
locally without delegation or model substitution. Reopened feat-511 while editing
and completed its documentation update; implementation feat-512–515 remain
not-started. The existing dependency chain needs no new IDs or edges.

## Decisions and review findings

- Any engineer with Forge repository read/write access may register via a normal
  consumer-registration PR. There is no special consumer approver, senior roster
  or additional non-author approval evaluator. Normal repository merge rules remain.
- Each consumer has a nonempty GitHub-handle `owners` list. GitHub establishes
  identity; current merged ownership grants management and regeneration. A
  non-owner must add their handle by PR and wait for normal merge. Portal edits,
  repository access, organisation membership and reviewing a PR confer no bypass.
- CI's consumer-specific task validates owners and membership, not reviewer
  eligibility. Structural checks can prove nonempty lists and valid syntax.
  Live organisation membership is explicitly unverified here. Public membership
  absence and account existence are insufficient substitutes; no new permissions,
  credential inspection, membership API calls or settings changes were performed.
  The [GitHub membership API documentation](https://docs.github.com/en/rest/orgs/members#check-organization-membership-for-a-user)
  was read to establish that distinction. Actual safe lookup capability and
  unverified-result handling belong to feat-512 before activation.
- Removed the global account/verified-email allowlist and mutable manager grants
  from current requirements. Stable numeric account binding and trusted merged
  revision publication are proposed implementation safeguards, not deployed facts.
  Stale/removed-owner sessions, handle reassignment, last-owner loss and concurrent
  owner changes/rotation have explicit future acceptance criteria.
- Keys never enter git or PRs. Portal generation displays once, stores only a
  secure verifier and atomically invalidates the prior key. Restricted audit
  records identify actor, consumer/environment, bounded action/outcome, time,
  merged PR/SHA and credential version without sensitive payloads.
- RAGBot registers as a retrieval consumer first. A later separate narrow internal
  tool exposes aggregate usage to Jaco/RAGBot only. No raw query, IP, token,
  verifier or corpus telemetry; exact counts, coverage gaps, isolation, revocation
  and actual ops HTTP proof remain required.
- Earlier J007/J008 reports remain historical, with adjacent supersession notes.
  Discovery's prior review-enforcement investigation is historical evidence, not
  an outstanding requirement. Keep runtime runbooks and `/v1` contracts untouched
  because this job changes no implemented behavior.

## Remaining implementation work

No unresolved product decision blocks this documentation delivery. Future work
must select registry path/schema, safe membership-check capability and coverage,
GitHub account binding, revision publication/freshness, portal host/client and
provisioning, restricted database roles and the narrow report transport. Those
are not implemented or proven by this job. Existing embedding topology/cost,
deployed identity/provider settings and production configuration remain unverified.

Actual `forge-rag-retrieve` task path/revision, RAGBot consumer ID, source scope,
permitted environment and runtime proof are still required for feat-514. The
seven-day migration and production cutoff require separate authorization. No
production/Railway access, credential handling, settings edits, product code,
corpus/data change, merge or deployment is part of J014.

## Validation and delivery

Parent branch checks passed on September 17:

- Changed Markdown Prettier 3.8.1 and `git diff --check`.
- All 33 RAG frontmatters and index rows; totals 20 complete, 1 in-progress,
  12 not-started, 0 blocked. All consumer dependencies are reciprocal; 54 local
  Markdown links resolve, including the new report.
- Hidden-lane tests: 2/2; hidden-lane checker passes. Its 18 existing public-lane
  missing-frontmatter warnings remain outside scope.
- Whole-lane dependency scan retains the existing `feat-461.blocks: feat-435`
  missing reverse edge; no consumer edge fails. No unrelated repair was made.
- Full-repository Prettier check; final receipt edits get a targeted recheck.

Used existing `/tmp/j007-doc-tools` tooling without dependency/lockfile edits.
The supplied worktree has no `.husky/_`; no hook was bypassed and checks ran
explicitly. The local Node version is 22.22.1; CI uses `.nvmrc` Node 24.
Self-review swept current plan/tickets for senior, approver, allowlist, manager,
verified-email and Google wording and classified remaining historical references.

Only documentation is changed. Runtime, crypto, database, portal login, live
membership, retrieval and deployment tests are not claimed.
