---
id: "feat-728"
title: "Align Manager dependency triggers and production deployment gates"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [infrastructure, manager, studio, railway, ci]
---

## Problem

The Studio v4 release changes `packages/studio-contracts`, but Manager's live
Railway watch patterns only include `/apps/manager/**` and
`/packages/admin-graphql/**`. This release includes a Manager gateway source
change so the normal main deployment starts. Shared contract changes must trigger
Manager without an incidental source edit.

Manager also has `source.checkSuites: true`. Deployment
`f83ad533-c2b7-4ac4-bccb-c4d3cfc78a68` waits on main commit
`b79a3bc3a8f7d1b0ab3a2238127e80ce6c5383fd` after forge-ci and CodeQL pass,
because unrelated Dependabot run `39103870314` recreates development-tool PR
#2691. It finally succeeds at 07:05 UTC, about 42 minutes after starting, and
Manager deploys successfully at 07:12 UTC. Do not confuse deployment waiting with render capacity or render runtime.

## Entry Points — Read These First

1. `apps/manager/railway.toml` and `apps/manager/CLAUDE.md`: compare checked-in
   settings with the live service before proposing configuration-as-code.
2. `.github/workflows/ci.yml`: affected-package calculation and `ci-gate`.
3. `packages/studio-contracts/package.json` and
   `apps/manager/src/services/studio-render-pool-gateway.ts`: runtime dependency.
4. Railway Forge production Manager service
   `2f325a67-7aae-4160-a111-74b9fde40d05`: inspect live configuration through
   `describe_service`, without variable values.
5. `docs/roadmap/platform/feat-510-expo-patch-ci-recovery.md`: prior unrelated
   check-suite blockage; retain required application and security checks.

## Grep These

`watchPatterns`, `checkSuites`, `ci-gate`, `studio-contracts`, `RAILPACK`, `NIXPACKS`.

## What To Build

Add all necessary shared runtime dependencies to Manager's normal deployment
triggers. Choose one reviewed source of truth without accidentally changing its
current Railpack builder to the stale checked-in Nixpacks setting.

Investigate supported Railway/GitHub ways to require the relevant completed CI
and security checks without waiting on dependency-maintenance jobs unrelated to
release validation. Record the supported mechanism and its failure behavior
before implementing it; an allowlist capability has not been established.

## Constraints

This is a follow-up, not authority to bypass the current release gate. Preserve
PR-to-main production delivery, required CI/security checks and fail-closed
behavior. Do not disable `checkSuites`, cancel an unrelated updater to release
production, manually redeploy, or publish local code as a shortcut. Keep renderer
optimization and AI-host capacity work in feat-725.

## Verification

Require a shared-contract-only reviewed PR to trigger a normal Manager main
rollout. Demonstrate that a failed required check blocks deployment and a passing
release can proceed while an unrelated updater remains active, using a safe test
setup before production. Record actual deployment source/hash and live settings.
