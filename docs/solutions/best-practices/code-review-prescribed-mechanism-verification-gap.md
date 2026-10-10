---
title: A code-review finding can be correct while its prescribed fix names a mechanism this app does not have
date: 2026-09-08
category: best-practices
module: apps/mobile
problem_type: best_practice
component: development_workflow
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
applies_when:
  - "Applying a ce-code-review (or any LLM-generated review) finding that names a specific import, package, or test API as the fix"
  - "A reviewer describes the prescribed mechanism as already present -- 'already a transitive dependency', 'six comparable hooks already do this' -- without citing where"
  - "The prescribed fix reaches for the ecosystem-default mechanism for a problem class in a monorepo whose apps do not all share that stack"
  - "Marking a review finding applied before checking that its suggested module or test harness resolves in this app"
related_components:
  - apps/tv
  - apps/chat
tags:
  - ce-code-review
  - code-review
  - llm-review
  - mechanism-verification
  - monorepo
  - pnpm
  - expo-router
  - react-native
related:
  - docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md
  - docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md
  - docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md
  - docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md
---

# A code-review finding can be correct while its prescribed fix names a mechanism this app does not have

## Context

`ce-code-review` ran on branch `feat/mobile-search-result-previews` before PR
#2194 (open and unmerged at the time of writing). Per that run's own report,
eleven reviewer personas produced 27 findings, thirteen survived dedup, an
independent validator batch confirmed twelve, and all twelve were fixed. Those
counts come from the run rather than from the tree, and its artifacts were
temporary. The three cases below are the durable part.

Three of those reviewer suggestions named a MECHANISM that `apps/mobile` does
not have. In two of the three the accompanying FINDING was correct and worth
fixing. The reviewers read the diff correctly and then reached for the
ecosystem-default answer they know from general training, not for the answer
this checkout carries.

A review comment is two different products in one paragraph. The finding comes
from the diff in front of the reviewer. The prescription comes from the
reviewer's priors. The two need different levels of trust. Trust the finding
and re-derive the prescription from the tree.

## Guidance

Treat every named mechanism in a review comment as a claim to verify, not as an
instruction to apply. Three checks settle almost every case. Run them before
you write the fix.

**1. Can THIS app import the package?** Presence in the store is not access.
pnpm links each app in isolation, so a package can sit in
`node_modules/.pnpm/` and still be unimportable.

```bash
node -e "try{console.log(require.resolve('@react-navigation/native',{paths:['./apps/mobile']}))}catch(e){console.log('UNRESOLVABLE:',e.code)}"
```

An `ls node_modules/<pkg>` is not this check. It misses the `.pnpm` store, so
it can report absent for a package that is present, and present for one this
app still cannot import.

**2. Does the module export the symbol?** Read the type entry point. Do not
infer it from the package name.

```bash
grep -n "useIsFocused" apps/mobile/node_modules/expo-router/build/exports.d.ts
```

**3. Is the idiom used in THIS app, or only in a sibling app?** Scope the grep
to the app you are editing. A repo-wide grep hides the boundary that matters,
and a repo-wide "no matches" hides the sibling that does have it.

```bash
git grep -n "reactStrictMode" -- apps/mobile   # zero matches
git grep -n "reactStrictMode" -- apps/chat     # matches: a real idiom, wrong app
```

When a check fails, keep the finding and replace the mechanism. When the
finding's own premise fails a check, drop the finding -- see Example 3.

## Why This Matters

A wrong prescription costs a build, not a review round. Applying suggestion 1
verbatim produces a module that does not resolve. Applying suggestion 2
verbatim produces a test suite that cannot run. Both failures arrive after the
code is written, so the cost is the whole edit plus the diagnosis.

The failure mode is quiet in a monorepo. This repo holds several apps with
different frameworks, different test stacks, and different major versions of
the same package. A prescription that is correct for one app reads as correct
for all of them. Two of the three cases below were exactly that: a real repo
idiom borrowed across an app boundary.

Discarding the finding is the opposite error and is more expensive. All three
findings named real behaviour in the diff. Two of them shipped fixes. A team
that learns "reviewers are unreliable" loses the diagnosis, which is the part
the reviewer generated from evidence.

The verifier can make the same class of error in the opposite direction. While
checking case 1 for this document, an `ls ../../node_modules/@react-navigation/native`
run from inside `apps/mobile` reported the package absent, and a `grep` for
`reactStrictMode` run from the same directory reported zero matches repo-wide.
Both readings were too narrow, and both happened to support the conclusion.
Scope the check to the question: "is this mechanism resolvable from this app",
not "does this string exist somewhere".

## When to Apply

Apply this whenever a review comment names any of the following:

- An import path or package name not already open in the diff.
- A testing API, render option, or helper.
- A claim about what is already a dependency or already transitive.
- A claim that other files in the app already do this.

Apply it with extra care in a pnpm monorepo, and whenever the named package
exists at more than one major version across apps. `apps/mobile` runs
`expo-router@57`, `apps/tv` runs `expo-router@6`. The two majors have
different dependency graphs, so a true statement about one app is a false
statement about the other.

