---
id: "feat-576"
title: "Report new roadmap ticket ID collisions in advisory CI"
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

Roadmap IDs are allocated globally, but parallel documentation PRs can claim
the same number. Existing cross-lane duplicates mean a whole-tree uniqueness
gate would fail unrelated PRs. The hidden-lane CI check does not validate IDs.

## Entry Points — Read These First

1. `CLAUDE.md` and `docs/roadmap/ai-chat/CLAUDE.md` — global allocation rule
   and the historical cross-lane exception.
2. `.github/workflows/ci.yml` — advisory job and required `ci-gate` boundary.
3. `scripts/check-new-roadmap-ids.mjs` — changed ticket comparison against
   the PR base and all current roadmap ticket frontmatter IDs.

## Grep These

`ROADMAP_ID_BASE`, `roadmap-id-collisions-advisory`, `introducedCollisions`.

## What To Build

Add a pull-request check that reports when a newly added or renumbered ticket
uses an ID already present in any roadmap lane. Keep historical duplicates
from failing unrelated PRs. The check may fail visibly but must not be a
dependency of `ci-gate` or a required branch-protection status.

## Constraints

Use ticket frontmatter IDs, not prose references in plans or evidence. Do not
renumber historical tickets as part of this check. Keep RAG and AI Chat lanes
hidden from public roadmap output.

## Verification

Run the checker tests, exercise it against a duplicate-introducing fixture,
check formatting, and confirm the job is absent from `ci-gate` and the active
GitHub ruleset's required checks.

## Resolution

[Forge PR #2489](https://github.com/JesusFilm/forge/pull/2489) adds the
advisory check. A new ID collision exits with failure; existing duplicate
IDs do not fail unrelated PRs. The job is excluded from `ci-gate` and is not
required by the active Main ruleset.
