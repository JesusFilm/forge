# Mobile-v2 CI Pipeline

**Date:** 2026-04-09
**Status:** Draft
**Scope:** Lightweight

## Problem

The mobile-v2 app (`apps/mobile-v2`) has lint, typecheck, and test scripts defined but the CI workflow doesn't include Expo/React Native-specific health checks. The existing `forge-ci` workflow already runs lint, typecheck, test, and build for any affected `@forge/*` package via Turborepo detection — so the basics are covered. What's missing is Expo SDK-level validation.

## Requirements

### R1: Expo Doctor check

Add a CI job that runs `npx expo-doctor@latest` against `apps/mobile-v2` when the package is affected by the PR. This catches:

- SDK version mismatches between Expo packages
- Deprecated or incompatible dependencies
- Config issues in `app.json`
- React Native version compatibility

### R2: Conditional on mobile-v2 affected

The Expo Doctor job should only run when `@forge/mobile-v2` is in the affected services list (same gating as lint/typecheck/test). No need to run on every PR.

### R3: Non-blocking initially

Expo Doctor should be a **warning-only** step initially (allow failure) since existing dependency drift may cause false positives. Once clean, switch to blocking.

## Non-goals

- EAS build triggers in CI (handled separately via EAS Build)
- Native fingerprint detection (can be added later)
- E2E testing on device/emulator (out of scope for this change)

## Verification

- Open a PR that touches only `apps/mobile-v2` — Expo Doctor job should run
- Open a PR that touches only `apps/web` — Expo Doctor job should NOT run
- Expo Doctor failures should not block the PR (until switched to blocking)
