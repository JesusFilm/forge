---
status: pending
priority: p2
issue_id: "018"
tags: [code-review, validation, prettier, manager]
dependencies: []
---

# Ignore Manager Test Artifacts In Format Check

## Problem Statement

The review validation sequence is not repeatable without manually deleting
generated Manager mock artifact files. `pnpm --filter @forge/manager test`
creates JSON files under `apps/manager/.tmp/`, and the subsequent root
`pnpm run format:check` scans those ignored runtime artifacts and fails.

## Findings

- `pnpm --filter @forge/manager test` passed.
- A later `pnpm run format:check` failed on:
  - `apps/manager/.tmp/artifacts/mock_asset_1/chapters.json`
  - `apps/manager/.tmp/artifacts/mock_asset_1/metadata.json`
- `apps/manager/.gitignore` ignores `.tmp/`, but `.prettierignore` does not.
- After manually deleting those two generated files, `pnpm run format:check`
  passed.

## Proposed Solutions

### Option 1: Add `apps/manager/.tmp` To `.prettierignore`

**Approach:** Ignore Manager runtime/test artifacts in the root Prettier scan.

**Pros:**
- Smallest fix.
- Matches the existing gitignore intent for runtime artifacts.
- Makes validation repeatable after tests.

**Cons:**
- Does not prevent tests from writing files.

**Effort:** Small

**Risk:** Low

---

### Option 2: Move Test Artifacts To A Temp Directory Outside The Repo

**Approach:** Configure tests to write artifacts under OS temp storage.

**Pros:**
- Keeps the repo working tree cleaner.

**Cons:**
- Broader test/runtime configuration change.
- Higher chance of affecting existing artifact tests.

**Effort:** Medium

**Risk:** Medium

## Recommended Action

Add `apps/manager/.tmp` to `.prettierignore` and keep the current test artifact
generation behavior unchanged.

## Technical Details

Affected files:

- `.prettierignore`
- Manager tests that write mock artifacts under `apps/manager/.tmp/`

## Resources

- PR: https://github.com/JesusFilm/forge/pull/886
- Validation command: `pnpm run format:check`

## Acceptance Criteria

- [ ] `pnpm --filter @forge/manager test` followed by `pnpm run format:check`
  passes without manually deleting `.tmp` files.
- [ ] Runtime/test artifact files remain untracked.
- [ ] No generated source, schema, or lockfile outputs are hidden accidentally.

## Work Log

### 2026-05-05 - Review Finding

**By:** Codex

**Actions:**
- Reproduced format failure after the Manager test suite.
- Verified the failure disappeared after deleting generated ignored JSON files.

**Learnings:**
- Root Prettier ignores some generated paths, but not Manager `.tmp` artifacts.
