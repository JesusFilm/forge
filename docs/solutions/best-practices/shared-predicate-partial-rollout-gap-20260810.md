---
title: A new shared visibility predicate must be audited against every duplicate hand-rolled block, not just the call sites the PR already touched
date: 2026-08-10
last_updated: 2026-09-08
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
  - mobile
related:
  - docs/plans/2026-08-04-001-fix-video-restrict-view-platforms-sync-plan.md
  - docs/solutions/best-practices/code-review-prescribed-mechanism-verification-gap.md
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
  the right _feature area_ ("series parent/child relations") but the
  actual enumeration of call sites under that area was incomplete.
- Grepping for the new predicate's usages to confirm coverage. That only
  proves where the predicate WAS applied, not where a same-shape
  visibility check exists but wasn't converted to use it.

## Solution

Grep for the _shape_ being replaced, not just the _call sites the diff
touched_: search the whole affected service/loader files for other
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
centralization), introducing a shared function to replace _some_
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

## Worked instance (2026-08-13): Android hero surfaceType rollout in apps/mobile

The same gap recurred outside Prisma predicates, on a one-line native prop.
A PR #1926 commit fixed the RN 0.86 Android black-hero bug by
adding `surfaceType={Platform.OS === "android" ? "textureView" : undefined}`
to the home hero VideoView — the two sites the investigation had touched
(`HomeHeroPager.tsx`, plus the pre-existing `VideoPlayer.tsx:408` precedent).
The structurally identical third site, `VideoHeroRenderer.tsx` (the SDUI
experience hero, mounted in the same zIndex-0-behind-FlashList stack by
`CuratedHomeLayout`), was missed — by the commit's own diagnosis it would
still render black on Android.

The reviewer found it by applying rule 1 above: grep for the **shape** (all
`VideoView` render sites), not the diff's files. A validator confirmed
`VideoHeroRenderer` was the only unfixed render site and that the surface is
production-reachable at `/experience/[slug]`. The mirror fix landed with a
source-shape guard test
(`apps/mobile/src/components/home/__tests__/homeHeroAndroidCompositing.guard.test.ts`)
pinning all three props, falsified once before landing. Full write-up:
`docs/solutions/ui-bugs/android-home-hero-black-refreshcontrol-surfaceview-compositing.md`.

The instance extends the law beyond shared predicates: any repeated FIX
(a prop, a style, a guard) applied to some instances of a structural shape
leaves the untouched siblings silently stale — grep the shape before
claiming the area covered.

## Worked instance (2026-09-07): incremental transcript visibility

The gap recurred in Watch Search's transcript projection. Catalog indexing
correctly excluded videos whose `restrict_view_platforms` contained `watch`,
but both the full transcript loader and the new incremental transcript
publisher independently computed a `publiclyVisible` boolean from deletion,
`no_index`, and published locale state without restating the Watch restriction.
The incremental path made the omission observable: a restriction could change
after the catalog alias was built, leaving a stale catalog document that a new
public transcript hit could still hydrate into a result.

The fix added the raw-SQL restriction to both transcript projection paths. Its
real-PostgreSQL seam test deliberately keeps the old Typesense catalog document
while changing the canonical video restriction before ingest, then proves the
published transcript document is private and the real Watch Search reader
returns no result. This extends the audit rule across asynchronously refreshed
projections: never assume another projection's older visibility decision will
contain a newly published row.

## Worked instance (2026-09-08): new mobile search code re-derived a predicate the same screen already imports

Every case above is a rollout gap: a shared predicate or a repeated fix reached
some sites of a structural shape and left the pre-existing siblings alone. This
one is not. The gap opened on brand-new code, in an app already using the
predicate correctly. `apps/mobile` classifies a series with
`isSeriesSearchResult` (`apps/mobile/src/lib/isSeriesRecord.ts:42-48`), which is
label-first: a record
that carries a label is classified by that label alone, and `childCount` decides
only for an unlabeled record. Mobile PR #1980 introduced that rule and removed
`isSeriesLabel(result.label) || (result.childCount ?? 0) > 0`, because a feature
film owns its chapter clips. The predicate's own comment names the
counterexample: "Feature films own their chapter clips (JESUS 61), so 'has
children' is not evidence of a series."

