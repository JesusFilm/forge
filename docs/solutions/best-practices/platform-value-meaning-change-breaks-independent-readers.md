---
title: "When a shared helper stops carrying a term, audit every reader of the platform value, not every caller of the helper"
date: 2026-09-14
category: best-practices
module: apps/mobile
problem_type: best_practice
component: frontend_stimulus
severity: medium
root_cause: incomplete_rollout
resolution_type: code_fix
related_components:
  - tab-bar
  - safe-area-insets
applies_when:
  - "A shared helper computes a UI value (spacing, clearance, offset) that is partly derived from a platform-supplied primitive such as safe-area insets, window dimensions, or system chrome height"
  - "The platform primitive's MEANING changes, for example a native controller starts including a bar's height in the safe-area inset it reports where a JS-drawn equivalent never did"
  - "Other components read that same raw platform primitive directly, independent of the shared helper, and compose it with their own offsets"
  - "A grep for the helper's name or its exported constants cannot find those independent readers, because they never call the helper"
tags:
  - ios
  - tab-bar
  - safe-area-insets
  - native-tabs
  - expo-router
  - shared-constants
  - blast-radius
---

## Context

`apps/mobile` moved the iOS bottom tab bar from expo-router's JavaScript `<Tabs>`
to `expo-router/unstable-native-tabs`. The old bar was a floating capsule that
the app drew itself. The new bar is a real UIKit `UITabBarController`. This work
is PR #2284, which is open and unmerged at the time of writing.

A spike measured the decisive number. Inside a native tab, `insets.bottom`
already contains the bar. A tab screen reports 83 points, which is a 34 point
home indicator plus the 49 point bar. The measurement holds on iOS 18.6 and on
iOS 26.5 alike. See `apps/mobile/src/lib/tabBar.ts:7-11` and the Results section
of `docs/roadmap/platform/feat-500-mobile-native-tabs-migration.md`.

So the shared helper stopped adding a bar height. `tabBarClearanceFor()` now
returns `insets.bottom + TAB_BAR_CLEARANCE_GAP` on iOS and `0` elsewhere
(`apps/mobile/src/lib/tabBar.ts:91-94`). The gap constant is 12
(`apps/mobile/src/lib/tabBar.ts:14`). Before the migration the same helper
returned `insets.bottom + 56 + 12 + 12`. The helper's OUTPUT changed by a
predictable amount. The meaning of its INPUT changed too, and that is the part
nobody tracked.

Six files call `useTabBarClearance()`. All six were updated or confirmed. Three
other files broke, because each one reads `insets.bottom` on its own.

## Guidance

When a shared helper stops carrying a term because the platform now supplies
it, two different things change. The helper's result changes, and the platform
value changes. Callers of the helper are easy to find. Readers of the platform
value are not, and they are the larger set.

Run the audit against the platform value. Do not run it against the helper.

**Step 1. Name the value whose meaning moved.** Here it is `insets.bottom`
inside a tab screen. Write the old meaning and the new meaning down as numbers.
Old: 34, the home indicator alone. New: 83, the indicator plus the bar.

**Step 2. Search for the value, not for the helper.**

```bash
# The helper's callers. Returns 8 lines: the six real consumers, the module
# itself, and app/(tabs)/_layout.ios.tsx, which names it only in a comment.
grep -rl "useTabBarClearance" apps/mobile/app apps/mobile/src | grep -v __tests__

# The affected set. Returns 15 lines: 14 readers plus src/lib/tabBar.ts.
grep -rln "insets\.bottom" apps/mobile/app apps/mobile/src | grep -v __tests__
```

Twelve of those fourteen files appear nowhere in the clearance guard's list. A
wider search for `useSafeAreaInsets` returns 22 files outside
`apps/mobile/src/lib/tabBar.ts`.

**Step 3. For each reader, ask which provider scope it reads.** A reader outside
the tab controller sees a different number. `apps/mobile/src/lib/miniPlayer/layout.ts:132`
reads `insets.bottom`, but `PlaybackHost` is a sibling of the `<Stack>` and sits
in the root provider. Its inset never contained the bar, so it did not break.
The mini player was handled instead through `TAB_BAR_OCCUPIED_HEIGHT`
(`apps/mobile/src/lib/tabBar.ts:53-59`).

