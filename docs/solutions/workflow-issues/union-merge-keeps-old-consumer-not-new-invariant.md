---
title: "A union merge keeps the branch's old consumer but not main's new rule — audit the invariants main added since the fork"
date: "2026-10-02"
category: "workflow-issues"
module: "cross-cutting git merge of origin/main into a long-lived branch (incident in apps/mobile PlaybackHost feedbackContext)"
problem_type: workflow_issue
component: development_workflow
severity: high
root_cause: missing_workflow_step
resolution_type: workflow_improvement
applies_when:
  - "Merging main into a branch that forked days or weeks earlier and reads shared types or fields"
  - "Main added a field, flag, or doc-comment rule (a gate, a provenance bit, a trust marker) to a type the branch also reads"
  - "A conflict hunk was resolved as a union, keeping the branch's consumer beside main's new code"
  - "The rule lives in a doc comment or a convention, so the type checker cannot enforce it on the branch's code"
  - "The field carries untrusted input (a deep-link seed, user text) toward a sink outside its origin"
symptoms:
  - "The merged head compiles and every test suite passes"
  - "A branch consumer of a shared field ignores a gate that main added after the fork (here `titleFromRecord` on `PlaybackSessionDescriptor`)"
  - "Only a security review of the merge found that a crafted deep-link title could reach a staff Linear ticket"
related_components:
  - "apps/mobile/src/components/watch/PlaybackHost.tsx"
  - "apps/mobile/src/lib/miniPlayer/playbackRequest.ts"
  - "apps/mobile/src/lib/lastWatched/lifecycle.ts"
  - "apps/mobile/src/components/watch/__tests__/PlaybackHost.test.tsx"
tags:
  - "merge"
  - "semantic-conflict"
  - "union-resolution"
  - "invariant"
  - "trust-boundary"
  - "deep-link"
  - "long-lived-branch"
  - "code-review"
---

# A union merge keeps the branch's old consumer but not main's new rule

## Context

PR #2286 (mobile in-app feedback) forked from `main` on 2026-09-14. Its merge
base `6dc1a8fc7` has no `titleFromRecord` field:
`git show 6dc1a8fc7:apps/mobile/src/lib/miniPlayer/playbackRequest.ts | grep -c titleFromRecord`
prints `0`.

