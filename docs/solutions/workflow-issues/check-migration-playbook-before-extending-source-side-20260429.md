---
title: "Check the migration playbook before extending source-side capability that's destined for the destination"
category: "workflow-issues"
problem_type: "workflow_issue"
component: "development_workflow"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
severity: "high"
module: "compound-engineering"
tags:
  - workflow
  - migration-playbook
  - ce-plan
  - architecture
  - duplication-cost
  - feat-109
  - admin-migration
  - duplication-signal
  - predecessor-plan-inheritance
date: "2026-04-29"
last_updated: "2026-04-29"
related_prs:
  - "JesusFilm/forge#852" # feat-109 keyword-first shipped to cms (the miss)
  - "JesusFilm/forge#849" # predecessor cms-first plan whose framing was inherited
  - "JesusFilm/forge#837" # R4 admin hybrid search — should have been the target
  - "JesusFilm/forge#818" # R1 scene embeddings — admin migration playbook anchor
related_docs:
  - "docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md"
  - "docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md"
  - "docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md"
  - "docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md"
  - "docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md"
  - "docs/solutions/design-patterns/branched-orchestrator-opt-in-mode-pattern-20260429.md"
---

## Problem

When an active migration playbook is in flight (cms → admin in this
repo), and a request comes in to extend functionality that's
mid-migration, the right question is **"which side of the migration
does this work belong on?"** — not "which side has data today?" We
asked the second question, got "cms has data," and shipped the wrong
side. Six commits, six solution docs, and a merged PR later, all of
it has to be ported.

## Symptoms

