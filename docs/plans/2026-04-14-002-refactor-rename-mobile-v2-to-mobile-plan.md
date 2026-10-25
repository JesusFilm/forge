---
title: "refactor: Delete deprecated apps/mobile, rename apps/mobile-v2 to apps/mobile"
type: refactor
status: active
date: 2026-04-14
---

# refactor: Delete deprecated apps/mobile, rename apps/mobile-v2 to apps/mobile

## Overview

Delete the deprecated `apps/mobile/` directory and rename `apps/mobile-v2/` to `apps/mobile/`. Update all configuration, CI, and agent instruction files to reflect the new path. Historical documentation (plans, brainstorms, solutions) is left as-is.

## Problem Frame

The monorepo carries two mobile directories: the deprecated `apps/mobile/` (legacy, excluded from CI) and the active `apps/mobile-v2/`. Every new contributor, agent, and instruction file must explain "mobile means mobile-v2." The `-v2` suffix adds cognitive overhead, stale references, and a CI exclusion hack that silently skips the old app. Consolidating to a single `apps/mobile/` removes this ambiguity.

## Requirements Trace

- R1. `apps/mobile/` (deprecated) is fully removed from the repo
- R2. `apps/mobile-v2/` is renamed to `apps/mobile/` with package name `@forge/mobile`
- R3. CI continues to run lint, typecheck, test, and expo-doctor for the mobile app
- R4. Root convenience scripts `android` and `ios` work after rename; `emulator` and `device` are cleanly removed (deferred to follow-up)
- R5. All agent instruction files (CLAUDE.md, AGENTS.md) reflect the new structure — no deprecation notices, no `-v2` suffixes
- R6. pnpm workspace resolves correctly with no duplicate React instances
- R7. EAS builds and Doppler secrets continue to work (external service config unchanged in this PR)
- R8. Historical docs (plans, brainstorms, solutions) are left untouched

## Scope Boundaries

- Only living configuration and instruction files are updated
- Historical docs in `docs/plans/`, `docs/brainstorms/`, `docs/solutions/` are **not** modified
- Code review artifacts in `.context/` are not modified

### Deferred to Separate Tasks

- Doppler project rename (`forge-mobile-v2` → `forge-mobile`): external service, handle via Doppler dashboard separately
- EAS slug update (`jesus-film-forge-v2`): external service, handle via `eas project:init` separately if desired
- Porting `emulator`/`device`/`emulator:fresh` scripts from old mobile to renamed mobile: separate convenience PR

## Context & Research

### Relevant Code and Patterns

- `pnpm-workspace.yaml` uses `apps/*` glob — no workspace config change needed for directory rename
- `turbo.json` defines tasks globally — no change needed
- `metro.config.js` uses `path.resolve(__dirname, '../..')` for monorepo root — path-relative, survives rename
- Metro singleton resolver (`singletonPkgs`) is load-bearing for React deduplication

### Institutional Learnings

- **Metro pnpm symlink resolution** (`docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md`): After rename, must verify React singleton resolution via `require.resolve('react')` from the new workspace
- **CI exclusion is silent** (`ci.yml` line 72): The `!= "@forge/mobile"` filter silently skips the deprecated app. After rename, this filter must be removed or the renamed app will be invisible to CI
- **EAS is slug-based** (`docs/solutions/mobile/eas-update-stakeholder-preview-setup.md`): EAS projectId and slug are independent of filesystem path — directory rename does not break EAS

## Key Technical Decisions

- **git rm then git mv**: Delete `apps/mobile/` first with `git rm -r`, then `git mv apps/mobile-v2 apps/mobile`. This avoids git confusion from overwriting an existing directory.
- **Keep Doppler project name as-is**: The `fetch-secrets` script will keep `--project forge-mobile-v2` for now. Renaming the Doppler project is an external service change deferred to a separate task.
- **Keep EAS slug as-is**: `jesus-film-forge-v2` stays unchanged. EAS identifies by projectId, not directory name.
- **Remove root emulator/device scripts temporarily**: The renamed app doesn't have `emulator` or `device` scripts. Rather than porting them in this PR, remove the root delegating scripts and port them in a follow-up.

## Open Questions

### Resolved During Planning

- **Will pnpm-workspace.yaml need updating?** No — it uses `apps/*` glob.
- **Will turbo.json need updating?** No — tasks are defined globally.
- **Will metro.config.js break?** No — it uses `__dirname`-relative paths, not package names.

### Deferred to Implementation

- **Does the old `apps/mobile/` have any git submodules or special git state?** Check before deleting.
- **Are there any Railway service configs tied to `mobile-v2`?** Verify in Railway dashboard.

## Implementation Units