Three days later, #2328 (lapse reminders, merged 2026-09-17) added a rule to a
type the branch reads. `PlaybackSessionDescriptor` gained a field and a doc
comment (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:59-63`):

```ts
/** Whether `title` came from the resolved video record rather than from a
 *  deep-link seed. The seed is attacker-controlled, so anything that
 *  PERSISTS or RENDERS the title outside this session must gate on it. */
titleFromRecord: boolean
```

The consumer that #2328 added obeys the rule
(`apps/mobile/src/lib/lastWatched/lifecycle.ts:45`):

```ts
const videoTitle = session?.titleFromRecord ? session.title || null : null
```

The rule itself came from a review finding (session history). The first #2328
design persisted `session.title` and told its reviewers the title was
CMS-authored. A security reviewer showed that `displayTitle` is
`video?.title ?? seed?.title`, so a seed-only page persists deep-link text.
That session made `titleFromRecord` REQUIRED, so the compiler names every
PRODUCER. It gated one CONSUMER, the last-watched writer, and left on-screen
display ungated on purpose. Nothing makes a new consumer read the flag
(session history).

The branch had its own consumer of the same title. In
`apps/mobile/src/components/watch/PlaybackHost.tsx`, the `feedbackContext`
block builds the video that a player-door feedback report names. The branch
wrote it before the rule existed.

The merge of `main` into the branch on 2026-10-02 (made from main's side)
conflicted in `PlaybackHost.tsx`. The hunk held main's progress-identity hold
on one side and the branch's `feedbackContext` block on the other. The two
looked independent, so the resolution kept both. The merged file read the
title with no gate:

```ts
const sessionTitle = request.session?.title ?? null
```

The title then flows to a staff Linear ticket:

- `feedbackContext` goes to `VideoPlayer` (`PlaybackHost.tsx:1982`).
- `VideoPlayer` spreads it into the report's `video`
  (`apps/mobile/src/components/watch/VideoPlayer.tsx:646-648`).
- Admin writes `video.title` as the issue's Video line
  (`apps/admin/src/services/feedback-linear.ts:155`).

So a crafted link such as
`forgemobile://watch/<unknown-slug>?seed={"title":"...","playbackId":"<public id>"}`
plays a seed-only page. No record ever replaces the seed title, and a report
from that page puts the attacker's text on the ticket. Admin escapes markup,
so the result is misleading text, not injection.

Nothing caught it:

- The typecheck passed, because the code reads `title`, a field that still
  exists.
- Every suite passed: 424 suites, 7,743 tests.
- The conflict hunk looked like two separate additions, and the union kept
  both intents.

Only the security reviewer in a scoped `ce-code-review` of the merge (run
`20261002-pr2286-delta`) found it, and the validator confirmed it.

## Guidance

**A union resolution keeps both intents, but it does not apply the later
intent's rules to the earlier code.** When `main` adds an invariant to a type
or field after a branch forks, every branch consumer of that field is
unreviewed against the new rule. The merge is where they meet, and no conflict
marker names the rule.

Before you resolve a merge of a long-lived branch, do these steps:

1. Find the merge base, and list what `main` added since then to the fields
   and types that the branch reads:

   ```bash
   BASE=$(git merge-base HEAD origin/main)
   git log "$BASE"..origin/main -S<fieldName> --format='%h %ad %s' --date=short
   git diff "$BASE" origin/main -- <shared type file>   # read new doc comments and fields
   ```

2. For each new field or doc-comment rule, find every read in the branch's own
   diff:

   ```bash
   git diff "$BASE" HEAD -- <app dir> | grep -n -E '<type or field>'
   ```

3. Check each branch read against each new rule. A rule written as "anything
   that PERSISTS or RENDERS X must gate on Y" names its own audit: every
   branch path that sends X out of the session.
4. Treat a both-sides union in a conflict hunk as two intents that still need
   one rule applied. When one side came from before the rule, apply the rule
   to that side.
5. Pin the rule at the consumer with a test for both sides of the predicate,
   and break the code once to prove the test fails.

## Why This Matters

- The defect sits in code that compiles and passes every test, because a rule
  written as a doc comment has no type that enforces it.
- A required field enforces producers, not consumers. The compiler stops a new
  producer that omits `titleFromRecord`. It does not stop a new consumer that
  reads `title` and ignores the flag (session history).
- A long-lived branch makes the window wide. Here three days was enough for a
  security rule to land on a field the branch read.
- The cost of a miss lands outside the app. Here untrusted link text could
  reach a staff ticket, beside the reporter's name and email.
- Review tools cannot help when the rule exists only as prose. The scoped
  review found this only because its brief told the reviewers to check the
  merge-resolved files against main's newer code.

## When to Apply

- You merge `main` into a branch that is many commits behind, or one that
  forked before a feature touching shared types landed.
- A conflict hunk joins main's code and the branch's code in the same
  function, and the two read the same object.
- `main` added a field whose doc comment states a rule, such as a trust
  boundary, a provenance flag, or a "must gate on" sentence.
- The branch consumes data that can come from untrusted input: deep links,
  seeds, query parameters, or user text.

## Examples

**Before (the merged tree, branch code from before the rule):**

```ts
// KD8: what a player-door report names. From the surface's DESCRIPTOR, not
// the window session, which exists only once a video has earned a window.
const sessionTitle = request.session?.title ?? null
```

**After (the fix in PR #2286, `PlaybackHost.tsx:494-499`):**

```ts
// KD8: a player-door report names the surface's DESCRIPTOR (the window session
// may not exist yet). Only a record title may reach a ticket: a seed title is
// deep-link input, so a seed-only page reports with no video tag.
const sessionTitle = request.session?.titleFromRecord
  ? request.session.title || null
  : null
```

**The pin
(`apps/mobile/src/components/watch/__tests__/PlaybackHost.test.tsx:714-744`):**
the describe block "the player-door feedback context (KD8)" reads the prop
that the real host passes to the real `VideoPlayer`. One case uses a record
title and expects the full video. The other uses `titleFromRecord: false` and
expects `null`. Removing the gate fails the seed case. Dropping the prop fails
both cases.

**The device evidence:** a fake-admin proxy smoke on the iPhone 17 simulator
logged each `SubmitFeedback` request. A report from a record page carried
`video: { title: "The Birth of Jesus", slug: "the-birth-of-jesus", languageSlug: "english", positionSeconds: 68.7 }`.
A report from the crafted seed-only page carried `video: null`, and the sheet
showed no "About:" tag.

The merge and the fix are separate commits on PR #2286, and a squash merge
to `main` joins them into one. To read the merged tree before the fix, run
`git fetch origin pull/2286/head` and find the commit "Merge origin/main into
feat/mobile-feedback-linear". A later merge of `main` on the same day came
after the fix.

## Related

- `docs/solutions/workflow-issues/merge-conflict-region-is-textual-not-semantic.md`
  — the family root: a resolved merge is not a correct merge. Its shapes are a
  convergent aggregate and a mid-syntax hunk, and CI catches both loudly. This
  doc is the silent shape: a contract that main added to a shared field.
- `docs/solutions/workflow-issues/clean-merge-unused-import-removed-vs-new-usage-added.md`
  — the closest analogue: one side changed what is true about a symbol, and
  the other side added a use of it. That failure stops the typecheck; this one
  does not.
- `docs/solutions/best-practices/shared-predicate-partial-rollout-gap-20260810.md`
  — the same root cause inside one PR: a new shared rule reached the call sites
  the PR touched, but not the sibling consumers. This doc is the cross-merge
  form.
- `docs/solutions/workflow-issues/merge-main-into-branch-hook-lints-mains-files-merge-from-main-side.md`
  — the procedure for the same merge (commit it from main's side so the hook
  lints only the PR's files).
- `docs/solutions/workflow-issues/raw-control-byte-makes-a-source-file-binary-and-hides-its-diff.md`
  — the title sanitizer from the same #2328 work, and why seed titles are
  untrusted.