- Predecessor plan (PR #849) said "ships to cms first; admin R4 port
  is a mechanical follow-up once Core-sync data-model reshape lands."
  The new plan inherited that sentence verbatim and never challenged
  it — there was no "Inherited assumptions to challenge" section in
  the new plan because that section did not exist.
- **Cross-app create/reference split in the plan itself.** The plan's
  "Files to create" list targeted `apps/cms/src/api/search/...` while
  the plan's "Pattern reference" / "Byte-parity invariant source"
  list cited `apps/admin/src/services/hybrid-search-sql.ts`. Whenever
  a plan creates files in `apps/X/` and references patterns in
  `apps/Y/` (X ≠ Y), that's a duplication tell — a mechanical lint a
  reviewer (or `ce:review`) can run on the plan markdown without
  domain knowledge.
- The `apps/admin/src/services/hybrid-search-sql.ts` (R4 byte-parity
  reference, shipped 2026-04-23 in PR #837) was copied **into cms** as
  the canonical pattern source for the GIN byte-parity invariant.
- The `/ce:plan` repo-grounding scan reported file paths, retriever
  conventions, naming collisions — but didn't reach for
  `docs/brainstorms/*-playbook-*.md` or
  `docs/brainstorms/*migration-playbook*.md`.
- `MEMORY.md` had `project_admin_migration_status.md` loaded, with R4
  shipping explicitly noted (auto memory [claude]), and the agent read
  past it.
- Reviewer: "If R4 hybrid search already shipped to admin, why didn't
  we build on top of that?"

## What Didn't Work

- **Inheriting the predecessor plan's framing without challenge.** PR
  #849's "while we wait" justification ("admin's prod tables have 0
  rows, so build on cms first") sounded reasonable in isolation. It's
  a prod-data problem, not a code-location problem — admin has the
  schema, the dev/staging fixtures, the R4 code; empty prod tables
  don't block development.
- **`/ce:plan`'s default research checks.** Local research covered
  files, conventions, recent changes. It did NOT include "is there a
  migration playbook that already says where new work belongs?"
- **Treating the destination's pattern as a _reference_ instead of a
  _target_.** When you're copying admin's pattern into cms, that's a
  duplication signal: the work probably belongs on admin.

## Solution

Add a **migration-playbook check** as a default first-step in
`/ce:plan` (and any other planning workflow) when the repo has an
active migration in flight:

1. **Discover playbooks.** Glob `docs/brainstorms/**/*-playbook-*.md`
   and `docs/brainstorms/**/*-migration-*.md`. If results exist,
   read them.
2. **Check applicability.** Ask: "does the requested work touch a
   capability that's mid-migration in this playbook? Is there an
   R-stage for it?"
3. **Default to the destination side.** If the work is in scope of
   an R-stage that's already shipped, **extend that R-stage on the
   destination**. If the R-stage hasn't shipped, the work is the
   R-stage. If the work is genuinely net-new (not in any R-stage),
   pick the destination unless there's a hard data/runtime reason
   not to.
4. **"Hard data/runtime reason" is narrow.** Empty tables in prod
   are not it (build code, data lands later). Examples that ARE hard
   reasons: dev environment can't run the destination, the
   destination's schema doesn't exist yet, the destination is
   fundamentally a different runtime (different language, different
   process model).
5. **If extending the source anyway, surface the duplication cost
   explicitly.** Force the planner to write down: "this will be
   ported to <destination> at <stage>; the cost is N commits ported
   plus a deprecation."

Concretely, as a shell-level check the `/ce:plan` skill harness can
invoke during local research (the third name pattern catches the actual
filename in this repo, which the bare `-playbook-` substring matches
only incidentally):

```bash
# /ce:plan Phase 1 addendum — migration playbook discovery
PLAYBOOKS=$(find docs/brainstorms -type f \( \
  -name '*-playbook-*.md' -o \
  -name '*-migration-*.md' -o \
  -name '*migration-playbook*.md' \) 2>/dev/null)

if [ -n "$PLAYBOOKS" ]; then
  echo "Active migration playbooks found — read before planning:"
  echo "$PLAYBOOKS"
  # The planner MUST answer in the plan doc:
  #   1. Is the requested work in scope of any R-stage?
  #   2. Has that R-stage shipped on the destination?
  #   3. If shipping to source anyway, what is the documented hard
  #      data/runtime reason? (Empty prod tables are NOT a hard
  #      reason — that's a deploy-timing concern.)
fi
```

## Why This Works

The structural problem is that migration playbooks live in
`docs/brainstorms/` (long-form requirements docs), not in
`docs/plans/` or `docs/roadmap/`. The default `/ce:plan` research
agents look at code, recent commits, and roadmap tickets — none of
which surface a brainstorm-style document. Adding the playbook glob
as a default check catches the case before the planner reasons in
isolation.

The "default to destination, narrow exception list" rule short-
circuits the most common failure mode: `inheriting "ship on the
source side" framing because the source has data today`. Data is
deployable; architecture is not. Building net-new capability on the
side that's being deprecated produces drift, double work, and a
broken cutover unless someone manually ports each addition.

## Prevention

1. **`/ce:plan` skill update.** Add a Phase 1 step: discover and
   read any migration playbook (use the `find` snippet above), check
   whether the work is in scope of an R-stage. If yes, prefer the
   destination side.
2. **`/ce:plan` template addition: "Inherited assumptions to challenge."**
   Every plan that builds on a predecessor plan must include this
   section and re-derive the "which side / which app / which layer"
   question from current repo state. The predecessor's framing is a
   hypothesis to falsify, not a premise to inherit. See
   `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md`.
3. **Lint: cross-app pattern import (mechanical reviewer rule).** If
   a plan's "Files to create" list targets `apps/X/` and its "Pattern
   reference" / "Byte-parity invariant source" cites `apps/Y/` where
   X ≠ Y, the plan must contain a paragraph titled `Why X, not Y` with
   a hard data/runtime reason. Absence of that paragraph = blocking
   review comment. This is checkable without domain knowledge — `ce:review`
   personas can apply it mechanically against the plan markdown.
4. **Code-review checklist for plan docs.** When reviewing a plan that
   says "ships to source first; destination port is a follow-up," ask:
   "is the destination unable to host this work today, or is it
   inconvenient?" Inconvenient is not enough.
5. **Memory-pointer escalation rule.** When `MEMORY.md` contains an
   entry whose body names a playbook, runbook, or migration doc by
   path (e.g. `project_admin_migration_status.md` referencing
   `apps/admin/CLAUDE.md` R1 runbook (auto memory [claude])),
   `/ce:plan` MUST open the referenced doc before drafting. Treat
   memory entries as forced-read pointers, not summaries. A
   cache-warm summary is not a substitute for the source of truth —
   memory entries go stale faster than their referents.

## Compounding cost incurred (this round)

- **cms keyword-first** shipped in PR #852 (6 commits, ~5,400 LOC,
  399 tests). Solid work, wrong side.
- **Six `docs/solutions/` docs** authored against cms paths. They
  carry over conceptually but every code reference will need an
  admin equivalent.
- **R4 admin keyword-first port** is now a separate ticket (TBD).
- **Cleanup at R8 consumer cutover**: cms keyword-first is removed
  alongside the rest of cms search. Net: same end-state, ~2× the
  work to get there.

## Related

- `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md` —
  the playbook this learning was triggered by.
- `docs/plans/2026-04-23-002-feat-admin-r4-hybrid-search-plan.md` —
  the destination-side plan that already shipped (PR #837); the
  target this new work should have extended.
- `docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md` —
  the plan that should have caught this.
- `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md` —
  sibling learning: when `/ce:plan` builds on a predecessor plan,
  challenge the inherited framing; treat MEMORY.md pointers as
  forced-read references.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md` —
  sibling-port theme reinforces the duplication-cost prevention rule.
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md` —
  unrelated pattern that also originated in feat-109.
- `apps/admin/src/services/hybrid-search-sql.ts` — the R4 byte-parity
  reference. Should have been the _target_ to extend, not the
  _pattern_ to copy.
