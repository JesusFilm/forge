---
id: "feat-910"
title: "Include feature flags in the Manager production image"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "infrastructure"
  - "ci"
---

## Problem

PR #1087 head `06c0a6da69f6716a4c0b29fe234c80ae9aef7914` passes the CI gate and all package checks, including Manager and Mastra builds, but Manager production-image job `120774159042` in run `40060965249` fails during Next compilation: `apps/manager/src/lib/enrichment-engine.ts` cannot resolve `@forge/feature-flags`. The Docker stage omits the new workspace dependency. Completed feat-909 remains bounded source acceptance.

## Entry Points — Read These First

1. `apps/manager/Dockerfile` — manifests before frozen install, sources before build, standalone runtime.
2. `packages/feature-flags/package.json` — source export and LaunchDarkly dependency.
3. `apps/manager/verify-production-image.mjs` — network-disabled actual-image startup/access checks.
4. `.github/workflows/manager-security-image.yml` — image build, trust and smoke gates.
5. `docs/plans/2026-10-24-manager-image-workspace-closure-plan.md` — bounded repair and verification.

## Grep These

- `@forge/feature-flags|forge.enrichment.engine`
- `COPY packages|frozen-lockfile|MANAGER_IMAGE_FIXTURE`

## What To Build

Copy the feature-flags manifest before the existing filtered frozen install and its source before Next build. Copy the two JSON inputs imported by `apps/manager/src/lib/enrichment-callback.contract.test.ts`: `docs/fixtures/manager-enrichment-steps.json` and `docs/fixtures/manager-enrichment-callbacks.json`. Include the package and fixture paths in both image workflow triggers and the existing Railway source watch list. Exercise the compiled engine resolver through authenticated `GET /api/admin/engine-flag` in the existing isolated image smoke, expecting the default workflow engine and no override. Preserve 403 denials for this service-only endpoint and existing 401 denials for the other APIs.

## Constraints

Preserve pinned base digests, filtered CA trust, verified FFmpeg and media/TLS checks, frozen dependencies, auth guards, default-off flag/ramp and unimplemented graph. No application behavior change, dependency update, production/provider/DB action, push, merge or deploy. Use the default foreground I/O guard and owned `/mnt` evidence. Do not build on constrained root storage or alter global Docker configuration.

## Verification

Run scoped formatting/lint, dependency-closure inspection, a fresh Manager build and isolated standalone smoke using existing Node 24.22.1/dependencies. Execute a frozen offline filtered install from the existing cache in an owned staged workspace, then build and smoke its actual standalone output. Actual Docker build and unchanged trust/media/production smoke remain required in CI if no safe accessible isolated builder exists locally. Report local limitations separately from parent-provided published-head CI success. Local commit requires fresh parent-owned independent review before publication.

## Implementation result and remaining PR gates

The bounded packaging repair passes a frozen offline filtered install (zero downloads) in the patched Docker workspace file set, real workspace/SDK resolution, Manager build/typecheck and isolated standalone smoke. The complete-checkout build/smoke, eight engine-route tests, scoped lint/format and roadmap checks also pass. The smoke exercises the compiled flag resolver and exact access denials with dummy environment values, without activating flags or calling providers/DBs.

This status records completed implementation, not independent acceptance or image qualification. The default Docker socket is inaccessible, noninteractive sudo is unavailable, and no accessible isolated `/mnt` builder was found; root storage is constrained. Actual image build and existing certificate/native-media checks plus strengthened network-disabled production smoke remain required in CI after parent-owned fresh review/publication. No push, merge, deploy or activation occurred. Private evidence: `pr-triage-20261024-r1/1087-manager-image-r1/`.