PR #2194 (open and unmerged as of 2026-09-08) then added two decisions to the
search grid — a preview-eligibility gate and a duration/episode-count chip — and
both answered "is this a series?" with a bare `childCount > 0`, re-creating the
exact expression #1980 had removed. The JESUS card's chip read "61 episodes"
instead of its runtime 2:07:54, and the preview cycle skipped the card.

The predicate was not merely available. It was already imported and called
correctly in the same screen file that renders the new card:
`apps/mobile/app/(tabs)/watch.tsx:153` routes a tapped result with
`isSeriesSearchResult(result)`, and that line is on `origin/main`.
`apps/mobile/src/components/home/HomeCard.tsx:87` is a second correct consumer,
also predating the branch. So "does this app already use the shared helper?"
answers yes and still gives a false all-clear. **Ask it per call site, and ask it
of new code** — not only of a refactor that introduces a helper.

Two details generalize past this feature. The new gate carried a comment
justifying itself — "`childCount` is the rule, matching apps/tv's series gate" —
and that citation was false in the same direction as the bug: apps/tv PR #1767
is the PR that _removed_ the childCount rule. A comment naming a sibling app is a
claim to verify, not evidence of coverage. Separately, the branch changed
`buildMetaLabel` (`apps/mobile/src/lib/watchHome/model.ts:149`) from private to
exported so the new chip could call it. It decides on `if (args.childCount > 0)`
(`:154`), so every caller must pass a series-gated count — an invariant that was
safe while one caller held it, and that the signature cannot state. Exporting a
single-caller helper publishes its caller's invariants along with it.

`ce-code-review` caught both sites pre-merge — two P1 findings at confidence
100 per that run's own report, whose artifacts were temporary — so the fix landed
in the same commit and the defective state never reached git. This is the first instance here where the audit rule ran as a review check
rather than a post-hoc discovery. Coverage of the fix is uneven, and the uneven
part is the lesson: `previewCycle.test.ts` adds a discriminating
`featureFilmWithChapters(61)` fixture that goes red if the gate reverts, while a
revert of the chip site compiles, typechecks, and leaves the whole suite green.
Nothing else would catch either — no lint rule targets a hand-rolled
`childCount > 0`, and no test enumerates the predicate's call sites, although the
repo already uses that guard shape twice for other invariants
(`apps/mobile/src/lib/__tests__/watchProgressBarKeys.test.ts`,
`apps/mobile/src/components/home/__tests__/homeCardRoutingLabel.guard.test.ts`).

One hit of the same shape grep stays open. `normalizeCard` computes a raw
`children.length` (`apps/mobile/src/lib/watchHome/model.ts:180-183`) and passes
it straight into `buildMetaLabel` (`:220-223`) with no predicate between them,
and the home carousel deliberately keeps feature films that own chapter children
(`:405-408`). No home-model test builds a `FEATURE_FILM` card with children.
This session did not confirm that the shape is reachable in production on the
home surface, so treat it as the grep's third hit, not as a reported defect.

The instance extends the law from rollout to greenfield. A predicate that is
already correct, already imported, and already called correctly next door still
gets re-derived by new code — so a per-app check and a per-PR check both pass
while a new call site carries the old bug.

## Cross-references

- **Plan:** `docs/plans/2026-08-04-001-fix-video-restrict-view-platforms-sync-plan.md`
- **PR:** #1830 (`fix(admin): exclude watch-restricted videos from all public surfaces`), stacked on #1829.
- **Fixed files:** `apps/admin/src/graphql/loaders.ts`,
  `apps/admin/src/services/video.service.ts`
  (`getChildDubLanguages`, `getDownloadableChildDubs`).
- **Sibling law from the same 2026-09-08 review run:**
  `docs/solutions/best-practices/code-review-prescribed-mechanism-verification-gap.md`
  — there a reviewer named a real defect but prescribed a mechanism this app
  does not have; here a reviewer named both the defect and the correct
  existing mechanism to call.
- **Meta-pattern this is an instance of:** see CLAUDE.md's
  "Mocked-vs-real testing discipline (META)" entry and
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
