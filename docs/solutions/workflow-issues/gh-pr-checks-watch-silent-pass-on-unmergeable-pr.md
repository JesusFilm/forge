---
title: "gh pr checks --watch exits green on a conflicted PR while the full CI roster never registers"
category: "workflow-issues"
module: "CI / gh pr checks (mergeability gate)"
date: "2026-07-21"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "high"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
applies_when:
  - "A PR branch has fallen behind origin/main and has an unresolved merge conflict (mergeable=CONFLICTING / mergeStateStatus=DIRTY)"
  - "Automation or an agent waits for CI via `gh pr checks --watch` (or polls check-runs) before treating a PR as ready to merge"
  - "The repo's CI mixes pull_request-triggered workflows (build/lint/test/format/commit-lint/expo-doctor/affected/patched-deps-guard) with checks that analyze the PR head ref directly (e.g. GitHub-managed default-setup CodeQL scanning) on the same PR"
symptoms:
  - "`gh pr checks <PR> --watch` reports only a handful of checks (e.g. 4: Analyze actions / Analyze javascript-typescript / Analyze python / CodeQL) and exits 0, all green"
  - "A long poll (e.g. 30 minutes) keeps seeing the same small check count with 0 pending, never converging on the repo's normal ~14-15 check roster"
  - "A comparable recently-merged PR shows a much larger check roster than the PR currently being watched"
  - "`gh pr view --json mergeable` returns CONFLICTING but nothing in the checks output surfaces that as the reason CI is incomplete"
tags:
  - "ci"
  - "github-actions"
  - "gh-cli"
  - "pull-request"
  - "merge-conflict"
  - "codeql"
  - "wait-for-ci"
  - "mergeability"
---

# gh pr checks --watch exits green on a conflicted PR while the full CI roster never registers

## Context

PR #1637 ("feat(mobile): rebuild Library tab as an offline downloads manager") was opened from the long-lived branch `feat/mobile-library-redesign` against `main` after `origin/main` had advanced. The branch conflicted with `main` in `apps/mobile/src/lib/__tests__/normalizeVideo.test.ts` — both sides had appended a different test block at the same insertion point: main's PR #1623 hls-trim regression tests and the branch's parentSeries tests. GitHub's merge button showed the PR as unmergeable.

Despite the conflict, `gh pr checks 1637 --watch` registered only 4 checks — `Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)`, `CodeQL` — all passed, and the watch exited 0. A follow-up 30-minute poll at 30-second intervals kept observing "4 checks, 0 pending": the repo's real CI workflow (`affected`, `build (@forge/mobile)`, `commit-lint`, `expo-doctor`, `format`, `lint (@forge/mobile)`, `patched-deps-guard`, `test (@forge/mobile)`, plus the admin drift jobs) never registered a single check run against the conflicted head. For comparison, PR #1623's roster shows the expected ~14-check set.

## Guidance

Before waiting on CI for any PR, gate on mergeability first — a small/incomplete roster from an unmergeable PR is not "still running," it's "never started":

```
gh pr view <n> --json mergeable,mergeStateStatus
```

- `mergeable: "MERGEABLE"` + `mergeStateStatus: "CLEAN"` -> safe to wait on checks normally.
- `mergeable: "CONFLICTING"` (mergeStateStatus `"DIRTY"`) -> the branch has merge conflicts with the base. `pull_request`-triggered CI will not run at all. Resolve conflicts first — do not wait longer.
- `mergeStateStatus` can also read `BLOCKED` (mergeable but a required check/review is missing) or `BEHIND` (mergeable but base has moved) — neither of those blocks `pull_request` CI the way `DIRTY` does, but they're still worth surfacing before trusting a "done" report.
- `mergeable: "UNKNOWN"` -> GitHub hasn't finished computing mergeability yet; re-check shortly rather than trusting either a red or a green state.

Second, sanity-check roster size against a recent merged PR before trusting a green `gh pr checks` exit:

```
gh pr checks <this-pr>
gh pr checks <a-recent-merged-pr>
```

If the target PR's roster is a strict subset of the reference PR's roster (e.g. 4 checks vs. ~14), treat it as "CI did not run," never "CI passed" — regardless of what `--watch` reports, since `--watch` only waits on checks that are already registered.

