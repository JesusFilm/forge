---
title: "Align Mobile Expo SDK 57 patch dependencies"
type: "chore"
date: "2026-08-21"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
owner: "edmonday"
---

# Align Mobile Expo SDK 57 patch dependencies

## Goal Capsule

- **Objective:** Mobile passes Expo Doctor against the supported SDK 57 dependency set so unrelated affected PRs are not blocked by registry patch drift.
- **Means:** Use Expo's supported install alignment workflow for only the nine reported packages, regenerate the pnpm lockfile, and validate the Mobile package. (KTD1)
- **Authority:** The user's explicit nine-package scope and isolation constraints override broader dependency-update opportunities.
- **Stop conditions:** Stop if Expo requires an SDK, React, React Native, Better Auth, or other package change outside the named nine, or if validation exposes a behavioral migration rather than patch alignment.
- **Execution profile:** One focused Mobile PR based on `main`; no feat-401 content changes in that PR and no direct deploy.
- **Tail ownership:** Land through the normal PR-to-main review and CI path, then update PR #1978 from the merged `main`.

## Product Contract

### Summary

Align the nine Expo SDK 57 patch dependencies currently reported by Expo Doctor without changing Mobile behavior or broadening the Better Auth prerequisite PR.

### Problem Frame

Expo Doctor reads current SDK recommendations and now reports nine patch mismatches on `main`. Because affected CI includes Mobile validation when the lockfile changes, the drift blocks PR #1978 even though its Auth work does not change the Mobile manifest.

### Requirements

- R1. Update only `@expo/metro-runtime`, `expo`, `expo-build-properties`, `expo-constants`, `expo-dev-client`, `expo-file-system`, `expo-linking`, `expo-router`, and `expo-updates` to Expo's supported SDK 57 patch versions.
- R2. Use Expo's supported install/alignment command rather than hand-selecting package versions.
- R3. Regenerate `pnpm-lock.yaml` through pnpm and preserve all unrelated package versions.
- R4. Expo Doctor, Mobile tests, lint, typecheck, and build checks pass.
- R5. Ship in a separate Mobile PR and merge through the normal PR-to-main process.
- R6. After merge, update PR #1978 from `main` and verify its complete CI suite, including `expo-doctor` and `ci-gate`, is green.

### Scope Boundaries

- Do not modify feat-401 code, plans, or roadmap files in the Mobile PR.
- Do not change the Expo SDK major/minor line beyond SDK 57, or upgrade Better Auth, React, React Native, or packages outside R1.
- Do not weaken or exclude Expo Doctor checks.
- Do not deploy directly or merge PR #1978.

## Planning Contract

### Key Technical Decisions

- KTD1. **Let Expo select the exact patches for the named packages.** Run `npx expo install` from `apps/mobile` with exactly the nine R1 package names, then audit the manifest importer and transitive lockfile movement. This follows Expo's compatibility metadata without allowing the global `--fix` workflow to mutate unrelated dependencies. Governs R1-R3.
- KTD2. **Treat validation drift as a stop, not scope permission.** Any additional required package or behavioral change gets reported rather than folded into this PR. Governs R1, R4-R5.

### Implementation Constraints

- Follow `apps/mobile/CLAUDE.md` and root roadmap/PR rules.
- Preserve exact dependency range style used by the existing manifest.
- Do not hand-edit generated lockfile entries.

## Implementation Units

### U1. Align Expo patches

- **Goal:** Produce the minimal supported SDK 57 manifest and lockfile update.
- **Requirements:** R1-R3.
- **Files:** `apps/mobile/package.json`, `pnpm-lock.yaml`, `docs/roadmap/platform/feat-402-mobile-expo-sdk57-patch-alignment.md`, `docs/roadmap/README.md`.
- **Approach:** Create the roadmap ticket, run Expo's alignment workflow with the nine explicit package names, inspect the manifest and causally required lockfile movement, then verify a clean frozen install.
- **Test scenarios:** Expo Doctor reports no version or duplicate-native-package issues; a clean frozen install succeeds.
- **Verification:** `pnpm install --frozen-lockfile` and `npx expo-doctor apps/mobile` pass.

### U2. Validate and ship Mobile

- **Goal:** Prove the patch-only update is behaviorally neutral and land it independently.
- **Requirements:** R4-R5.
- **Dependencies:** U1.
- **Files:** No additional production files expected.
- **Approach:** Run Mobile test, lint, typecheck, build, and a non-deploying Expo export for iOS and Android; review the final diff; open and babysit the focused PR; merge only after required checks are green.
- **Test scenarios:** Existing Mobile unit/integration tests remain green, package checks complete without new warnings, and Expo produces both platform bundles into disposable output.
- **Verification:** `pnpm --filter @forge/mobile test`, `lint`, `typecheck`, and `build` pass; disposable `EXPO_NO_DOTENV=1 expo export --platform ios` and `--platform android` runs succeed; GitHub required checks pass.

### U3. Unblock feat-401

- **Goal:** Refresh PR #1978 from the merged Mobile baseline and prove the original blocker is gone.
- **Requirements:** R6.
- **Dependencies:** U2 merged to `main`.
- **Files:** No intended feat-401 file changes beyond the branch update merge commit.
- **Approach:** Use GitHub's normal update-branch/main integration path without rebasing or force-pushing, then monitor the full PR suite.
- **Test scenarios:** `expo-doctor` and `ci-gate` pass on the refreshed feat-401 head; existing Auth and consumer checks remain green.
- **Verification:** PR #1978 reports a terminal green required-check set and remains unmerged for human review.

## Verification Contract

- `pnpm install --frozen-lockfile`
- From `apps/mobile`, `npx expo-doctor@1.20.1` (the exact CI command).
- `pnpm --filter @forge/mobile test`
- `pnpm --filter @forge/mobile lint`
- `pnpm --filter @forge/mobile typecheck`
- `pnpm --filter @forge/mobile build`
- Non-deploying `EXPO_NO_DOTENV=1 expo export` runs for `--platform ios` and `--platform android` write successfully to disposable directories outside the repository.
- Repository formatting and diff checks pass.
- Mobile PR required checks are green before merge; PR #1978 required checks are green after updating from `main`.

## Definition of Done

- U1-U3 verification results are observed and recorded.
- The Mobile PR contains only the named patch alignment, lockfile, plan, and roadmap bookkeeping.
- The Mobile PR is merged through GitHub's normal PR-to-main path with no direct deployment.
- PR #1978 is updated from merged `main`, has green `expo-doctor` and `ci-gate`, and remains unmerged.
- No abandoned dependency experiments, Expo Doctor exclusions, or feat-401 scope expansion remain.
