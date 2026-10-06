---
id: "feat-614"
title: "Align Expo patch versions to restore CI"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags: [mobile, infrastructure]
---

## Problem

PR #2578 wakes the Mobile compatibility check through the generated Admin
GraphQL client. Expo's current SDK 57 recommendations have advanced beyond
main's installed patch set. CI run 37528606961 fails before Expo Doctor runs.

## Scope

Apply the exact versions reported by Expo's online compatibility check for the seven reported packages: expo,
expo-asset, expo-constants, expo-linking, expo-notifications, expo-router, and
expo-updates. Update `apps/mobile/package.json` and `pnpm-lock.yaml`, keeping
React, React Native, the SDK line, application code, and CI gates unchanged.
Review required transitive patch changes. This is a separate maintenance PR
from the recommendation implementation; no EAS release or production merge is
authorized here.

## Verification

Require the online Expo compatibility check and pinned isolated Expo Doctor,
Mobile tests, types, lint and build, plus the PR checks. Record the actual
results before completion. Do not bypass the checks or mark an upstream
failure as passing.

The local isolated worktree has no Expo installation. The package manager
regenerates the lockfile without installing into another task’s dependency
tree; clean CI performs the Expo verification.

## Current evidence

- `pnpm install --lockfile-only --frozen-lockfile` passes after regeneration.
- All changed package identities are Expo packages; the only other importer
  change is `apps/auth` re-resolving its existing optional Expo peer graph.
  React and React Native versions are unchanged.
- Standards review: scoped manifest/lockfile changes, normal hooks, CI gates
  unchanged. No finding.
- Spec review: all seven reported package floors aligned. Commit `3b2063d60`
  passed all 26 applicable CI checks, including the online Expo compatibility
  check and Doctor, Mobile tests/lint/build, and the affected Auth and TV
  checks; six checks were correctly skipped. The CI gate passed.
- PR: https://github.com/JesusFilm/forge/pull/2599. Implementation and
  verification are complete; the PR remains unmerged and no binary was
  published.

The ticket is feat-614: the recommendation integration branch reserved feat-612,
and current main independently introduced feat-613 for Push Campaign MCP drafts.
The latter collision was caught by the roadmap advisory on the docs-only follow-up;
all application checks and the CI gate still passed.
