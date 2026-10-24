---
title: "A conflict region is textual, not semantic — audit the aggregates git auto-merged"
date: "2026-08-07"
category: "workflow-issues"
module: "cross-cutting — git merge conflict resolution (apps/auth, apps/mobile)"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
applies_when:
  - "Merging a long-running feature branch after main moved ahead (git merge origin/main, rebase, or the PR update-branch button)"
  - "Both sides independently added one element to the same shared aggregate — a registered-app count, a seed registry, a total, an enum, a switch table, a fixture list"
  - "Resolving conflicts as a union (keep both sides, strip the three marker lines)"
  - "An assertion or constant naming a count sits adjacent to a conflict hunk but was not itself marked"
  - "A conflict hunk ends mid-block, with the closing brace of the last kept element living after the >>>>>>> marker"
symptoms:
  - "A marker-free, clean-looking resolved file still fails CI on a count assertion"
  - "Both sides changed a count from the merge base to the SAME value, so git silently auto-merged a total that is wrong for the merged tree"
  - '"TS1005: ''}'' expected" after a mechanical strip-the-markers union resolution'
  - "git status is clean and git diff shows no markers, yet the merged aggregate never equalled either side's value"
related_components:
  - "apps/auth/src/scripts/seed-first-party-apps.ts"
  - "apps/auth/src/scripts/seed-first-party-apps.test.ts"
  - "apps/mobile/src/lib/__tests__/authHeaders.test.ts"
tags:
  - "merge-conflicts"
  - "git"
  - "diff3"
  - "shared-aggregate"
  - "silent-auto-merge"
  - "union-resolution"
  - "seed-registry"
  - "typecheck-gate"
---

# A conflict region is textual, not semantic — audit the aggregates git auto-merged

## Context

Merging `origin/main` (46 commits ahead) into the long-running feature branch
`worktree-feat-mobile-login-continue-watching` (PR #1876 — mobile login plus
cross-device continue watching, spanning `apps/mobile`, `apps/auth`,
`apps/admin`). Merge was chosen over rebase to keep the PR's review history
intact.

Eight files conflicted:

```
apps/auth/src/auth/config.ts                        (2 hunks)
apps/auth/src/domain/apps.ts                        (6 hunks)
apps/auth/src/domain/apps.test.ts                   (2 hunks)
apps/auth/src/scripts/seed-first-party-apps.test.ts (1 hunk)
apps/auth/src/services/app-registry.service.test.ts (1 hunk)
apps/mobile/src/lib/apolloClient.ts                 (1 hunk)
apps/mobile/src/lib/__tests__/authHeaders.test.ts   (2 hunks)
pnpm-lock.yaml                                      (16 hunks)
```

The cause was uniform and benign. `main` had landed a TV app seed (an RFC 8628
device-grant client: `TV_APP_SEED`, `deviceGrantPlugin`, `TV_DEFAULT_SCOPES`,
`TV_DEVICE_CLIENT_IDS`) into exactly the file positions where this branch had
added the mobile app seed (`MOBILE_APP_SEED`, `mobileAppleCredentialPlugin`,
`MOBILE_DEFAULT_SCOPES`). Both additions are independent, so every resolution was
a union rather than a choice — see `apps/auth/src/auth/config.ts:257-258` (both
plugins registered) and `apps/mobile/src/lib/apolloClient.ts:12-16` (both import
sets kept). The lockfile was resolved by taking main's copy and re-running
`pnpm install`, not hand-merged.

Two things nearly shipped wrong, and neither was inside a conflict marker.

## Guidance

**The conflict region is a textual artifact of the diff algorithm, not the
semantic region of the merge.** Resolving every marker correctly is necessary and
not sufficient. Two shapes are systematically invisible to marker-based review:

**1. Convergent edits to a shared aggregate.** When both branches add one element
to the same collection, each side independently produces the _same_ new count.
Git sees identical text, has nothing to mark, and auto-merges it — leaving a value
that is correct for one branch instead of correct for both.

**2. Hunks that cut mid-syntax.** A conflict region can open a block on both sides
while the closing delimiter sits _after_ the `>>>>>>>` marker, shared by both.
Mechanically keeping both sides then duplicates the opener without duplicating the
closer.

