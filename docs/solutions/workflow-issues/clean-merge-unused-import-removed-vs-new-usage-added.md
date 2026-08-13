---
title: "A clean, marker-free merge can still not compile: an import removed as unused on one side, used newly on the other"
date: "2026-08-13"
category: "workflow-issues"
module: "cross-cutting git merge hygiene (incident in apps/mobile)"
problem_type: workflow_issue
component: development_workflow
severity: high
root_cause: missing_workflow_step
resolution_type: workflow_improvement
applies_when:
  - "Merging main into a long-running feature branch where both sides touched the same file"
  - "One side removed an import because static analysis or a human judged it unused"
  - "The other side added a genuinely new usage of that import in a different hunk"
  - "Git reports zero conflicts, so nothing looked like it needed review"
symptoms:
  - "TS2304 'Cannot find name X' on the merged head immediately after a main-merge, with zero conflict markers"
  - "Both parent branches typecheck and build cleanly on their own"
  - "The broken name is an import one parent removed as unused while the other parent added a new reference elsewhere in the file"
related_components:
  - "apps/mobile/src/components/home/HomeHeroPager.tsx"
  - "apps/mobile/src/components/sections/VideoHeroRenderer.tsx"
tags:
  - merge
  - semantic-conflict
  - unused-import
  - typecheck
  - git
  - monorepo
  - clean-merge
  - metro-bundle-smoke
---

# Semantic Merge Conflict: Import Removed on One Side, New Use Added on the Other

## Problem

Merging `main` into a long-running branch produced a merged tree that failed
`tsc --noEmit`, even though the merge itself reported no conflicts and both
parent commits compiled cleanly on their own.

Two independent, correct changes collided in the union:

