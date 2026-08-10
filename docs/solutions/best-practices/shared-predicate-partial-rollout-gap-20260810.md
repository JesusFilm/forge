---
title: A new shared visibility predicate must be audited against every duplicate hand-rolled block, not just the call sites the PR already touched
date: 2026-08-10
problem_type: best_practice
category: best-practices
component: apps_admin
root_cause: incomplete_rollout
resolution_type: code_fix
severity: medium
tags:
  - visibility
  - prisma
  - graphql
  - code-review
  - dataloader
related:
  - docs/plans/2026-08-04-001-fix-video-restrict-view-platforms-sync-plan.md
---

# A new shared visibility predicate must be audited against every duplicate hand-rolled block, not just the call sites the PR already touched

## Problem

PR #1830 (`fix(admin): exclude watch-restricted videos from all public
surfaces`) added a shared, principal-aware predicate,
`notRestrictedFromWatchWhere()` / `watchVisibilityWhere(user)` in
`apps/admin/src/services/search-watchability.ts`, and applied it to five
call sites in `video.service.ts` (list/getById/getBySlug/getDubById/
watchRouteSnapshot) plus the raw-SQL CTEs. The PR's own description
claimed this covered "series parent/child relations" as one of the fixed
surfaces.

It didn't, fully. Three more call sites computed the same
"is this child video visible to a public/consumer caller" condition by
hand, independently of the new shared predicate, and were never touched:

- `apps/admin/src/graphql/loaders.ts` — `loadVideoRelationsByVideoId`
  (backs the `Video.parents`/`Video.children` GraphQL fields, which
  `apps/web/src/lib/fragments/watch-video.ts` and `watch-home.ts` query
  directly on every watch page load).
- `apps/admin/src/services/video.service.ts` — `getChildDubLanguages`
  (episode/chapter language picker).
- `apps/admin/src/services/video.service.ts` — `getDownloadableChildDubs`
  (episode/chapter download picker).

Each of these had its own local `childVisibility`/`where` object built
inline (`{ deletedAt: null, locales: { some: { status: "PUBLISHED", ... } } }`)
that pre-dated the new predicate and was structurally identical to what
the predicate replaced elsewhere — but because it was a separate literal
object rather than a call to the shared function, adding the shared
function didn't touch it, and no compiler or lint rule flagged the gap.

## Symptoms

- The PR's stated scope ("series parent/child relations") reads as
  covered because `videoParentsFilter`/`videoChildrenFilter` in
  `apps/admin/src/graphql/types/video.ts` DO correctly gate on the new
  predicate — but those two functions are dead code (zero production
  callers outside their own test file). The actually-wired production
  path (`loaders.ts`'s DataLoader batch functions) was missed.
- All existing tests still pass — the omission has no coverage, so
  there's no red test to point at it. A watch-restricted video keeps
  showing up as a sibling/parent/child on any watch page that renders
  series relations, and keeps showing in the language/download pickers
  for its child dubs, both fully public-reachable.

## What didn't work

- Trusting the PR description's surface list at face value. It named
  the right *feature area* ("series parent/child relations") but the
  actual enumeration of call sites under that area was incomplete.
- Grepping for the new predicate's usages to confirm coverage. That only
  proves where the predicate WAS applied, not where a same-shape
  visibility check exists but wasn't converted to use it.

## Solution

Grep for the *shape* being replaced, not just the *call sites the diff
touched*: search the whole affected service/loader files for other
literal `{ deletedAt: null, locales: { some: { status: "PUBLISHED", ... } } }`-
shaped objects (the pre-existing "is this row publicly visible" idiom),
independently of whether the PR's diff mentions them. Any hit is a
candidate that should have been converted to call the new shared
predicate.

In this case that surfaced three more `childVisibility`/`where` blocks;
all three got `...notRestrictedFromWatchWhere()` added the same way the
PR's own five call sites were patched, plus regression tests in
`loaders.test.ts` and `video.service.test.ts` asserting the restriction
clause is present for consumer/anonymous callers and absent for
EDITOR/ADMIN callers.

## Why this works

A shared predicate is only as complete as its adoption. When a codebase
has an established idiom (hand-rolled visibility `where` objects,
repeated across files because Prisma composition doesn't force
centralization), introducing a shared function to replace *some*
instances of that idiom leaves the rest silently stale — they still
compile, still pass their existing tests (which were written against the
OLD, narrower visibility contract), and look identical to a reviewer
skimming the diff, because the diff never touches them.

This is a specific instance of the repo's own
`mocked-shape-vs-real-contract-discipline` meta-pattern: the shared
predicate has correct unit-test coverage of its own shape, but "coverage
of the predicate" and "coverage of every place that NEEDED the
predicate" are different claims, and only the second one is what the PR
description asserted.

## Prevention / How to apply

When a PR introduces a new shared predicate/helper meant to replace an
existing ad-hoc pattern repeated across a codebase:

1. Before claiming a feature area is "covered," grep for the **shape**
   the predicate replaces (the literal object structure, the exact
   Prisma `where` idiom) across the full blast radius of files that deal
   with that domain concept — not just the files the diff already
   touches.
2. Trace GraphQL fields back to their **actual production resolver/
   DataLoader**, not just any function whose name matches the field.
   Dead-code helpers with the right name and the right logic
   (`videoParentsFilter`/`videoChildrenFilter` here) can pass a
   confidence check while the real wiring (`loaders.ts`) goes unaudited.
3. Add a regression test per converted call site that asserts the
   restriction clause is present for the unprivileged path and
   explicitly absent (`expect(...).toBeUndefined()`) for the
   editor/admin bypass path — this is the shape of test that would have
   failed before this fix and would catch a future regression.

## Cross-references

- **Plan:** `docs/plans/2026-08-04-001-fix-video-restrict-view-platforms-sync-plan.md`
- **PR:** #1830 (`fix(admin): exclude watch-restricted videos from all public surfaces`), stacked on #1829.
- **Fixed files:** `apps/admin/src/graphql/loaders.ts`,
  `apps/admin/src/services/video.service.ts`
  (`getChildDubLanguages`, `getDownloadableChildDubs`).
- **Meta-pattern this is an instance of:** see CLAUDE.md's
  "Mocked-vs-real testing discipline (META)" entry and
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
