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

1. `.github/workflows/ci.yml` — advisory job and `ci-gate` boundary.
2. `scripts/check-new-roadmap-ids.mjs` and its tests — changed ticket
   comparison and collision reporting.
3. [PR #2485](https://github.com/JesusFilm/forge/pull/2485) and
   [PR #2489](https://github.com/JesusFilm/forge/pull/2489) — the observed
   event order.

## Grep These

`roadmap-id-collisions-advisory`, `ROADMAP_ID_BASE`, `introducedCollisions`.

## What To Build

Keep the advisory PR check, and run the same job on main pushes. On main,
compare the current tree with the commit that first introduced the checker,
so a later push still reports unresolved collisions from an older PR merge.
Report each collided ID once. Keep the job outside `ci-gate` and do not require
reruns or block merges.

## Constraints

Grandfather collisions already present when the checker first merged. Use
roadmap ticket frontmatter IDs, not ID mentions in prose. Do not renumber
existing tickets in this CI change.

## Verification

Run unit and format checks. Against current main, the baseline comparison
must report `feat-575` and `feat-576` once each and exit nonzero. A PR with no
new ticket ID must pass. Verify the job has no `ci-gate` dependency.

## Resolution

[Forge PR #2498](https://github.com/JesusFilm/forge/pull/2498) extends the
advisory job to main pushes. Local comparison against the checker-introduction
commit reports the merged `feat-575` and `feat-576` collisions once each.
