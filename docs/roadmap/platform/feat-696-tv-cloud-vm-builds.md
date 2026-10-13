---
id: "feat-696"
title: "TV cloud development and macOS VM build evidence"
owner: "ekkasit"
priority: "P1"
status: "blocked"
start_date: "2026-10-13"
duration: 2
depends_on: []
blocks: []
tags: [tv, tvos, infrastructure, testing]
---

## Problem

Develop Forge TV in Codex Cloud and build its generated Expo tvOS workspace on
a trusted macOS VM, returning exact-commit verification through the GitHub API.

## Entry Points — Read These First

- `docs/plans/2026-10-13-tv-cloud-vm-builds.md`
- `apps/tv/CLOUD-VM.md`
- `apps/tv/scripts/cloud-vm/dev.py`
- `.github/workflows/tvos-vm-build.yml`

## Grep These

`VM evidence:|appletvsimulator|HybridBuilder|jest-results|tv-vm-build`

## What To Build

TV-scoped helpers, a trusted-runner workflow, managed prebuild/CocoaPods bootstrap,
and a verifier for the Release Apple TV simulator app, embedded Top Shelf
extension, build result bundle, and optional positive Jest results.

## Constraints

No application behavior changes, mobile changes, signing setup, store upload,
runner replacement, or PR merge. Keep inherited proxies and TLS verification.
Use the existing cloud checkout. Require explicit user direction before merging.

## Verification

Helper regression tests, TV Jest/typecheck/lint, frozen lockfile, native project
generation, clean source, and an actual VM workflow with artifact upload and an
API-readable report. Local checks do not establish VM readiness.

October 13: setup files implemented; 31 Python helper tests, 165 TV Jest suites /
2,116 tests, TV typecheck/lint, repository formatting, managed tvOS prebuild and
Hermes export passed in Cloud. Dependency install passed a repeat run. TV source,
dependency declarations and lockfile are unchanged. Live verification is blocked
by the cloud proxy's denial of `api.github.com`, unverified Forge runner access,
and the new workflow's premerge bootstrap. Do not mark complete until a real VM
run verifies the exact commit and uploads its artifacts. No merge is authorized.
