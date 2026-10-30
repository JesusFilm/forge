---
id: "feat-703"
title: "Compare PR CI checks against the tested target baseline"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 1
depends_on: []
blocks: []
tags: ["ci", "roadmap", "infrastructure"]
---

## Problem

PR #2611 checks out a generated merge against current `main`, but commit lint
and the roadmap ID advisory compare against the fixed opening PR base SHA.
After target history is merged into the PR, these checks blame the PR for
already merged commit messages and historical ticket collisions.

## Entry Points — Read These First

1. `.github/workflows/ci.yml` — `commit-lint` and
   `roadmap-id-collisions-advisory` baseline inputs.
2. `scripts/check-new-roadmap-ids.mjs` — compares a baseline tree with the
   checked-out merge tree before classifying introduced ticket IDs.
3. `scripts/check-new-roadmap-ids.test.mjs` — existing collision rules.

## Grep These

`pull_request.base.sha`, `ROADMAP_ID_BASE`, `commit-lint`, `merge-base`.

## What To Build

Resolve the tested target parent from the checked-out GitHub PR merge commit.
Require a two-parent merge whose second parent matches the expected PR head.
Commit lint compares `merge-base(target, head)..head`; the roadmap checker
compares the exact tested target tree to the merged checkout. Cover stale
opening bases, target advances, PR-introduced failures, and invalid checkouts
with temporary git-graph fixtures.

## Constraints

Keep all existing validation rules and the advisory gate boundary. Do not
rewrite main history, rename existing tickets, retarget PRs, add ignorelists,
or modify unrelated CI jobs. Keep the Watch changes in PR #2611 separate.

## Verification

Run the focused Node baseline and roadmap tests, reproduce both original
failures with the old base and success with the corrected baseline, check
formatting, and commit through normal repository hooks. PR #2611 remains
blocked until this separate repair lands and a fresh CI event validates it.

## Sources

- [GitHub PR base behavior](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-base-branch-of-a-pull-request)
  documents that the opening base commit stays fixed when its branch advances.
- [GitHub PR workflow merge behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)
  documents checkout of the generated merge commit.

## Resolution

`scripts/resolve-pr-baseline.mjs` validates the checked-out merge SHA and PR
head before returning the tested target and commit-lint common ancestor. Both
CI jobs use those outputs. Five git-graph/CLI regressions plus the three
existing roadmap tests pass on Node 24.19.0. The old PR #2611 comparison
commands fail locally; the corrected resolver and both checks pass against
its actual `60d3fbc1` target / `65fcbb45` head graph.

Local implementation is complete. PR #2611 still needs this separate CI repair
to land and a fresh workflow event; no existing CI result was changed here.
