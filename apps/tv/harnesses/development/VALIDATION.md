# Harness validation — 9 October 2026

Implementation branch: `codex/tv-development-harness`, based on main `77f6563ed`. This change affects development tooling and TV documentation; app behavior and native players are unchanged.

## Verified

- 20 synthetic cases passed using temporary Git repositories, including real CLI process routing through a synthetic Corepack executable. Cases cover successful completion, previous dirty work, scope violations/deletion/commits, stale source and build configuration, acceptance-contract changes, missing/tampered evidence, traversal/symlinks, command-like input, oversized JSON, target checks and repair limits.
- Live helper execution passed TV typecheck, lint, Jest and formatting, using Node `v24.21.0` and pinned pnpm `9.12.3`. Dependencies were linked from the existing offline store with no downloads or lockfile changes.
- Read-only live Apple preflight identified the available Apple TV 4K simulator on tvOS 26.5. It correctly reported `blocked` because `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` is blank in the seeded local configuration. The simulator was shut down; the harness did not boot it or claim runtime acceptance.
- Fixture tests use fake tooling only in their isolated repositories. The live static-check run used the actual installed Forge dependencies. Raw command output and environment values are absent from generated reports.

## Evidence

Generated, ignored run directory:

`apps/tv/test-results/development-harness/harness-validation-ffff1d3f-f1ab-4d70-814c-db27b0827475/`

It contains `state.json`, `fixture-tests.tap`, `runtime-preflight.json`, `evidence.json` and the evaluator's `report.json`. The source/environment fingerprint for this run is `7ddc343c4004510c9f91e8d8b134f5dc3591b4763205f58a3337fbf4af26a062`; the report includes instruction and harness digests. Reports are local evidence, not uploaded artifacts.

## Limits

No new native build, simulator UI walkthrough, Chromecast run or release was necessary to validate this tooling change. Actual app tasks still require their declared native/runtime/performance gates and a named judge inspecting the evidence. Runtime execution in this checkout requires the correct TV environment configuration first.

For a new chat, read `HARNESS.md`, create a task manifest, and run `start` from the intended Forge checkout. The helper may be invoked by absolute path from this worktree; it checks the caller's working directory and prints the selected repository.

## Import validation — 14 October 2026

Imported only commit `5f3dca63a370b871f518daa8528bce05f2aa2941` from
`/Volumes/BACKUP/Projects/forge-dev-container`, branch
`codex/tv-development-harness`, into the current checkout at `388638ddd`.
The original helper, fixture files and tests were retained. The guide now treats
the external `forge-tv-app` skill as optional when it is not installed.

- All 20 harness fixture tests passed on Node `v24.19.0`.
- Live harness checks passed TV typecheck, lint, Jest and formatting using
  Corepack `0.36.0` and the repository's pinned pnpm `9.12.3`.
- SHA-256 comparison against the pre-import working tree confirmed that existing
  tracked TV files changed only in `package.json` (two harness scripts) and
  `CLAUDE.md` (the harness pointer). The current TV app, Top Shelf integration,
  native players and pre-existing startup fixes were preserved.
- Read-only runtime preflight recognized the 4K tvOS 27 simulator. It remains
  blocked by the harness's required `EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN`, which
  is unset here. This is stricter than the app's public-search fallback; the
  import does not weaken the original harness's runtime requirements.
- No native rebuild or new runtime acceptance was needed for this tooling-only
  import. The earlier October 9 evidence above is historical, not a claim of
  fresh device verification.

Local integration report:
`apps/tv/test-results/development-harness/ssd-harness-import-46e26fed-351c-4792-8fa5-1265a3b9a9dd/`.
A machine-local launcher at `.local-tools/tv-harness.sh` supplies this Mac's
Node/Corepack paths and cached pnpm; use `bash .local-tools/tv-harness.sh help`
from the repository root. It leaves generated reports in the ignored run directory.