- [x] **Unit 1: Delete deprecated apps/mobile and rename apps/mobile-v2**

  **Goal:** Perform the filesystem operations and update the package identity.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Delete: `apps/mobile/` (entire directory)
  - Rename: `apps/mobile-v2/` → `apps/mobile/`
  - Modify: `apps/mobile/package.json` (name field)

  **Approach:**
  - `git rm -r apps/mobile` to remove the deprecated directory
  - `git mv apps/mobile-v2 apps/mobile` to rename
  - Update `"name": "@forge/mobile-v2"` → `"@forge/mobile"` in `apps/mobile/package.json`
  - Run `pnpm install` to rebuild workspace symlinks and regenerate lockfile

  **Patterns to follow:**
  - Standard pnpm workspace rename: change package.json name, run install

  **Test scenarios:**
  - Happy path: `pnpm ls --filter @forge/mobile` resolves to `apps/mobile/`
  - Happy path: `pnpm --filter @forge/mobile exec node -e "console.log(require.resolve('react'))"` returns a single React instance (no duplicates)
  - Edge case: `pnpm ls --filter @forge/mobile-v2` returns no results (old name is gone)

  **Verification:**
  - `apps/mobile/` exists and contains the former mobile-v2 code
  - Old `apps/mobile-v2/` no longer exists
  - `pnpm install` completes without errors
  - No duplicate React in node_modules resolution

- [x] **Unit 2: Update CI workflow**

  **Goal:** Ensure CI runs all checks for the renamed mobile app.

  **Requirements:** R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `.github/workflows/ci.yml`

  **Approach:**
  - Line 72: Remove `. != "@forge/mobile"` exclusion filter — the renamed app should now be included in affected services detection
  - Line 175: Change `@forge/mobile-v2` → `@forge/mobile` in the expo-doctor job condition
  - Line 190: Change `working-directory: apps/mobile-v2` → `apps/mobile`

  **Patterns to follow:**
  - Existing CI job structure for other apps (graphql-generate, lint-typecheck-test)

  **Test scenarios:**
  - Happy path: A change to `apps/mobile/src/` triggers the expo-doctor job
  - Error path: Verify the jq filter on line 72 still produces valid JSON array output (no syntax errors from the edit)
  - Integration: The affected services detection includes `@forge/mobile` when mobile files change

  **Verification:**
  - CI YAML is valid (can be validated with `actionlint` or manual review)
  - The `@forge/mobile` exclusion no longer exists
  - expo-doctor job references `apps/mobile`

- [x] **Unit 3: Update root package.json scripts**

  **Goal:** Root convenience scripts either work or are cleanly removed.

  **Requirements:** R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `package.json` (root)

  **Approach:**
  - The `android` and `ios` scripts will work as-is (mobile-v2 has those scripts)
  - Remove `emulator` and `device` scripts — the renamed app doesn't have those. Port them in a follow-up PR.

  **Patterns to follow:**
  - Root package.json delegates to workspace packages via `--filter`

  **Test scenarios:**
  - Happy path: `pnpm android` resolves to `apps/mobile` and invokes `expo run:android`
  - Happy path: `pnpm ios` resolves to `apps/mobile` and invokes `expo run:ios`
  - Edge case: `pnpm emulator` errors cleanly (script removed)

  **Verification:**
  - `pnpm android --help` and `pnpm ios --help` resolve without "missing script" errors
  - `emulator` and `device` scripts are removed from root package.json

- [x] **Unit 4: Update agent instruction files**

  **Goal:** All CLAUDE.md and AGENTS.md files reflect `apps/mobile` as the active mobile app with no deprecation notices or `-v2` suffixes.

  **Requirements:** R5

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `CLAUDE.md` (root)
  - Modify: `AGENTS.md` (root)
  - Modify: `compound-engineering.local.md`
  - Modify: `apps/AGENTS.md`
  - Modify: `apps/mobile/CLAUDE.md` (header rename)
  - Modify: `apps/cms/CLAUDE.md`
  - Modify: `apps/cms/AGENTS.md`
  - Modify: `packages/AGENTS.md`
  - Modify: `packages/graphql/CLAUDE.md`
  - Modify: `packages/graphql/AGENTS.md`
  - Modify: `SECURITY.md`
  - Modify: `apps/tv/CLAUDE.md`

  **Approach:**
  - Root `CLAUDE.md`: Remove the deprecation notice block (`apps/mobile/ is DEPRECATED...`), remove the `apps/mobile/` line from monorepo structure, change all `mobile-v2` → `mobile`, remove `Never work in apps/mobile` line
  - Root `AGENTS.md`: Remove deprecation line, change `mobile-v2` → `mobile`
  - `compound-engineering.local.md`: Change 5 instances of `mobile-v2` → `mobile`
  - `apps/AGENTS.md`: Remove old mobile entry, update mobile-v2 → mobile
  - `apps/mobile/CLAUDE.md`: Update header from `apps/mobile-v2` to `apps/mobile`
  - CMS and GraphQL instruction files: Change `mobile-v2` → `mobile` where applicable; references to just `apps/mobile` already read correctly post-rename
  - `SECURITY.md`: Already says `apps/mobile` — verify, no change likely needed
  - `apps/tv/CLAUDE.md`: Change `mobile-v2` → `mobile` in SDUI pipeline description

  **Patterns to follow:**
  - Existing instruction file formatting conventions

  **Test scenarios:**
  - Happy path: `grep -r "mobile-v2" CLAUDE.md AGENTS.md compound-engineering.local.md apps/AGENTS.md apps/cms/ packages/ SECURITY.md apps/tv/CLAUDE.md` returns zero results
  - Happy path: `grep -r "DEPRECATED.*apps/mobile" CLAUDE.md AGENTS.md` returns zero results
  - Edge case: References to `apps/mobile` (without -v2) in instruction files correctly describe the active app

  **Test expectation: none** — these are documentation files. Verification is grep-based.

  **Verification:**
  - No remaining `mobile-v2` references in any instruction file
  - No remaining deprecation notices about `apps/mobile`
  - `apps/tv/CLAUDE.md` SYNC references point to `apps/mobile/`