**Step 4. For each reader inside the scope, ask whether it adds the helper AND
the raw value.** That sum is now a double count. The Snackbar did exactly this.

**Step 5. For each reader, ask whether its own rendering changes the value it
reads.** This is the self-referential case. `SelectionActionBar` appears when
the tab bar hides, and the hide is what drops the inset. So the bar sizes itself
from a number its own appearance invalidates.

**Step 6. Pin the real number in the test, not the neutral one.** A fixture at
`insets.bottom = 34` cannot tell the two formulas apart. A fixture at 83 can.
`apps/mobile/src/lib/__tests__/tabBar.test.ts:65-73` holds that falsification as
an explicit `not.toBe`. It pins the SHAPE of the double count — the inset plus
the bar height plus the gap — with the current `TAB_BAR_HEIGHT_IOS`, not the
literal number the retired pill constants produced.

### A platform branch inside the helper makes the obvious gate wrong

The first fix for the Snackbar keyed on the caller's intent alone:

```tsx
// Broken. Android's clearance is 0, so the tab caller lost the whole inset.
bottom: (clearsTabBar ? tabBarClearance : insets.bottom) + 16
```

`tabBarClearanceFor()` returns `0` on Android
(`apps/mobile/src/lib/tabBar.ts:92`), because the Android bar displaces content
instead of drawing over it. A tab caller on Android therefore entered the
clearance branch and rendered at 16 points. The shipped gate reads both axes:

```tsx
// apps/mobile/src/components/ui/Snackbar.tsx:31
const liftsOverBar = clearsTabBar && tabBarClearance > 0
```

On iOS the second term is always true, because the gap constant is 12. The term
exists only to exclude Android. State that where the gate lives, or a later
reader removes it as dead.

### An enumeration guard cannot close this gap

`apps/mobile/app/__tests__/tabBarClearance.guard.test.js` lists six surfaces at
lines 33-40 and pins the list length at line 69. Its own comment at lines 8-9
calls it an enumeration and not a sweep. It does real work. It strips comments,
it strips `scrollIndicatorInsets`, and it proves the clearance is APPLIED rather
than merely imported.

It cannot see this failure at all. Every one of its six surfaces uses the helper
correctly. The three broken files break in a way the guard does not test for:
two of them are not in the list, and the one that is in the list
(`apps/mobile/app/(tabs)/library.tsx`) passes the guard while reserving the wrong amount.
An enumeration keyed on the HELPER is blind to readers of the VALUE.

## Why This Matters

PR #2284's review-fix commit records a ten-reviewer code review that confirmed
13 findings on this branch. Three of those findings are this single root cause.
The commit message names it directly: "Every other reader of that inset changed
meaning without being edited".

The three failures were all visible to a user, and none of them was visible in a
test:

- The toast sat 83 points too high on every tab route.
- The Library list hid 13 points of its last row during a delete flow.
- The selection bar painted its first frame 49 points too tall, with its buttons
  83 points off the screen edge.

The migration commit's own file list refines the usual "it was not in the diff"
framing, and the refinement is the useful part. `Snackbar.tsx` was genuinely
absent from that commit. `library.tsx` and `SelectionActionBar.tsx` were both in
it. `library.tsx` was edited for the hide lever, and its `selectionPad` line was
left untouched. `SelectionActionBar.tsx` had its shape object REWRITTEN in that
commit, and the new arithmetic was wrong on the first frame.

So editing a file is not protection either. The author changed
`SelectionActionBar` to take the box the hidden bar leaves behind, and wrote
`height: TAB_BAR_HEIGHT_IOS + insets.bottom`. That line is correct for the
settled state and wrong for the mounting state. Only an audit that asks "does
this component's own appearance change the value it reads" finds it.

### How this differs from two neighbouring write-ups

`docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`
says to DERIVE geometry from shared exported constants rather than hand-copy
them. All three files here obeyed that rule. `SelectionActionBar` imports
`TAB_BAR_HEIGHT_IOS`. `library.tsx` and `Snackbar.tsx` call
`useTabBarClearance()`. Deriving protects a reader when the shared VALUE
changes. It gives no protection when the shared value's MEANING changes, because
the reader also obtains the same quantity from a second source, which is the
platform.

`docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
records an incomplete rollout. A new shared predicate reached five call sites
and missed three, and the fix was to finish applying it. This case is the
opposite shape. The rollout was complete. Every intended caller took the new
helper. The damage landed on readers that correctly did NOT use the helper, and
whose independent reading of the same platform value changed meaning under them.
One failure is "you missed a call site". The other is "you moved the ground
under code that was never yours".

## When to Apply

Apply this audit when all three conditions hold.

1. A shared helper drops a term, or adds one, because a platform, a framework or
   a library now supplies that term.
2. The underlying value the helper reads is also readable directly, and other
   code reads it directly.
3. The value differs by scope, by lifecycle phase, or by platform.

Concrete triggers in this repository and in comparable code:

- A navigator moves from a JavaScript implementation to a native one. Safe-area
  insets, header heights and keyboard offsets all change meaning.
- A scroll container starts or stops supplying automatic content insets.
- A layout value becomes reachable from a new provider whose scope differs from
  the old one.
- A component appears exactly when the value it measures changes. Any bar,
  sheet, keyboard accessory or overlay that replaces system chrome is a
  candidate.

The audit is cheap. It is one search over the value's name, then one question
per reader. Run it before the review, because a reviewer reading the diff sees
only the helper.

## Examples

### 1. The Snackbar counted the inset twice

`apps/mobile/src/components/ui/Snackbar.tsx` was never edited by the migration
commit. Its formula was correct before the migration and wrong after it.

```tsx
// Before — correct while the clearance excluded the inset's bar term.
const clearance = clearsTabBar ? tabBarClearance : 0
// ...
bottom: insets.bottom + 16 + clearance

// After — apps/mobile/src/components/ui/Snackbar.tsx:31,90
const liftsOverBar = clearsTabBar && tabBarClearance > 0
// ...
bottom: (liftsOverBar ? tabBarClearance : insets.bottom) + 16
```

Numbers on an iOS tab route, where `insets.bottom` is 83:

| Formula                       | Result             |
| ----------------------------- | ------------------ |
| Before, `83 + 16 + (83 + 12)` | 194                |
| After, `(83 + 12) + 16`       | 111                |
| Error                         | 83 points too high |

Numbers on an Android tab route, where the clearance is 0 and `insets.bottom` is
34 in the test fixture:

| Formula                                   | Result            |
| ----------------------------------------- | ----------------- |
| Correct, `34 + 16`                        | 50                |
| First fix, `clearsTabBar` alone, `0 + 16` | 16                |
| Error                                     | 34 points too low |

`apps/mobile/src/components/ui/__tests__/Snackbar.test.tsx` pins all four
platform and caller combinations, plus an anti-vacuous partner at lines 110-116.
Both Android cases expect the same number, so on their own they would pass even
if the branch were unreachable. The partner asserts that the 16 point result
cannot occur. The suite was falsified by hand against both broken versions. The
original double count turns the two iOS cases red. The `clearsTabBar`-only gate
turns the two Android cases red.

### 2. The Library list reserved less than the bar covers

During selection the tab bar hides, so `insets.bottom` settles at 34 and the
clearance settles at 46.

```tsx
// Before — apps/mobile/app/(tabs)/library.tsx, pre-fix
const selectionPad = selecting && Platform.OS === "android" ? 120 : 24

// After — apps/mobile/app/(tabs)/library.tsx:109-113
const selectionPad = selecting
  ? Platform.OS === "android"
    ? 120
    : TAB_BAR_HEIGHT_IOS + 24
  : 24
