---
date: 2026-04-01
topic: mobile-secrets-cleanup
---

# Mobile App Secrets & Dev Scripts Cleanup

## Problem Frame

The mobile Expo app has three env/DX issues:

1. **`.env.production` overrides local dev secrets on real devices.** Expo's `@expo/env` loads `.env.production` when `NODE_ENV=production` (which Metro sets for device builds). The `fetch-secrets` script writes to `.env`, which has lower priority than `.env.production`. Developers hit "Network Request Error" because production URLs override their local Strapi.
2. **No CI preview pipeline.** When a PR is opened, there's no automated EAS Update to push a preview build with production secrets baked in. Reviewers can't test on-device without manual steps.
3. **Missing ergonomic dev scripts.** Developers want `pnpm emulator` and `pnpm device` as clear entry points for simulator vs real device workflows. Current scripts (`fresh`, `real-device`) exist but don't match the desired names or behavior.

## Requirements

- R1. **`fetch-secrets` writes to `.env.local`, remove other env files** — Change the Doppler fetch script to output to `.env.local` instead of `.env`. Delete `.env.production` — production secrets belong only in EAS Environments. Delete `.env` (no base file; developers must run `fetch-secrets`). Update `.env.example` to document the new flow. `.env.ci` stays as-is for GitHub Actions.
- R2. **CI runs EAS Update on PR (mobile changes only)** — Add a job to the existing `ci.yml` that runs on every push to a PR branch targeting `main`. It runs `eas update --channel preview` using production secrets sourced from EAS Environments (set in the Expo dashboard), not from Doppler. The job should depend on existing lint/test/build jobs passing first. The job must only run when the PR touches `apps/mobile/` or `packages/graphql/` (use a path filter action like `dorny/paths-filter`). Setup: generate an Expo access token from expo.dev, add it as `EXPO_TOKEN` GitHub Actions secret.
- R3. **`pnpm emulator` launches Expo dev server for simulators** — Runs `expo start` (interactive mode). Developer presses `i` for iOS simulator or `a` for Android emulator via Expo's standard menu. No auto-cache-clear. A variant `pnpm emulator:fresh` clears Metro cache (`expo start --clear`).
- R4. **`pnpm device` launches Expo for real devices** — Keeps the existing `real-device.mjs` interactive script (device detection, press `i` or `a`). Rename the `package.json` script from `real-device` to `device`.

## Success Criteria

- Running `pnpm fetch-secrets` in `apps/mobile/` writes to `.env.local`, and local dev works on both simulators and real devices without `.env.production` interference
- Opening a PR triggers an EAS Update to the `preview` channel with production secrets from EAS Environments
- `pnpm emulator` starts the Expo dev server with interactive platform selection; `pnpm emulator:fresh` clears cache
- `pnpm device` starts the interactive real-device launcher for connected physical devices
- No `.env.production` file exists in the project; production secrets live exclusively in EAS Environments

## Scope Boundaries

- **Not changing the env validation schema** — `src/env.ts` with `@t3-oss/env-core` + Zod is already correct
- **Not changing EAS build profiles** — `eas.json` development/preview/production profiles stay as-is
- **Not adding new environment variables** — Same vars, just fixing where they come from
- **Not touching the web app or CMS** — Mobile-only changes

## Key Decisions

- **`.env.local` over `.env` for Doppler output**: `.env.local` has higher priority than `.env.production` in `@expo/env`'s load order, solving the override bug at the root
- **Remove `.env.production` entirely**: Production secrets belong in EAS Environments only. A local `.env.production` is a footgun that causes the exact bug we're fixing
- **EAS Update (not EAS Build) for PR preview**: OTA JS updates are fast and sufficient for previewing code changes. Native changes still require a full EAS Build
- **Add job to existing `ci.yml`**: Keeps all CI in one place, with the EAS Update job gated on lint/test/build passing

## Dependencies / Assumptions

- EAS Environments are configured in the Expo dashboard with production `EXPO_PUBLIC_*` values
- `EXPO_TOKEN` must be generated from expo.dev and added as a GitHub Actions repository secret (manual setup step)
- The existing `preview` channel and EAS Update infrastructure are already set up (per `eas.json` and `app.json` `updates.url`)

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Does the CI runner need `eas-cli` installed globally, or can it use `npx eas-cli`? Check what EAS recommends for GitHub Actions
- [Affects R2][Technical] Should the EAS Update job run on every push to the PR branch, or only on PR open/ready-for-review?
- [Affects R3][Technical] Should `pnpm emulator` also kill any running simulator instances first (like `fresh` does with `xcrun simctl terminate`)?
- [Affects R4][Technical] Should the root `package.json` alias be updated from `real-device` to `device` to match?

## Next Steps

-> `/ce:plan` for structured implementation planning
