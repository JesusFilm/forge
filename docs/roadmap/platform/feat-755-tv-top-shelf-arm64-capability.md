---
id: "feat-755"
title: "Declare ARM64 capability in the Top Shelf extension"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [tv, tvos, distribution, top-shelf]
---

## Problem

Apple server validation rejected tvOS build 1.0.0 (14) with ITMS-90502:
`org.jesusfilm.forgewatch.TopShelf` contains only ARM64 code but its Info.plist
omits `UIRequiredDeviceCapabilities`. The containing app already declares ARM64.

## Entry Points — Read These First

- `apps/tv/top-shelf/Info.plist`: canonical extension metadata.
- `apps/tv/plugins/withTopShelf.js`: generates Debug and Release extension plists.
- `apps/tv/plugins/withTopShelf.test.js`: generated native configuration coverage.
- `apps/tv/DISTRIBUTION.md`: validate tvOS with Apple before upload.
- `docs/plans/2026-10-21-tv-top-shelf-arm64-capability.md`.

## Grep These

`UIRequiredDeviceCapabilities|arm64|extensionInfo|ITMS-90502`

## What To Build

Declare `arm64` in the canonical extension capability array. Verify that real
plugin output retains the requirement in both Debug and Release.

## Constraints

Keep bundle identifiers, versions, signing assets, App Group and runtime behavior
unchanged. Do not patch a signed IPA or generated native source as the fix.
Do not upgrade unrelated dependencies or exercise production content APIs.

## Verification

Run focused plugin tests, lint, formatting, TypeScript and clean iOS prebuild.
Inspect generated extension plists. A newly signed device IPA must separately
pass Apple server validation before TestFlight upload; local metadata checks
alone do not establish release acceptance.

## Result

The canonical extension now declares ARM64. The generated-plist regression failed
on the original template and passed after the fix. Both plugin/native-source
suites pass (43 tests); TV TypeScript, changed-test ESLint and formatting pass.
A clean iOS prebuild emitted `UIRequiredDeviceCapabilities: [arm64]` in both
extension plists without changing app package metadata or feed defaults.

This closes the source packaging defect. A new signed IPA and Apple server
validation remain required in the separate beta release workflow; build 14 is
retained as rejected evidence and was not uploaded.
