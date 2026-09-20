---
title: "J022 portal allowlist and consumer UI reconciliation"
date: "2026-09-21"
status: complete
module: "apps/rag"
tags: ["rag", "planning", "auth", "portal"]
problem_type: "planning_alignment"
---

# J022 investigation and review

## Scope and outcome

Update existing draft [#2304](https://github.com/JesusFilm/forge/pull/2304)
(canonical plan) and stacked draft [#2325](https://github.com/JesusFilm/forge/pull/2325)
(discovery/evidence). Preserve their branch/base relationship and open draft state.
Only documentation changes: no product code, repository settings, real application
credentials, production/Railway, corpus/data, merge or deployment.

The [canonical plan](2026-09-15-001-feat-rag-consumer-access-usage-plan.md) and
feat-511–515/518 now separate repository portal admission from runtime membership:

- Normal PRs maintain the portal-user allowlist. CI checks handles against Forge
  contributor/read-write access as safely verifiable, explicitly distinguishing
  unavailable evidence from a verified result. Merged allowlist admission applies
  to GitHub OAuth and existing-session actions.
- All admitted users see all consumers. Direct creation requires a globally
  unique lowercase/numeric/dash name, read-only signed-in initial owner, preview
  and submit. The backend creates the record and random secret and displays it
  once with copy/password-manager warning. No consumer-registration PR.
- Only an existing owner can Add member from the predetermined allowlist. Added
  members can manage and regenerate; memberships are runtime database records.
  Preserve minimum one owner, audit, revocation and transaction race protection.
- Hash-only storage, HTTPS, immediate old-secret invalidation, no reveal-again,
  RAGBot first-consumer dogfood, aggregate usage/privacy and separate production
  approval remain. The pre-portal dogfood harness uses the same authenticated
  backend; the full UI still follows dogfood.

Read root/lane/service guidance, relevant credential-storage solution and domain
vocabulary; searched todos with no relevant unresolved consumer finding. Compound
Engineering commands are unavailable: performed scope/plan, edit, self-review and
compound directly, without delegation. Reopened feat-511 during editing and
completed its documentation update; implementation stays not-started. No new IDs
or dependency edges. Historical J014 receipt is explicitly superseded.

## J021 inspection and evidence limits

Inspected the private prototype's pinned README, recursive Git tree and Actions
run through read-only GitHub access; no clone, OAuth credential or live login.
The repository is
[forge-rag-github-auth-prototype](https://github.com/jaco-brink/forge-rag-github-auth-prototype),
commit `1f3f908191cebd54b2fcff93a5b7a23b019c56ce`, with 16 tracked files.
[Run 35303532630](https://github.com/jaco-brink/forge-rag-github-auth-prototype/actions/runs/35303532630)
passed formatting, strict TypeScript, seven tests and build. J021 reports npm
audit with zero vulnerabilities, HTTP smoke passed, fresh clone matched,
Gitleaks scanned three commits with zero secrets, and local prototype removed.
These are J021 results, not tests repeated by J022. Detailed evidence stays in
child #2325; the parent only records the inspection and handoff.

Limits: any GitHub account is accepted until allowlist integration; sessions are
in-memory; GitHub network responses are mocked. OAuth app registration and Railway
deployment remain unverified. This evidence does not close Forge implementation,
consumer authorization, durable-session, live OAuth, database or dogfood proofs.

## Validation and durable lessons

The two authorization stores require separate tests: allowlist CI/publication
cannot enforce runtime last-owner invariants, and consumer membership cannot
bypass removed portal admission. Directory visibility is separate from management
and aggregate-report privileges. Historical receipts must be labelled when policy
changes, rather than read as competing current requirements.

Validation commands and final results are recorded below before delivery.

Parent validation on September 21: Prettier 3.8.1 on all ten changed Markdown
files, `git diff --check`, 33 lane frontmatters/index rows, exact totals (20
complete, 1 in-progress, 12 not-started), scoped global ID uniqueness, reciprocal
consumer dependencies and 49 local links passed. Hidden-lane tests passed 2/2
and the hidden-lane checker passed. Existing unrelated feat-461/435 reverse-edge
mismatch and 18 public-lane frontmatter warnings remain unchanged.

Tools: `/tmp/j007-doc-tools/node_modules/.bin/prettier`, `tsx` (with `NODE_PATH`
pointing at that installation), and `/tmp/j022-validate.cjs` for YAML/index/link/
dependency checks. No dependencies or lockfiles changed. No runtime, production,
live eligibility, OAuth, database, cryptographic or page-performance verification
is claimed by this documentation job.

## Discovery integration and delivery

Canonical update commit: `7b5110e33` on job-local `ops/j022-canonical`, destined
for existing PR #2304 branch `docs/rag-consumer-access-usage-plan`. The child
started at `133035706` and integrates that parent without a force push. Local
branch integration is not a PR merge: both GitHub PRs remain open drafts.

Child-specific changes retain the existing PR structure: discovery evidence,
feat-518 completion, lane README counts, the historical J014 receipt, and this
J022 report. Canonical plan and feat-511–515 are byte-identical to the parent.
The evidence now includes J021's pinned prototype and explicit limitations;
current authorization, schema and readiness sections all use runtime membership.
Historical review-policy investigations remain clearly labelled, not requirements.

Child validation: all changed Markdown, 33 lane frontmatters/index rows and
exact totals (21 complete, 1 in-progress, 11 not-started), scoped global IDs,
reciprocal consumer dependencies and 44 local links passed. Hidden-lane tests
passed 2/2 and checker passed; whitespace and conflict-marker scans passed.
The same unrelated reverse-edge mismatch and 18 public-lane warnings persist.
The interrupted earlier full-format attempt had no completed result and is not
counted as a pass. Final formatting and remote delivery receipts follow below.

No runtime test suite was run for Forge because no product code changed. Prototype
results are attributed to J021 and the inspected Actions run; local smoke,
fresh-clone, Gitleaks and cleanup results come from the supplied J021 receipt.