```

The list applies `paddingBottom: selectionPad + tabBarClearance`
(`apps/mobile/app/(tabs)/library.tsx:394`). The action bar covers
`TAB_BAR_HEIGHT_IOS + indicator`, which is 83.

| State                                  | Reserved         | Covered | Clear |
| -------------------------------------- | ---------------- | ------- | ----- |
| Floating capsule, before the migration | `24 + 114` = 138 | 102     | 36    |
| Native bar, before the fix             | `24 + 46` = 70   | 83      | -13   |
| Native bar, after the fix              | `73 + 46` = 119  | 83      | 36    |

The negative row is the defect. 13 points of the last row stayed under the
action bar, and no scroll could reach them. The fix restores the same 36 points
of clearance the floating capsule gave.

### 3. The action bar measured a value its own appearance changes

`SelectionActionBar` replaces the tab bar during selection. The hide drops the
49 point bar out of `insets.bottom`, and it lands one frame after this component
mounts. So the first paint reads 83, and the settled paint reads 34.

```tsx
// Before — rewritten in the migration commit, wrong on the first frame.
height: TAB_BAR_HEIGHT_IOS + insets.bottom,
paddingBottom: insets.bottom,
paddingLeft: insets.left,
paddingRight: insets.right,

// After — apps/mobile/src/components/library/SelectionActionBar.tsx:41-54
const indicator =
  insets.bottom >= TAB_BAR_HEIGHT_IOS
    ? insets.bottom - TAB_BAR_HEIGHT_IOS
    : insets.bottom
// ...
height: TAB_BAR_HEIGHT_IOS + indicator,
paddingBottom: indicator,
paddingLeft: BAR_SIDE_PADDING + insets.left,
paddingRight: BAR_SIDE_PADDING + insets.right,
```

| `insets.bottom` | Device state                        | Before                 | After                 |
| --------------- | ----------------------------------- | ---------------------- | --------------------- |
| 83              | first frame, bar still in the inset | height 132, padding 83 | height 83, padding 34 |
| 34              | settled, bar hidden                 | height 83, padding 34  | height 83, padding 34 |
| 49              | home-button device, first frame     | height 98, padding 49  | height 49, padding 0  |

The clamp gives the same box in every row. A second defect rode in the same
lines. `paddingLeft` and `paddingRight` replace `styles.bar`'s
`paddingHorizontal` outright rather than composing with it, so a bare
`insets.left` erased the 16 point side gutter in portrait.
`apps/mobile/src/components/library/__tests__/SelectionActionBar.test.tsx` now
holds a fixture at the 83 point inset and a fixture with non-zero side insets,
so both defects can fail a test.

## What is not verified

State this plainly before anyone builds on the clamp.

- **The iOS 16.4 to 17 tier is unverified.** That branch takes `tabBar.hidden`
  rather than `setTabBarHidden:animated:`, and no such simulator runtime is
  installed on this machine. `<NativeTabs hidden>` is verified on iOS 26 only.
  See the Carried forward section of
  `docs/roadmap/platform/feat-500-mobile-native-tabs-migration.md`.
- **The clamp is proven at the jest layer and on iOS 18.6 and 26.5 only.** If
  that older tier never drops the inset, the clamp is what makes the bar correct
  permanently rather than for one frame. Neither outcome is measured.
- **The 83 point inset is a device measurement, not a framework contract.** It
  was measured on an iPhone 17 Pro Max running iOS 26.5 and an iPhone 16 Pro
  running iOS 18.6. Re-measure it on an iOS major bump before trusting it.
- **iPadOS 26 places the bar at the top.** `TAB_BAR_OCCUPIED_HEIGHT` stays an
  iPhone constant, so the mini player's bottom reservation is vestigial there
  and the window rests 81 points above the screen edge. This is cosmetic and is
  tracked as an iPad follow-up.

## Related

- [Mirror UI must derive geometry from shared exported constants](../design-patterns/mirror-ui-derive-geometry-from-shared-constants.md) — sibling. Deriving from a shared constant protects a reader when the VALUE changes; it gives no protection when the value's MEANING changes.
- [Shared predicate partial rollout gap](shared-predicate-partial-rollout-gap-20260810.md) — sibling. That case is an incomplete rollout, where a call site was missed. This case is a complete rollout whose semantics moved under readers that correctly never used the helper.
- [Contrast floor must be derived over the real compositing stack](contrast-floor-must-be-derived-over-the-real-compositing-stack.md) — the tint constant this tab bar carries, and its one remaining consumer.