- **main** (PR #1927, `fix(mobile): rework the watch player chrome and drop
unusable subtitles`, commit `fa07b4172`) extracted the iOS-blur /
  Android-dim split in `HomeHeroPager.tsx` and `VideoHeroRenderer.tsx` into a
  shared `PlatformBlur` component, and removed the `Platform` import from
  `react-native` in both files because nothing in either file used it anymore:

  ```diff
   import {
     FlatList,
     type NativeScrollEvent,
     type NativeSyntheticEvent,
  -  Platform,
     StyleSheet,
     Text,
     View,
     useWindowDimensions,
   } from "react-native"
  -import { BlurView } from "expo-blur"
  +import { Image } from "expo-image"
  ...
  -          {Platform.OS === "ios" ? (
  -            <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
  -          ) : (
  -            <View style={[StyleSheet.absoluteFill, styles.androidDim]} />
  -          )}
  +          <PlatformBlur intensity={50} style={StyleSheet.absoluteFill} />
  ```

  (`VideoHeroRenderer.tsx` carries the identical import-removal hunk.)

- **the SDK 57 branch** (PR #1926, two PR #1926 commits, one per file) added a new use of
  `Platform` in both files, unrelated to the blur block, to opt Android's
  hero `VideoView` into `textureView` compositing under RN 0.86 Fabric:

  ```tsx
  surfaceType={Platform.OS === "android" ? "textureView" : undefined}
  ```

Merging main into the branch (the main-merge commit on PR #1926) kept main's trimmed
import block and the branch's new `Platform.OS` usage. The import-removal
hunk and the new-usage hunk sit in different parts of each file, so Git's
three-way merge auto-resolved with **no textual conflict**. The merged head
failed typecheck with:

```
src/components/home/HomeHeroPager.tsx(695,24): error TS2304: Cannot find name 'Platform'.
src/components/sections/VideoHeroRenderer.tsx(174,26): error TS2304: Cannot find name 'Platform'.
```

Both parent commits — `fa07b4172` alone and the branch tip before the merge —
compiled cleanly. Only the merged union was broken.

## Symptoms

- `git merge main` (or `git merge origin/main`) completes with no conflict
  markers and no manual resolution step.
- `pnpm --filter @forge/mobile typecheck` (or plain `tsc --noEmit`) on the
  merged head fails with `TS2304: Cannot find name 'Platform'` at the exact
  line of the branch's new `surfaceType={Platform.OS === "android" ? ... }`
  prop, in every file where this pattern occurred.
- Metro would also fail to bundle either file, since `Platform` is an
  undefined identifier at runtime, not just a type error.
- Neither side's own diff, read in isolation, shows anything wrong: main's
  diff correctly drops a now-dead import; the branch's diff correctly adds a
  new prop against an import that, at the time the branch commit was made,
  still existed in the file.

## What Didn't Work (because nothing could)

This class of break is invisible to every mechanism that inspects a change
in isolation rather than the merged result:

- **Conflict markers catch nothing here.** Git's three-way merge is
  hunk-based, not symbol-based. The import list and the JSX prop are
  different hunks in different regions of the file, so the merge algorithm
  sees no overlapping lines and auto-resolves silently. There is no `<<<<<<<`
  moment to notice.
- **Reviewing either side's diff alone catches nothing.** PR #1927's diff is
  self-consistent: it removes `Platform` from a file where, at review time,
  nothing else uses it. PR #1926's diff is also self-consistent: it adds a
  `Platform.OS` check against an import that is present in the file at the
  moment that commit is made. Neither PR is wrong. Neither PR's author has
  any way to see the other PR's file state.
- **"Both parents are green in CI" catches nothing.** Main's CI ran
  typecheck against main's tree, where the import truly is unused. The
  branch's CI ran typecheck against the branch's tree, where the import
  truly is used and truly is present. Both pass, honestly. The failure exists
  only in the union the merge produces, which no CI run before the merge
  commit itself ever typechecks.
- **The source-shape guard test does not catch it either.**
  `apps/mobile/src/components/home/__tests__/homeHeroAndroidCompositing.guard.test.ts`
  pins the literal string `surfaceType={Platform.OS === "android" ?
"textureView" : undefined}` inside each file's `<VideoView>` block via
  `indexOf`/`slice` on the raw source text. That guard is a Jest test, and
  Jest never compiles or typechecks the file it reads as a string — it only
  proves the substring is present. A file with that exact substring but a
  missing `Platform` import still passes the guard while failing `tsc`
  outright.

## Solution

Re-add the `Platform` import to each file's `react-native` import block.
Two one-line changes (the repair commit on PR #1926):

```diff
 import {
   FlatList,
   type NativeScrollEvent,
   type NativeSyntheticEvent,
+  Platform,
   StyleSheet,
   Text,
   View,
   useWindowDimensions,
 } from "react-native"
```

```diff
 import {
   AppState,
+  Platform,
   Pressable,
   StyleSheet,
   Text,
   View,
   useWindowDimensions,
 } from "react-native"
```

No other code changed. Both files already had a correct, compiling use of
`Platform.OS` from the branch side; they only needed the import main's side
had legitimately dropped for its own, no-longer-true reason.

## Why This Works

The merged file's only defect was the missing binding. `PlatformBlur` (from
main) does not need `Platform` and does not reference it. `surfaceType=
{Platform.OS === "android" ? "textureView" : undefined}` (from the branch)
does need it. Restoring the import satisfies the one real consumer left
standing after the merge combined both sides' changes. This is not a design
decision or a rewrite — it is closing the gap the merge opened between "what
the file imports" and "what the file's union of changes uses."

## Prevention

**Typecheck the merge commit, not just each side.** After merging `main`
into an active React Native app branch (or any branch that has been open
long enough for main to have moved independently), run that app's
`typecheck` script against the merged HEAD before trusting the merge, even
when Git reports zero conflicts. CI runs typecheck on push, so an
un-typechecked local merge pushed blind would still be caught by CI before
landing — but do not rely on that alone:

- It costs a full CI round-trip to discover a break you could have caught in
  seconds locally.
- A parallel failure mode — a bundle-only break with no type error — passes
  `tsc` cleanly but breaks Metro. CI's typecheck job would miss that kind
  entirely. See
  `docs/solutions/build-errors/pnpm-hidden-hoist-phantom-dependency-worklets-babel-metro-bundle-failure.md`
  for why. So the repo-local law after any main-merge into an RN app branch
  is: **run the app's typecheck AND a Metro bundle smoke (both platforms)
  before trusting the merge**, not either alone.

**Guards complement compiling the union; they never substitute for it.**
`homeHeroAndroidCompositing.guard.test.ts` is a source-shape guard: it exists
specifically to catch a _silent revert_ of the `surfaceType` prop (a change
that compiles fine either way, so `tsc` cannot see it, but breaks Android
Fabric compositing at runtime with no test failure). It does its job
perfectly for that failure mode. It was never a defense against this failure
mode, because a guard built on `indexOf`/`slice` over raw source text has no
concept of imports, scope, or whether the file compiles at all. A file can
contain the exact pinned literal and still be dead on arrival at `tsc`. Any
time a guard test pins a literal snippet of JSX or a prop value, treat that
as coverage for "did someone revert this specific line," not as coverage for
"does this file still compile" — those are different questions and need
different checks.

**The general law.** A merge combining "side A removes something as unused"
with "side B adds a new use of that same thing" is textually clean and
semantically broken. Conflict markers cannot catch it, because the two
changes never touch the same lines. Reviewing either side's diff alone
cannot catch it, because each diff is correct against its own base. Green CI
on both parents cannot catch it, because neither parent's tree contains the
union. The only thing that can catch it is compiling (or typechecking) the
_merged_ tree itself. No one made a mistake in either PR #1927 or PR #1926 —
the import removal on main was correct for main's tree, and the new usage on
the branch was correct for the branch's tree. The break exists only in the
union, which is exactly what makes this class worth watching for: it recurs
by construction whenever an upgrade branch runs long against an active main,
and it will keep recurring on any pair of independently-correct changes that
happen to add and remove the same identifier's last use on either side of a
merge.

## Related

- `docs/solutions/workflow-issues/merge-conflict-region-is-textual-not-semantic.md` — the same law ("the conflict region is textual, not semantic") with two OTHER shapes: convergent-aggregate auto-merge and a mid-syntax hunk boundary. This doc is the third shape: zero conflict region at all.
- `docs/solutions/workflow-issues/turborepo-affected-gate-hides-type-errors-between-prs.md` — same symptom (Cannot find name right after a main-merge) from a different cause (a latent main bug surfaced by affected-gating). Run its pre-existing-vs-merge-introduced triage first.
- `docs/solutions/workflow-issues/gh-pr-checks-watch-silent-pass-on-unmergeable-pr.md` — one gate upstream: confirm CI actually ran against the merge commit before trusting its result.
- `docs/solutions/build-errors/pnpm-hidden-hoist-phantom-dependency-worklets-babel-metro-bundle-failure.md` — the adjacent verification layer: typecheck catches symbol-level breaks, only a Metro bundle smoke catches bundle-time breaks.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META family: a green, clean-looking signal proves the branch shape, not the real union.
