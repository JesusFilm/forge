# Manager production image workspace closure repair

Scope: PR #1087 only, starting from published head `06c0a6da69f6716a4c0b29fe234c80ae9aef7914`; accepted source `567a83e8066028dc6c4ba0bd9065c1335331084f` remains an ancestor. Track implementation in feat-910; feat-909 is complete.

## Plan and bounded design

The full monorepo package builds pass while the hand-staged Docker workspace omits `@forge/feature-flags`. The smallest complete repair supplies its manifest before the existing recursive filtered frozen install and its source before build. Its only runtime external dependency is the already-locked LaunchDarkly Node SDK; it has no further workspace dependency. A real staged build then exposed two omitted callback contract JSON fixtures required by the existing TypeScript include set. Supply those exact files rather than relaxing typechecking. Existing Next standalone tracing packages the compiled server. No generated types, lockfile, runtime feature-selection behavior, media binaries or trust settings need changes.

1. Verify clean local head, branch, remote and accepted-source ancestry; read failed job logs and prior packets.
2. Add feature-flags to both Docker COPY phases, both image workflow path filters and the existing Railway source watch list. Copy `docs/fixtures/manager-enrichment-steps.json` and `docs/fixtures/manager-enrichment-callbacks.json` before build, with matching watch paths. Extend actual-image smoke to read the real compiled resolver with a synthetic service bearer and absent flag configuration, alongside denial checks.
3. Reuse Node/dependencies for a fresh Manager build and standalone smoke. Then execute an offline frozen filtered install from the existing cache in the exact staged Docker workspace, build and smoke it independently of the full checkout. Inspect storage and builder accessibility before any Docker build; keep explicit image qualification if no safe accessible `/mnt` builder exists.
4. Review the exact bounded diff, run format/lint/roadmap/hooks checks, capture durable learning, commit locally and return a fresh independent-review brief. Update only #1087 private queue/checkpoint. Parent owns CI watch and later publication.

## Constraints and acceptance

Default I/O guard for every heavy command; all new substantial evidence/cache/temp under the owned `1087-manager-image-r1` directory on `/mnt`. No cleanup, data moves, global daemon changes, install unless necessary, Corepack download, new agents or schedules. Preserve CA filtering, base pin, verified FFmpeg, image workflow gates, auth/run/admission controls and default-off/unimplemented Phase 1 graph. Package-build success does not certify the production container.

## Compound workflow

No callable Compound Engineering skill/workflow is installed in this session. This explicit plan, bounded implementation, self-review and linked solution record the equivalent plan/work/review/compound steps; fresh independent acceptance remains with the parent.

## Verification result and review boundary

The source worktree build/smoke and eight engine-route tests pass. The independent staged workspace's frozen offline filtered install adds 1,055 packages from the existing cache with zero downloads and an unchanged lockfile; its real SDK resolution, Manager build/typecheck and standalone smoke pass after including the two JSON fixtures. The failed intermediate staged build is retained as evidence of that second omission. Initial smoke assertion expected 401 for the service-only engine endpoint; the corrected smoke preserves its existing 403 and all prior exact 401 assertions.

Docker discovery found only an inaccessible default socket; noninteractive sudo is unavailable and no accessible isolated `/mnt` builder was found. No actual Docker build was attempted. Root storage had about 28 GiB free versus 874 GiB on the owned `/mnt` filesystem. Preserve the actual Docker build, trust/media verification and network-disabled smoke gates for exact-candidate CI; the parent's published-head package-build successes close the previous package gap only. feat-910 implementation is complete, with fresh independent acceptance and publication reserved to the parent.

Durable learning extends `docs/solutions/build-errors/pnpm-patched-dependencies-filtered-docker-install-20260611.md`: validate the exact staged filesystem through install, build and compiled runtime, including typechecked test fixtures, rather than inferring image closure from full-checkout package checks.