Skip it when the comment names a symbol the diff itself already imports. That
mechanism is on screen and needs no lookup.

## Examples

### 1. `@react-navigation/native` -- wrong on two independent axes

**Finding (correct).** The preview cycle keeps running and keeps fetching Mux
previews after the Search tab loses focus. `expo-router` Tabs keeps a blurred
screen mounted, so nothing stops the pass.

**Prescription (wrong).** Three personas (`security`, `reliability`,
`correctness`) proposed
`import { useIsFocused } from "@react-navigation/native"`, described as
"already a transitive dependency of expo-router".

**What the tree says.** `@react-navigation/native` (version 7.2.2) does exist
in the pnpm store under `node_modules/.pnpm/`, pulled in by `apps/tv`. That
store path is untracked, so it will not appear in a repo-path search. It is unresolvable from BOTH
apps -- `require.resolve` returns `MODULE_NOT_FOUND` for `./apps/mobile` and
for `./apps/tv`. Separately, `apps/mobile`'s `expo-router@57` declares no
react-navigation dependency at all. It vendors the code. The prior was
version-stale (true for `expo-router@6`, false for `expo-router@57`) and would
have failed under pnpm's isolated linking even if it had been current.

`docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md`
independently found this same vendoring and warns that treating the standalone
package as authoritative "will eventually give a confidently wrong answer".
This is that answer.

**Fix as shipped.** `apps/mobile/app/(tabs)/watch.tsx:12` imports
`useIsFocused` from `expo-router`, verified against that package's own type
entry point at `build/exports.d.ts:20` (inside `node_modules`, untracked). Line 637 calls it, and line 646 folds it
into the hook's existing `enabled` argument. The hook itself was not changed.

### 2. RTL `reactStrictMode` -- a real idiom from the wrong app

**Finding (correct).** The new stateful hook shipped with no StrictMode suite.
That violates a rule stated in the root `CLAUDE.md`.

**Prescription (wrong for this app).** `project-standards` proposed a suite
using React Testing Library's `reactStrictMode: true` render option, and
asserted that six comparable hooks in the app already carry such a suite.

**What the tree says.** `reactStrictMode` has zero matches under `apps/mobile`.
It does match under `apps/chat`, which depends on `@testing-library/react`.
`apps/chat/package.json` is the only manifest in the repo listing any
`@testing-library` package, and `@testing-library/react-native` is not
installed anywhere. So the prescription was a genuine repo idiom, borrowed
across an app boundary where the dependency does not exist. The likely source
is `docs/solutions/logic-errors/react-strictmode-remount-safety-hook-lifetime-refs.md`,
where that option is correct.

**The repo's real idiom.** `apps/mobile` hand-rolls `renderHook` and wraps the
rendered ELEMENT in `<StrictMode>`. See
`apps/mobile/src/hooks/__tests__/useBibleVerses.test.tsx:139`, and
`apps/mobile/src/test-utils/rnTestRenderer.ts`, which resolves
`react-test-renderer` through `jest-expo` so no new test dependency is added.
The distinction is load-bearing and `apps/mobile/CLAUDE.md` states it: wrapping
the ELEMENT doubles the effect cycle, while a wrapper OPTION doubles
initializers only.

**Fix as shipped.** An 11-case suite at
`apps/mobile/src/components/search/__tests__/useSearchPreviewCycle.test.tsx`,
written in the element-wrap idiom with `strict` defaulting to true. One case is
`"arms exactly one chain under a StrictMode remount"`.

### 3. `wifiOnly` -- the premise itself was wrong

**Prescription and finding (both rejected).** `performance` proposed threading
the app's existing `wifiOnly` preference into the preview gate. The review's
own independent validator batch rejected it.

**What the tree says.** `wifiOnly` is downloads-scoped. It defaults to `false`
at `apps/mobile/src/lib/watchPreferences.ts:36`, and
`apps/mobile/src/contexts/WatchPreferencesProvider.tsx` exposes five setters,
none of them for `wifiOnly`. No user can turn it on today. Its only readers are
`DownloadsProvider.tsx` and `downloadEngine.ts`. No playback surface consults
it, including Home's autoplaying hero.

**Why this case is different.** In cases 1 and 2 the finding was sound and only
the mechanism needed replacing. Here the finding's premise was false, so
nothing survived the check. This is the case that justifies running the checks
before writing code rather than after: the same two minutes of verification
either corrects a mechanism or cancels the work entirely.

## Related

- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
  -- the complement. There the reviewer was wrong at the DIAGNOSIS layer
  (a bug that was not there); here the diagnosis was right and the
  PRESCRIPTION was wrong.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
  -- the sibling failure from the same review, where new code hand-rolled a
  predicate the repo already shipped.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  -- the parent law: verify against the real producer, not an assumed shape.
  This document applies it to review output.
- `docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md`
  -- already documents that `expo-router` vendors its own navigation copy.
- `docs/solutions/workflow-issues/ce-code-review-tier-2-mandatory-before-push-20260511.md`
  -- when to run the review that produces these comments.