Concrete practices:

- After resolving every marker, diff the result against **both** parents —
  `git diff HEAD -- <file>` and `git diff MERGE_HEAD -- <file>` — instead of only
  re-reading the regions that were marked. What each parent is missing is the
  actual review surface.
- Prefer `git merge --no-commit` and review the whole staged diff. Marker-by-marker
  resolution is structurally blind to everything git auto-merged.
- Grep each resolved file for aggregates near the conflict: counts, totals,
  `.length` assertions, registry arrays, enumerated key lists, exhaustive switch
  statements.
- Ask per conflicted file: _did both branches add to the same collection, and if
  so, what derived value counts that collection?_
- Verify a derived count by **running the producer**, not by recomputing it by
  hand. The arithmetic and the code can both be wrong; only the code ships.
- Run typecheck **before** tests. A mid-syntax resolution surfaces as a parse
  error, and a test suite that fails to parse contributes zero failing _tests_ — so
  the test count alone can look healthy.

## Why This Matters

Both failure modes produce a file with **zero conflict markers that looks fully
resolved**.

The aggregate case is the more dangerous one, because nothing about the file
signals a problem. In `apps/auth/src/scripts/seed-first-party-apps.test.ts` the
merge base had 6 registered apps; HEAD added mobile (7), main added tv (7). Both
sides read `apps: 7` byte-identically, so git auto-merged it while marking only
the `environments` / `oauthClients` lines below it. The merged tree has **eight**
apps. Deleting the three marker lines and picking one side would have produced a
clean-looking file that fails CI on a number nobody edited.

Here CI caught it, because the aggregate happened to live in a test assertion.
**That is luck, not a safety net.** The same convergent auto-merge on an aggregate
in _production_ code — a registry length, a seeded total, an exhaustiveness count,
a capacity constant — has no assertion watching it and ships silently.

The mid-syntax case at least fails loudly — but only if you look at the right
signal. In this merge it reported as `Test Suites: 1 failed, 100 passed` with
`Tests: 1390 passed`: the broken suite never parsed, so it contributed no failing
test. A green-looking test count next to a single suite failure is easy to skim
past. Typecheck named it precisely:

```
src/lib/__tests__/authHeaders.test.ts(173,1): error TS1005: '}' expected.
```

## When to Apply

- Any merge of a long-running branch, where both sides have been adding to the
  same registries, config lists, or plugin arrays.
- Any conflict in a file that contains a count, total, or enumerated list — seed
  scripts, registry modules, fixture builders, snapshot tests.
- Any conflict where both branches were adding a _sibling_ of the same thing (a
  second app seed, a second plugin, a second describe block). Union resolutions are
  exactly the case where the aggregate silently stays one-branch-correct.
- Any conflict inside a test file: hunk boundaries frequently cut between
  `describe` blocks and their closing delimiters.

## Examples

### The dangerous change outside the markers

Mid-merge, the seed test looked like this:

```ts
// admin 4 + manager 4 + web 4 + mastra-studio 4 + chat 2 + admin-mcp 5 +
// tv 4 = 27 environments; oauthClients adds the 4 manager session-service
// clients on top.
await expect(seedFirstPartyApps()).resolves.toEqual({
  apps: 7,
<<<<<<< HEAD
  environments: 25,
  oauthClients: 29,
=======
  environments: 27,
  oauthClients: 31,
>>>>>>> origin/main
})
```

`apps: 7` sits above the marker. Both branches wrote it; neither wrote the
combined value.

Deriving the true totals: main's own comment states its total is 27 including
`tv 4`, so the merge base is 23. HEAD's 25 is base + mobile 2. Combined is
23 + 4 + 2 = **29 environments**, `oauthClients` is environments + the 4 manager
session-service clients = **33**, and `apps` is **8**.

That arithmetic was then checked against the real seeder rather than trusted:

```bash
pnpm --filter @forge/auth test -- \
  src/domain/apps.test.ts \
  src/scripts/seed-first-party-apps.test.ts \
  src/services/app-registry.service.test.ts
# 31 tests green
```