- [x] **Unit 5: Update TV app SYNC comments**

  **Goal:** All SYNC comments in `apps/tv/` point to `apps/mobile/` instead of `apps/mobile-v2/`.

  **Requirements:** R5

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `apps/tv/src/contexts/ExperienceProvider.tsx`
  - Modify: `apps/tv/src/lib/normalizer.ts`
  - Modify: `apps/tv/src/lib/queries.ts`
  - Modify: `apps/tv/src/lib/validateUrl.ts`
  - Modify: `apps/tv/src/lib/easterDates.ts`
  - Modify: `apps/tv/src/lib/types.ts`
  - Modify: `apps/tv/src/lib/resolveImageUrl.ts`
  - Modify: `apps/tv/src/components/sections/QuizButtonRenderer.tsx`
  - Modify: `apps/tv/src/components/sections/VideoHeroRenderer.tsx`

  **Approach:**
  - Find-and-replace `apps/mobile-v2/` → `apps/mobile/` in all SYNC comments and informal mobile-v2 references

  **Patterns to follow:**
  - Existing `// SYNC: keep in sync with apps/mobile-v2/...` comment format

  **Test scenarios:**
  - Happy path: `grep -r "mobile-v2" apps/tv/src/` returns zero results

  **Test expectation: none** — these are comment-only changes. Verification is grep-based.

  **Verification:**
  - No remaining `mobile-v2` references in `apps/tv/src/`

- [x] **Unit 6: Update internal source comments in mobile app**

  **Goal:** Remove stale `mobile-v2` references in the renamed app's own source files.

  **Requirements:** R5

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `apps/mobile/metro.config.js`
  - Modify: `apps/mobile/src/styles/shared.ts`
  - Modify: `apps/mobile/src/lib/queries.ts`
  - Modify: `apps/mobile/.env.example`

  **Approach:**
  - Update comments referencing `mobile-v2` to just `mobile` or remove the version qualifier

  **Test scenarios:**
  - Happy path: `grep -r "mobile-v2" apps/mobile/` returns zero results (excluding node_modules)

  **Test expectation: none** — comment-only changes.

  **Verification:**
  - No remaining `mobile-v2` references in `apps/mobile/` source files

- [x] **Unit 7: Clean up .gitignore**

  **Goal:** Remove stale gitignore entry for old mobile app's generated iOS files.

  **Requirements:** R1

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `.gitignore`

  **Approach:**
  - Line 29: `mobile/ios/App/ForgeApp/Generated/` — this referenced the old app's generated token file. Verify whether the renamed app needs a similar entry; if not, delete the line.

  **Test expectation: none** — config-only change.

  **Verification:**
  - No stale gitignore entries referencing the old mobile app structure

## System-Wide Impact

- **CI pipeline:** The `@forge/mobile` exclusion filter is the highest-risk item. If not removed, CI will silently skip all mobile checks after rename.
- **pnpm workspace:** Lockfile regeneration is required. Metro's React singleton resolver must be verified post-rename.
- **EAS/Doppler:** Not changed in this PR. External service configs are decoupled from directory names.
- **Agent instructions:** Every CLAUDE.md and AGENTS.md file mentioning mobile paths will be updated. Agents will stop seeing deprecation warnings and `-v2` qualifiers.
- **Unchanged invariants:** All mobile app source code, dependencies, and runtime behavior are unchanged. Only the directory name and package identity change.

## Risks & Dependencies

| Risk                                                      | Mitigation                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| CI silently skips mobile after rename (line 72 exclusion) | Unit 2 explicitly removes the exclusion filter. Verify in first CI run.             |
| Duplicate React instances after pnpm install              | Unit 1 verification includes `require.resolve('react')` check from mobile workspace |
| Root `emulator`/`device` scripts break                    | Unit 3 removes them cleanly rather than leaving broken references                   |
| EAS builds fail due to slug mismatch                      | EAS uses projectId, not directory name. Slug is unchanged.                          |
| Doppler secrets fail                                      | Doppler project name is hardcoded in script, unchanged in this PR                   |

## Sources & References

- Related learnings: `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md`
- Related learnings: `docs/solutions/mobile/eas-update-stakeholder-preview-setup.md`
- Related learnings: `docs/solutions/mobile/expo-env-file-handling.md`
- CI workflow: `.github/workflows/ci.yml`
