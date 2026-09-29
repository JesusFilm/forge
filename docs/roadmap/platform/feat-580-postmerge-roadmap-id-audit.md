---
id: "feat-580"
title: "Audit roadmap ID collisions after stale PRs merge"
owner: "jaco"
priority: "P2"
status: "complete"
start_date: "2026-09-30"
duration: 1
depends_on: []
blocks: []
tags: ["roadmap", "ci"]
---

## Problem

PR #2485 introduced duplicate `feat-575` and `feat-576` tickets after its
last CI run. That run started before the advisory checker merged. GitHub did
not rerun the PR workflow on the base-branch update, and the advisory job was
PR-only, so main never reported the collision.

## Entry Points — Read These First

1. `.github/workflows/ci.yml` — PR advisory job and `ci-gate` boundary.
2. `.github/workflows/roadmap-id-postmerge.yml` — independent main-push audit.
3. `scripts/check-new-roadmap-ids.mjs` and its tests — changed ticket
   comparison and collision reporting.
4. [PR #2485](https://github.com/JesusFilm/forge/pull/2485) and
   [PR #2489](https://github.com/JesusFilm/forge/pull/2489) — the observed
   event order.

## Grep These

`roadmap-id-collisions-advisory`, `ROADMAP_ID_BASE`, `introducedCollisions`.

## What To Build

Keep the advisory PR check. Add a separate workflow for every main push.
Compare that push with its immediate predecessor,
without cancellation or a growing fixed-baseline diff. Report each collided ID
once. Keep both jobs outside `ci-gate` and do not require reruns or block merges.

## Constraints

Grandfather collisions already present before each push. Use roadmap ticket
frontmatter IDs, not ID mentions in prose. Do not renumber existing tickets in
this CI change. This prospective check cannot retroactively run for PR #2485.

## Verification

Run unit and format checks. Against the actual #2485 merge commit and its
immediate predecessor, the checker must report `feat-575` and `feat-576` once
each and exit nonzero. A PR with no new ticket ID must pass. Verify the
post-merge workflow has no cancellation and neither job is in `ci-gate`.

## Resolution

[Forge PR #2498](https://github.com/JesusFilm/forge/pull/2498) adds the
independent main-push workflow. A local comparison of PR #2485's merge commit
with its immediate predecessor reports `feat-575` and `feat-576` once each.