The resolved assertion, at `apps/auth/src/scripts/seed-first-party-apps.test.ts:53-61`:

```ts
// admin 4 + manager 4 + web 4 + mastra-studio 4 + chat 2 + admin-mcp 5 +
// mobile 2 + tv 4 = 29 environments; oauthClients adds the 4 manager
// session-service clients on top.
await expect(seedFirstPartyApps()).resolves.toEqual({
  apps: 8,
  environments: 29,
  oauthClients: 33,
  scopes: 21,
})
```

The producer it counts, at `apps/auth/src/domain/apps.ts:577-586`:

```ts
export const FIRST_PARTY_APP_SEEDS = [
  ADMIN_APP_SEED,
  MANAGER_APP_SEED,
  WEB_APP_SEED,
  MASTRA_STUDIO_APP_SEED,
  CHAT_APP_SEED,
  ADMIN_MCP_APP_SEED,
  MOBILE_APP_SEED,
  TV_APP_SEED,
] satisfies RegisteredAppSeed[]
```

### The marker boundary that was not the syntactic boundary

Hunk 2 of `apps/mobile/src/lib/__tests__/authHeaders.test.ts` cut mid-block. HEAD
added `describe("isProgressOperation gate", ...)`; main added
`describe("RecordWatchSearchEvent rides without the fleet bearer", ...)`. Both
sides' final `it(...)` shared the same trailing `})\n})` sitting _after_ the
`>>>>>>>` marker. Deleting the three marker lines and keeping both sides left
HEAD's last `it` unclosed.

The fix was reinstating the two closing lines between the describes
(`apps/mobile/src/lib/__tests__/authHeaders.test.ts:148-153`):

```ts
  })
})

// The event mutation is public fire-and-forget telemetry; a bearer on it would
// spend the fleet key's per-device search budget once per tap (KTD6).
describe("RecordWatchSearchEvent rides without the fleet bearer", () => {
```

### The check that catches both

```bash
# Both parents are missing something; only diffing against each shows what
# git auto-merged outside the markers.
git diff HEAD       -- apps/auth/src/scripts/seed-first-party-apps.test.ts
git diff MERGE_HEAD -- apps/auth/src/scripts/seed-first-party-apps.test.ts

# Typecheck first: an unparseable suite fails as a SUITE, not as a test.
pnpm --filter @forge/mobile typecheck
```

The merge landed on the branch as `chore: merge origin/main into mobile login +
continue watching`, whose message records the union resolutions and the
`apps 7 -> 8` correction. PR #1876 was `MERGEABLE / CLEAN` with 42/42 checks green
at time of writing; it is not merged to `main`.

## Related

- [Resolving a main-merge conflict on a migrated route](launchdarkly-watch-route-migration-conflict-resolution-20260528.md)
  — the complement: a conflict git _did_ mark, resolved the wrong way. Together
  these cover both halves of merge risk (marked-and-mishandled, unmarked-and-wrong).
- [A clean, marker-free merge can still not compile](clean-merge-unused-import-removed-vs-new-usage-added.md)
  — the third shape: no conflict region exists at all. One side removes an import
  as unused, the other adds a new use in a different hunk; git merges silently and
  only typechecking the merged head catches it.
- [Turborepo's affected gate hides type errors between PRs](turborepo-affected-gate-hides-type-errors-between-prs.md)
  — same moment in the workflow (a main-merge breaking something the PR's own diff
  never touched), different mechanism: CI gating rather than git auto-merge.
- [gh pr checks --watch silently passes on an unmergeable PR](gh-pr-checks-watch-silent-pass-on-unmergeable-pr.md)
  — the mergeability gate immediately upstream of this one.
- [Mocked-shape vs real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — checklist item 10 (a pin bounded to a region catches edits inside it and nothing
  at its boundaries) is the shared abstraction behind the mid-syntax case, in a test
  carrier rather than a merge one. This learning is deliberately **not** an instance
  of that META: there the artifact is green while production is broken, whereas here
  the test goes red and the false signal is git's own "no markers left".
- [PR extraction stash collision](../developer-experience/pr-extraction-stash-collision-20260424.md)
  — the other "git did something plausible and no marker told you" case.