Resolving looks like: merge (or rebase onto) the base branch, resolve the conflicting hunks (here: keep both test blocks — the resolution doesn't require picking a side when the conflict is two independent additions at the same location), verify locally (typecheck, full test suite, lint), and push the merge/resolution commit. Then re-run `gh pr view --json mergeable,mergeStateStatus` and `gh pr checks` again — the roster should grow to the full expected set before the green result is trustworthy.

Concretely for PR #1637: `git merge origin/main`, resolved `normalizeVideo.test.ts` by keeping both added test blocks, verified locally (typecheck, 951 jest tests, lint), then pushed the conflict-resolution merge commit to PR #1637.

## Why This Matters

This is a silent-pass verification mechanism: the guard (`gh pr checks --watch` reporting success) goes green while the real thing (the repo's actual CI — test/lint/build/format) never ran at all. `gh pr checks --watch` only waits on checks that are _registered_; on an unmergeable PR the `pull_request`-triggered workflows are never created (GitHub can't build the test-merge ref to run them against), so the tool has nothing to wait for and exits 0 on whatever partial roster does exist — here the CodeQL family, GitHub's default-setup code scanning, which is not defined in `.github/workflows/*.yml` (its runs report event `"dynamic"`) and analyzes the PR head ref directly, so it needs no merge ref. A human skimming "4/4 checks passed" or an automation whose "wait for CI to finish" step trusts a clean `--watch` exit is misled into believing the PR is validated when it is not — even though GitHub's own merge button is correctly blocked by the conflict.

This is a specific instance of the repo's documented META pattern — see root CLAUDE.md's "Mocked-vs-real testing discipline (META)" entry and `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: every gated-completion signal needs at least one check that can only pass when the real path ran, otherwise a degenerate/empty case (here: zero registered `pull_request` checks) satisfies the "success" signal vacuously.

## When to Apply

- Any "wait for CI to finish" step in an automation (a `/pr` command, a merge-queue bot, a CI-gate script) that calls `gh pr checks` or `gh pr checks --watch` and treats a clean exit as "safe to proceed."
- Any PR opened from a branch that has been long-lived relative to `main` — the longer the branch has diverged, the likelier a conflict has crept in since the branch was cut.
- Any check roster that looks thin relative to what the repo normally runs for that app/package — before reporting "CI passed," compare against a recent comparable PR's roster.
- Immediately after opening or re-pushing to a PR, before relying on any CI-derived judgment about it.

## Examples

**Before (conflicted, PR #1637):** `gh pr checks 1637 --watch` registered and passed only:

```
Analyze (actions)               pass
Analyze (javascript-typescript) pass
Analyze (python)                pass
CodeQL                          pass
```

Watch exited 0 — read naively as "CI passed" — while the PR was `CONFLICTING`/`DIRTY` and none of `affected`, `build (@forge/mobile)`, `commit-lint`, `expo-doctor`, `format`, `lint (@forge/mobile)`, `patched-deps-guard`, `test (@forge/mobile)`, or the admin drift jobs had ever run. PR #1623, a recently merged comparable PR, shows the expected full roster of 14 checks — the mismatch in count is what should have flagged the partial roster as suspicious.

**After (resolved, PR #1637):** once the conflict-resolution merge commit was pushed to PR #1637, `gh pr view 1637 --json mergeable,mergeStateStatus` returns:

```
{"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}
```

and `gh pr checks 1637` shows the full 15-check roster (14 substantive checks plus a Railway preview deploy), all passing — including `affected`, `build (@forge/mobile)`, `commit-lint`, `expo-doctor`, `format`, `lint (@forge/mobile)`, `patched-deps-guard`, and `test (@forge/mobile)`, with `admin-graphql-generate`/`admin-schema-drift` correctly showing `skipping` (mobile-only change, no admin schema touched). Only once the roster matched the reference shape (PR #1623) was the green result trustworthy.

## Related

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the META home for silent-pass verification shapes; this doc is the CI/gh-CLI instance (a candidate row for its worked-instances table).
- `docs/solutions/workflow-issues/new-app-package-name-must-be-forge-scoped-for-ci.md` — sibling lesson: CI green because the app was never selected, not because it passed.
- `docs/solutions/workflow-issues/turborepo-affected-gate-hides-type-errors-between-prs.md` — sibling lesson: a green aggregate is not a whole-roster guarantee under affected-set gating.
- `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md` — same discipline for tool success-shaped responses: verify via an independent read path.
- No related GitHub issues found (four keyword searches on 2026-07-21).
