---
title: "chore: Clean up mobile secrets handling and dev scripts"
type: chore
status: active
date: 2026-04-01
origin: docs/brainstorms/2026-04-01-mobile-secrets-cleanup-requirements.md
---

# chore: Clean up mobile secrets handling and dev scripts

## Enhancement Summary

**Deepened on:** 2026-04-01
**Sections enhanced:** 4 (CI job, env migration, scripts, security)
**Research agents used:** EAS Update best practices, Expo SDK 54 docs, security sentinel, code simplicity reviewer, institutional learnings

### Key Improvements

1. **Security fix**: Shell injection vulnerability in CI step — PR title must flow through `env:`, not direct `${{ }}` interpolation
2. **`--environment preview` flag required**: `--channel` does NOT auto-select the EAS Environment on SDK 54. Must pass both `--channel preview --environment preview`
3. **Fork PR guard**: Added same-repo check to prevent secret exposure from fork PRs
4. **Simplified `fetch-secrets`**: Dropped over-engineered error handling block per simplicity review
5. **Preview subaction**: Use `expo/expo-github-action/preview@v8` for automatic QR code PR comments

### New Considerations Discovered

- EAS "secret" visibility variables are NOT available during `eas update` — only during `eas build`. Strapi tokens must use "sensitive" or "plain text" visibility in EAS Environments.
- `expo export` forces `NODE_ENV=production` regardless of what you set — do not rely on `NODE_ENV` for environment switching
- The existing `skipValidation: !!process.env.CI && !process.env.EAS_BUILD` guard means CI skips env validation. The EAS Update job must ensure `EXPO_PUBLIC_*` values come from `--environment preview` (server-side), not from local files.

---

## Overview

The mobile Expo app's env file setup causes `.env.production` to override local dev secrets on real devices (due to `@expo/env`'s load priority), has no CI pipeline for EAS Update previews, and lacks ergonomic `emulator`/`device` scripts. This plan fixes all three.

## Problem Statement

1. **`.env.production` overrides local dev** -- `@expo/env` loads `.env.production` when `NODE_ENV=production` (set by Metro for device builds). `fetch-secrets` writes to `.env`, which has lower priority. Developers get "Network Request Error" on real devices.
2. **No EAS Update in CI** -- PRs have no automated preview builds. Reviewers must manually build to test on-device.
3. **Missing dev scripts** -- Developers want `pnpm emulator` and `pnpm device` as clear entry points.

## Proposed Solution

Four changes (see origin: `docs/brainstorms/2026-04-01-mobile-secrets-cleanup-requirements.md`):

- **R1**: `fetch-secrets` writes to `.env.local` (highest priority in `@expo/env`). Delete `.env` and `.env.production`. Update `.env.example`.
- **R2**: Add `eas-update` job to `ci.yml`, gated on `@forge/mobile` in Turbo's `affected` output. Runs `eas update --channel preview --environment preview`. Production secrets from EAS Environments dashboard.
- **R3**: Add `pnpm emulator` (`expo start`) and `pnpm emulator:fresh` (`expo start --clear` with process kill).
- **R4**: Rename `real-device` script to `device` in both mobile and root `package.json`.

## Technical Considerations

### `@expo/env` Load Priority (highest to lowest)

```
.env.[mode].local  →  .env.local  →  .env.[mode]  →  .env
```

When `NODE_ENV=production` (Metro on real devices):

- `.env.local` (from Doppler) beats `.env.production` -- **this is the fix**
- CI keeps copying `.env.ci` to `.env` -- unchanged, still works

### Research Insights: `@expo/env` Behavior

- `expo start` defaults `NODE_ENV=development`
- `expo run:ios` / `expo run:android` also default to `development` for the Metro bundler portion
- `expo export` **forces** `NODE_ENV=production` regardless of what you set
- Expo docs explicitly recommend against using `NODE_ENV` to switch between `.env` files

### CI `affected` Detection

The existing `affected` job (`.github/workflows/ci.yml:37`) runs `turbo ls --affected --output=json` and outputs a `services` JSON array. The EAS Update job can use:

```yaml
if: contains(fromJson(needs.affected.outputs.services), '@forge/mobile')
```

This includes transitive changes (e.g., `packages/graphql` changes that affect mobile). This is desirable since the JS bundle includes graphql code (see origin: R2 specifies `apps/mobile/` or `packages/graphql/`).

### EAS Update Channel & Environment

