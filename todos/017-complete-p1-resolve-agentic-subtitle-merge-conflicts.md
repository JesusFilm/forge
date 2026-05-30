---
status: complete
priority: p1
issue_id: "017"
tags: [code-review, mergeability, mastra, lockfile, roadmap]
dependencies: []
---

# Resolve Mastra Subtitle Merge Conflicts

## Problem Statement

PR #886 does not currently merge cleanly into `origin/main`. GitHub will block
merge until the branch is refreshed and the conflicting files are resolved.

## Findings

- `git fetch origin main` updated `origin/main` from `715b996d` to `a37bd7d3`.
- `git merge-tree --write-tree origin/main HEAD` failed with content conflicts.
- Conflicting files:
  - `docs/roadmap/README.md`
  - `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
  - `pnpm-lock.yaml`

## Proposed Solutions

### Option 1: Merge `origin/main` Into This Branch

**Approach:** Run a normal merge from `origin/main`, resolve the three conflicts,
rerun validation, then push the merge commit.

**Pros:**
- Fastest path to a mergeable PR.
- Preserves PR history.

**Cons:**
- Leaves a merge commit in the feature branch.

**Effort:** Small

**Risk:** Low

---

### Option 2: Rebase Onto `origin/main`

**Approach:** Rebase the branch, resolve the same conflicts, rerun validation,
then force-push with lease.

**Pros:**
- Keeps a linear branch history.

**Cons:**
- More conflict-prone on a large PR with lockfile changes.
- Requires force-push coordination.

**Effort:** Small to Medium

**Risk:** Medium

## Recommended Action

Merge `origin/main` into this branch, resolve only the listed conflicts, and
rerun the PR validation commands.

## Technical Details

Affected files:

- `docs/roadmap/README.md`
- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- `pnpm-lock.yaml`

## Resources

- PR: https://github.com/JesusFilm/forge/pull/886
- Review command: `git merge-tree --write-tree origin/main HEAD`

## Acceptance Criteria

- [x] `git merge-tree --write-tree origin/main HEAD` exits 0.
- [x] `pnpm-lock.yaml` is refreshed against current `origin/main`.
- [x] Roadmap conflicts preserve both current-main changes and PR #886 updates.
- [x] PR validation is rerun after conflict resolution.

## Work Log

### 2026-05-05 - Review Finding

**By:** Codex

**Actions:**
- Fetched current `origin/main`.
- Ran `git merge-tree --write-tree origin/main HEAD`.
- Captured the merge conflicts as a P1 review blocker.

**Learnings:**
- The branch was green locally but no longer mergeable after `origin/main`
  advanced.

### 2026-05-05 - Conflict Resolution

**By:** Codex

**Actions:**
- Merged current `origin/main` into `feat/116-agentic-subtitle-enrichment-workflow`.
- Resolved roadmap conflicts by preserving both feat-106 mainline updates and
  feat-116 Mastra subtitle updates.
- Refreshed `pnpm-lock.yaml` with `pnpm install --lockfile-only`.
- Reran Mastra and Manager tests, lint, typecheck, root format check, and local
  Mastra API smoke.

**Learnings:**
- The lockfile conflict resolved cleanly by taking current main and regenerating
  the lockfile in this worktree.
