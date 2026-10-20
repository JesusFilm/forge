---
id: "feat-631"
title: "Repeatable TV development and evaluation harness"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-09"
duration: 2
depends_on: []
blocks: []
tags: [tv, developer-experience, testing]
---

## Problem

TV has unit tests and device tools, but development sessions repeatedly reconstruct setup, acceptance and recovery. Disk exhaustion and incomplete simulator evidence must become explicit failed or blocked gates.

## Entry Points — Read These First

- `apps/tv/harnesses/development/HARNESS.md`
- `apps/tv/harnesses/development/EVALUATION.md`
- `apps/tv/package.json`, `apps/tv/CLAUDE.md`
- `docs/plans/2026-10-09-tv-development-harness.md`

## Grep These

`sourceDigest|preflight|runtime:|native-build:|repairAttempts`

## What To Build

Project-local execution/evaluation procedures and a dependency-free Node helper for task initialization, preflight, existing static checks, scope checks and evidence reports. Use the `forge-tv-app` skill when installed, otherwise follow the repository guides. Apple TV defaults to the 4K simulator; Android requires an explicit ADB target. Preserve Native A, native Android playback and hidden Profile.

## Constraints

TV files and directly related documentation only. No new test framework, CI service, package dependency or app runtime changes. No automatic upload, merge, deletion, credential changes, device reset or fabricated runtime success. A task manifest records scope; it does not grant permissions.

## Verification

Run isolated synthetic-repository cases for success, insufficient disk, missing evidence, stale source, out-of-scope edits, unsafe paths, command-like input, tampered artifacts and bounded retries. Run the read-only live preflight and existing checks when dependencies are available. Report fixture validation separately from physical/simulator acceptance of an app change.

Completed: execution/evaluation guides, task/evidence examples, Node helper and 20 passing fixture cases. Live TV static checks passed; live Apple preflight correctly blocked missing local API configuration. Details and evidence: `apps/tv/harnesses/development/VALIDATION.md`. This completion describes the harness, not a native app release.

Imported from SSD commit `5f3dca63a` on 14 October 2026 with all 20 fixture tests and live TV static checks passing. Current app source and pre-existing startup changes were preserved. See the dated integration entry in `VALIDATION.md`.
