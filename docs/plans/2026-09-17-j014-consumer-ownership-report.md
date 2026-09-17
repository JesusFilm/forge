---
title: "J014 accepted RAG consumer ownership and CI model"
date: "2026-09-17"
status: complete
module: "apps/rag"
tags: ["rag", "planning", "auth", "consumer-ownership"]
problem_type: "planning_alignment"
---

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

## Discovery reconciliation and delivery receipt

Parent update `2bd42b5f0` was pushed to the existing planning branch and PR #2304
body now describes the accepted model. Discovery updates are prepared on
`ops/j014-discovery` from `81009793a`, with the parent integrated locally; no
GitHub PR was merged and no history rewrite is needed. Both PRs remain drafts.

The discovery evidence keeps the J011 settings/primitive investigation and test
receipts explicitly historical. Its active owner/identity handoff now matches
the canonical plan; the obsolete approval evaluator, global account/email schema
and portal membership grants are retired. Technical credential/role/counting
findings remain proposals and observations at their cited revisions. feat-518
remains complete as documentation, with 512–515 not-started.

Child-specific files are this report, `docs/roadmap/rag/README.md`,
`docs/roadmap/rag/feat-518-rag-consumer-access-discovery.md` and
`docs/roadmap/rag/evidence/feat-518/consumer-access-discovery.md`. feat-512/515
now inherit the parent handoffs without conflicting child overrides. Relative
to the previous discovery head, the child also carries all 11 parent documents.
No new ticket or dependency edge is introduced.

Discovery scoped checks passed:

- Changed Markdown Prettier 3.8.1, whitespace and conflict-marker sweep.
- All 33 lane frontmatters/index rows; 21 complete, 1 in-progress,
  11 not-started, 0 blocked. Consumer dependencies remain reciprocal.
- 41 relative links in the four child-specific documents; 59 across all
  12 documents changed from the previous discovery head.
- Hidden-lane tests 2/2 and checker pass, with the same 18 pre-existing warnings.
  The unrelated feat-461/435 mismatch was confirmed in the original parent.

Full-repository Prettier 3.8.1 passed on the discovery branch; final receipt
edits passed a targeted recheck. Remote CI is asynchronous and is not represented by
these local results. Parent commit-lint, formatting and hidden-roadmap checks passed after push;
broader CI was still running. Final pushed SHA,
remote draft state and current CI observation are returned in the job result.

## Remote receipt and unrelated CI failure

Verified parent `2bd42b5f0df91372eaecc79b707639bfbfe3999a` and discovery
`130450e530c8afb12ebf18587e2b001496e42a84` are pushed to their existing branches.
Both PRs are OPEN and draft; #2325 still targets the planning branch. Its diff
against that parent contains only the four child-specific documents above.
J014's combined change from the old discovery head is 12 Markdown files only.
The final receipt commit updates this report without changing policy or scope.

Parent remote `format`, `commit-lint` and `hidden-roadmap-lanes` passed. The
[admin-schema-drift job](https://github.com/JesusFilm/forge/actions/runs/35168167799/job/105034023280)
failed in recommendation database tests: `recommendation_request_expiry_check`
violations followed by aborted transactions (4 test files / 25 tests failed).
This is outside the changed documentation; no admin/schema/workflow code is in
either J014 update. No root-cause fix or runtime rerun is claimed. Product-code
repair would exceed the explicit documentation-only brief. The broader CI run
is therefore not green, even though the required local documentation checks and
parent remote documentation checks passed. Discovery remote CI was queued/running
at this observation; current status is returned separately in the final job result.

No documentation delivery blocker remains. The unrelated CI failure must be
resolved before anyone treats the programme PR as fully validated for merge;
this job does not authorize or perform that merge.
