---
id: "feat-752"
title: "Consolidate completed TV work into draft PR 2719"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [tv, integration, testing]
---

## Problem

The original TV draft is behind the selected local improvements and completed
Top Shelf follow-ups. The owner explicitly requested updating draft PR 2719,
preserving the latest TV app and development harness.

## Entry Points

- `docs/plans/2026-10-20-tv-draft-consolidation.md`
- `docs/plans/2026-10-19-tv-selected-integration.md`
- `docs/plans/2026-10-19-top-shelf-fresh-content.md`
- `docs/plans/2026-10-20-top-shelf-native-public-feed.md`
- `apps/tv/harnesses/development/HARNESS.md`

## Scope and Verification

Keep the selected 02/07 changes, typography-only 08 and environment-tests-only 12.
Commit the finished foreground/native Top Shelf work, merge latest main locally,
resolve only integration conflicts, verify source preservation and required TV/CI
checks, then update the existing draft through `up-tandem`. Do not re-import
excluded experiments, enable the optional native feed by default, merge to main,
deploy, use production content APIs or test Push. Retain existing release gaps.

Upstream now owns IDs 734–746. Remap the five local TV tickets from 734–738 to
747–751, updating local TV references without changing upstream tickets or older
verification evidence.

## Result

Reviewed Top Shelf work committed as `cb827eedc`; latest main integrated without
source conflicts. Runtime/config/native inputs and ignored private environment
bytes are unchanged. A later CI-only Modal host mock changes one unit-test file;
all of its behavioral assertions are retained. Typecheck, lint, 186 suites / 2,328 Jest tests,
20 harness fixtures, 19 Foundation regressions and patch consistency pass.
The consolidated tree targets existing draft PR 2719 through the connected
`up-tandem` account, with exact remote-tree verification and an
expected-head lease. Publication receipts and current CI state are retained in
`.local-tools/tv-pr-consolidation/`. Player-control/physical-TV/release gates remain
on tickets 749 and 630; this completed consolidation is not release approval.

CI repair: wrap the publication commit message to the repository's 100-character
body-line limit and isolate the Apple Modal native host in its unit suite. The
cold-cache full suite passes 186 suites / 2,328 tests before the guarded retry.