- **Channel**: `preview` -- matches the `eas.json` preview profile. Controls which builds receive the update.
- **Environment**: `preview` -- controls which EAS Environment variables are injected during bundling. **These are independent flags that must both be passed explicitly.**
- **SDK 54 behavior**: Without `--environment`, `eas update` falls back to local `.env` files. In SDK 55+, `--environment` becomes required. Pass it now for correctness and forward-compatibility.
- **Secret visibility**: EAS "secret" variables are NOT available during `eas update` — only during `eas build`. The `EXPO_PUBLIC_STRAPI_TOKEN` in EAS Environments must use "sensitive" or "plain text" visibility, not "secret".
- **Draft PRs**: Skip -- add `github.event.pull_request.draft == false` condition to avoid noise
- **Concurrency**: The existing workflow-level `cancel-in-progress: true` handles rapid pushes

### Migration Safety (from SpecFlow analysis)

- Developers with an existing `.env` file: `fetch-secrets` should `rm -f .env` before writing `.env.local` to prevent stale config
- Developers with `.env.production`: Document manual deletion in PR description (file is gitignored, can't be removed via commit)
- Verify `.env.local` is covered by `.gitignore` (it is — `.env.*` glob matches `.env.local`, and `!.env.ci` / `!.env.example` exclusions don't affect it)
- Verify `!.env.ci` exemption still works after any `.gitignore` changes: `git check-ignore -v apps/mobile/.env.ci`

## Acceptance Criteria

- [ ] `pnpm fetch-secrets` in `apps/mobile/` writes to `.env.local`, deletes stale `.env` if present
- [ ] Local dev works on simulators and real devices without `.env.production` interference
- [ ] `.env.example` documents the `.env.local` flow and EAS Environments for production
- [ ] CI `eas-update` job runs on PR pushes when `@forge/mobile` is affected, skips non-mobile PRs
- [ ] CI `eas-update` job skips draft PRs and fork PRs
- [ ] CI `eas-update` step uses `env:` for PR title (no shell injection)
- [ ] `pnpm emulator` starts Expo dev server (interactive mode)
- [ ] `pnpm emulator:fresh` kills running instances and starts with `--clear`
- [ ] `pnpm device` launches the real-device interactive script
- [ ] Root `package.json` aliases updated (`emulator`, `device`)
- [ ] No `.env.production` file in the project
- [ ] EAS Environment `preview` uses "sensitive" (not "secret") visibility for `EXPO_PUBLIC_STRAPI_TOKEN`

## Implementation Phases

### Phase 1: Env File Migration (R1)

**Files to modify:**

#### `apps/mobile/package.json`

Update `fetch-secrets` script:

```json
"fetch-secrets": "rm -f .env && doppler secrets download --project forge-mobile --config dev --format env --no-file > .env.local"
```

Key changes:

- Output redirects to `.env.local` instead of `.env`
- `rm -f .env` first to clean up stale files from old convention
- No elaborate error handling needed — if Doppler fails, it prints its own error and exits non-zero. Shell redirect truncates `.env.local` before writing, so no partial file risk.
- TODO: Remove the `rm -f .env` prefix after the team has migrated (~ 1 month)

#### `apps/mobile/.env.production`

Delete this file. Production secrets belong exclusively in EAS Environments dashboard.

#### `apps/mobile/.env`

Delete this file. It was the old Doppler output target. Developers must run `fetch-secrets` to get `.env.local`.

#### `apps/mobile/.env.example`

Update header comments to reflect new flow:

```bash
# Expo environment variables for @forge/mobile
# ---------------------------------------------
# Local dev: pull secrets from Doppler
#   pnpm fetch-secrets
#   (writes to .env.local — highest priority, gitignored)
#
# EAS builds: env vars come from EAS Environments (expo.dev dashboard)
#   Preview    -> "preview" environment
#   Production -> "production" environment
#
# New to the project? If you don't have Doppler access, copy this file
# to .env.local and fill in values manually.
```

#### Verification steps

```bash
# Confirm .env.local is gitignored
git check-ignore -v apps/mobile/.env.local
# Confirm .env.ci exemption still works
git check-ignore -v apps/mobile/.env.ci
# Should show "not ignored" for .env.ci
```

### Phase 2: Dev Scripts (R3, R4)

**Files to modify:**

#### `apps/mobile/package.json`

Add new scripts and remove old ones:

```json
"emulator": "expo start",
"emulator:fresh": "xcrun simctl terminate booted org.jesusfilm.forgeexpo 2>/dev/null; adb shell am force-stop org.jesusfilm.forgeexpo 2>/dev/null; expo start --clear",
"device": "node scripts/real-device.mjs"
```

- `emulator` -- standard `expo start`, developer presses `i` or `a`
- `emulator:fresh` -- preserves kill behavior from current `fresh` script, then starts with `--clear`
- `device` -- same as current `real-device`, just renamed
- Remove `fresh` and `real-device` scripts (no backwards compat needed for internal tools)

#### `package.json` (root)

Update/add aliases:

```json
"emulator": "pnpm --filter @forge/mobile emulator",
"device": "pnpm --filter @forge/mobile device"
```

Remove old `real-device` alias.

### Phase 3: CI EAS Update Job (R2)

**File to modify:** `.github/workflows/ci.yml`

Add new job after the existing `build` job:

```yaml
eas-update:
  name: EAS Update (Preview)
  runs-on: ubuntu-latest
  needs: [affected, lint, test, build]
  if: >-
    github.event_name == 'pull_request' &&
    github.event.pull_request.draft == false &&
    github.event.pull_request.head.repo.full_name == github.repository &&
    contains(fromJson(needs.affected.outputs.services), '@forge/mobile')
  permissions:
    contents: read
    pull-requests: write
  defaults:
    run:
      working-directory: apps/mobile
  steps:
    - uses: actions/checkout@v4

    - uses: pnpm/action-setup@v4

    - uses: actions/setup-node@v4
      with:
        node-version-file: .node-version
        cache: pnpm

    - run: pnpm install --frozen-lockfile

    - uses: expo/expo-github-action@v8
      with:
        eas-version: latest
        token: ${{ secrets.EAS_UPDATE_INTEGRATION_TOKEN }}

    - name: Publish EAS Update
      uses: expo/expo-github-action/preview@v8
      with:
        command: >-
          eas update
          --channel preview
          --environment preview
          --message "$EAS_MESSAGE"
          --non-interactive
        working-directory: apps/mobile
      env:
        EAS_MESSAGE: "PR #${{ github.event.pull_request.number }}: ${{ github.event.pull_request.title }}"
```

**Key details:**

- `needs: [affected, lint, test, build]` -- only runs after all checks pass
- **Fork guard**: `github.event.pull_request.head.repo.full_name == github.repository` prevents fork PRs from accessing `EAS_UPDATE_INTEGRATION_TOKEN`
- **Shell injection prevention**: PR title flows through `env:` block, not direct `${{ }}` interpolation in the `run:` command
- **`--environment preview`**: Explicitly selects the preview EAS Environment for `EXPO_PUBLIC_*` values. Without this, SDK 54 falls back to local `.env` files (which don't exist in CI)
- **`--channel preview`**: Routes the update to builds on the preview channel
- **Preview subaction**: `expo/expo-github-action/preview@v8` posts a QR code comment on the PR for easy on-device testing
- **`permissions: pull-requests: write`**: Required for the preview subaction to post PR comments
- **`--non-interactive`**: Prevents EAS CLI from prompting in CI

### Research Insights: EAS Update in CI

**What `eas update` does:**

- Runs Metro bundler locally on the CI runner to produce the JS bundle + assets
- Uploads the bundle to EAS Update servers
- Tags the update with the runtime version from your `runtimeVersion` policy
- Does NOT compile native code

**Compatibility check:**

- `eas update` publishes successfully even if no compatible build exists on the channel
- If no build with matching runtime version exists, the update is orphaned (silent failure from CI perspective)
- Your `app.json` uses `"runtimeVersion": { "policy": "sdkVersion" }` — runtime version = Expo SDK version string. This is stable across JS-only changes.
- **Prerequisite**: A native build must exist on the `preview` channel before OTA updates are receivable

**Secret variable visibility:**

- EAS "secret" visibility variables are NOT available during `eas update` — only during `eas build`
- `EXPO_PUBLIC_STRAPI_TOKEN` must use "sensitive" or "plain text" visibility in the EAS Environments dashboard
- "Sensitive" means the value is write-only (not readable in the dashboard after creation) but available during bundling

### Manual Setup Steps (not automatable)

1. **Generate `EAS_UPDATE_INTEGRATION_TOKEN`**: Go to expo.dev > Account Settings > Access Tokens > Create a Robot user with the **Developer** role. Expo tokens are not scoped per-channel — the CI workflow hardcodes `--channel preview` as the only protection.
2. **Add to GitHub**: Repo Settings > Secrets and variables > Actions > New repository secret > Name: `EAS_UPDATE_INTEGRATION_TOKEN`
3. **Verify EAS Environments**: In expo.dev dashboard, ensure the `preview` environment has:
   - `EXPO_PUBLIC_GRAPHQL_URL_ANDROID` = `https://cms.jesusfilm.org/graphql`
   - `EXPO_PUBLIC_GRAPHQL_URL_IOS` = `https://cms.jesusfilm.org/graphql`
   - `EXPO_PUBLIC_STRAPI_TOKEN` = production token (**visibility: "sensitive", NOT "secret"**)
   - `EXPO_PUBLIC_WEB_BASE_URL` = `https://www.jesusfilm.org/watch`
4. **Ensure a preview build exists**: `eas update` only works if a compatible native build exists on the `preview` channel. If none exists, run `eas build --profile preview --platform all` first.
5. **Developer migration**: After merging, developers should:
   - Delete `apps/mobile/.env` and `apps/mobile/.env.production` from their local machines
   - Run `pnpm fetch-secrets` to create `.env.local`

## Dependencies & Prerequisites

- `EAS_UPDATE_INTEGRATION_TOKEN` must be created and added to GitHub Actions secrets (manual)
- EAS Environments must have production `EXPO_PUBLIC_*` values configured with correct visibility (manual)
- A native build must exist on the `preview` channel for OTA updates to work
- `expo/expo-github-action@v8` is a new CI dependency

## Security Considerations

From security review:

1. **Shell injection (Fixed)**: PR title in `eas update --message` must flow through `env:` block, never direct `${{ }}` interpolation. The plan uses `env: EAS_MESSAGE:` approach.
2. **Fork PR guard (Added)**: `github.event.pull_request.head.repo.full_name == github.repository` prevents fork PRs from accessing `EAS_UPDATE_INTEGRATION_TOKEN`.
3. **EAS_UPDATE_INTEGRATION_TOKEN scope**: Expo tokens are not channel-scoped. The CI workflow hardcodes `--channel preview`; code review is the control preventing production pushes.
4. **`EXPO_PUBLIC_STRAPI_TOKEN` is client-bundled**: This token is visible in the published JS bundle. Ensure the Strapi API token has read-only scope restricted to necessary content types.
5. **Action version pinning**: Consider pinning `expo/expo-github-action` to a specific commit SHA for supply chain hardening.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-01-mobile-secrets-cleanup-requirements.md](docs/brainstorms/2026-04-01-mobile-secrets-cleanup-requirements.md) -- Key decisions: `.env.local` for Doppler, delete `.env.production`, EAS Update on every PR push, `emulator`/`device` scripts
- **Institutional learning:** [docs/solutions/mobile/eas-update-stakeholder-preview-setup.md](docs/solutions/mobile/eas-update-stakeholder-preview-setup.md) -- EAS env conventions, `skipValidation` guard, `.env.ci` gitignore trap, secret visibility constraints
- **Institutional learning:** [docs/solutions/platform/new-app-ci-and-deployment-patterns.md](docs/solutions/platform/new-app-ci-and-deployment-patterns.md) -- CI build crash patterns with `@t3-oss/env`, `EAS_BUILD` guard explanation
- **Institutional learning:** [docs/solutions/platform/adding-new-apps.md](docs/solutions/platform/adding-new-apps.md) -- Env validation convention, never use raw `process.env`
- **`@expo/env` source:** `node_modules/.pnpm/@expo+env@2.0.8/.../build/index.js` -- confirmed load order: `.env.[mode].local` > `.env.local` > `.env.[mode]` > `.env`
- **Existing CI:** `.github/workflows/ci.yml` -- `affected` job at line 37, env loading pattern at lines 134-138
- **Expo GitHub Action:** [expo/expo-github-action@v8](https://github.com/expo/expo-github-action) (v8.2.1) — setup, preview subaction with QR codes
- **Expo Docs:** [EAS Environment Variables](https://docs.expo.dev/eas/environment-variables/usage) — channel vs environment independence, SDK 54 fallback behavior
- **Expo Docs:** [EAS Update in CI](https://docs.expo.dev/eas-update/github-actions/) — PR preview workflow patterns
- **Expo Docs:** [Runtime Versions](https://docs.expo.dev/eas-update/runtime-versions/) — `sdkVersion` policy behavior
