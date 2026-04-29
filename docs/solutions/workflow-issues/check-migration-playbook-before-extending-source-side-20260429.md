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
date: "2026-04-29"
related_prs:
  - "JesusFilm/forge#849"
  - "JesusFilm/forge#852"
related_docs:
  - "docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md"
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
- The `apps/admin/src/services/hybrid-search-sql.ts` (R4 byte-parity
  reference, shipped 2026-04-23 in PR #837) was copied **into cms** as
  the canonical pattern source for the GIN byte-parity invariant.
- The `/ce:plan` repo-grounding scan reported file paths, retriever
  conventions, naming collisions — but didn't reach for
  `docs/brainstorms/*-playbook-*.md`.
- `MEMORY.md` had `project_admin_migration_status.md` loaded, with R4
  shipping explicitly noted, and the agent read past it.
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

```ts
// /ce:plan local research, additional default check:
const playbooks = await glob([
  "docs/brainstorms/**/*-playbook-*.md",
  "docs/brainstorms/**/*-migration-*.md",
])
if (playbooks.length > 0) {
  // Read each. For each R-stage / migration phase, ask:
  // "Is the requested work in scope of an R-stage?"
  // If yes, default destination side, document why if not.
}
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
   read any migration playbook, check whether the work is in scope of
   an R-stage. If yes, prefer the destination side.
2. **Code-review checklist for plan docs.** When reviewing a plan that
   says "ships to source first; destination port is a follow-up," ask:
   "is the destination unable to host this work today, or is it
   inconvenient?" Inconvenient is not enough.
3. **Duplication-signal heuristic for reviewers.** If the plan
   imports a pattern reference from the destination side into the
   source side, treat it as a tell that the work probably belongs on
   the destination. Make the planner justify the inversion explicitly.
4. **Memory hygiene.** When `MEMORY.md` references a migration
   playbook by name, the planner should read the named playbook, not
   skim the memory entry. The memory entry is a pointer; the playbook
   is the source of truth.

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
- `docs/plans/2026-04-29-001-feat-search-keyword-first-mode-plan.md` —
  the plan that should have caught this.
- `docs/solutions/best-practices/test-first-regression-snapshot-byte-identical-default-20260429.md` —
  unrelated but a sibling pattern that also originated in feat-109.
- `apps/admin/src/services/hybrid-search-sql.ts` — the R4 byte-parity
  reference. Should have been the _target_ to extend, not the
  _pattern_ to copy.
