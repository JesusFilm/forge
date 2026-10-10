---
title: "Merging main into a long-lived branch makes the pre-commit hook lint main's files — merge from main's side"
date: "2026-10-02"
category: "workflow-issues"
module: "cross-cutting — git merge of origin/main into a PR branch under the husky + lint-staged pre-commit hook"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
root_cause: "config_error"
resolution_type: "workflow_improvement"
applies_when:
  - "Merging origin/main into a PR branch that is many commits behind main, with the pre-commit hook live (.husky/_ exists)"
  - "The hook fails on files that the PR never changed, while the same files pass their own package's lint"
  - "eslint is SIGKILLed during lint-staged because the merge staged hundreds of files"
  - "The branch has open review or is the base of a stacked PR, so a rebase and force-push is not acceptable"
symptoms:
  - "git commit of a merge fails in lint-staged with 'Unused eslint-disable directive' warnings in apps/web and apps/manager files the PR never touched"
  - "eslint --max-warnings=0 failed to spawn: Command was terminated with SIGKILL on a batch of about 1,600 staged ts/tsx files"
  - "The same files pass lint when run from their own package (pnpm --filter <pkg> exec eslint)"
related_components:
  - "package.json"
  - ".husky/pre-commit"
  - "eslint.config.mjs"
  - "apps/web/eslint.config.mjs"
  - "apps/manager/eslint.config.mjs"
tags:
  - "git"
  - "merge"
  - "pre-commit-hook"
  - "lint-staged"
  - "eslint"
  - "husky"
  - "long-lived-branch"
  - "fast-forward"
---

# Merging main into a long-lived branch makes the pre-commit hook lint main's files — merge from main's side

## Context

PR #2285 (`feat/admin-feedback-linear`) was 203 commits behind `main`, and GitHub reported merge conflicts. The conflicts were easy to resolve. The problem was the merge commit: the pre-commit hook refused it, and no failure came from the PR's own files.

The hook has two steps (`.husky/pre-commit:1-2`): `pnpm exec lint-staged`, then `pnpm run format:check`. The root `package.json` (`package.json:26-32`) tells lint-staged to run `eslint --max-warnings=0` and `prettier --write` on each staged `*.{ts,tsx}` file.

A merge commit stages every path that differs from `HEAD`. When `HEAD` is the PR branch, that is every file that `main` changed since the branch's base, not only the PR's files. In this case the merge staged 1,612 `.ts`/`.tsx` files, and two failures followed:

- eslint stopped with `Command was terminated with SIGKILL` on one batch. Per this session's observation, it ran out of memory: the same files linted to completion with `NODE_OPTIONS=--max-old-space-size=12288`.
- eslint reported 5 warnings in `main`'s own files, and `--max-warnings=0` made each one fatal:

  ```
  Unused eslint-disable directive (no problems were reported from '@next/next/no-location-assign-relative-destination')
  ```

  Four files were under `apps/manager`: `apps/manager/src/features/seo/seo-workspace-tabs.tsx`, `apps/manager/src/features/seo/seo-workspace.tsx`, `apps/manager/src/features/video-studio/projects.tsx`, and `apps/manager/src/lib/api-fetch.ts`. One file was `apps/web/src/components/watch/AccountControl.tsx`. The directives came in with #2409, the Next.js 16.3.6 upgrade.

**Why only the root lint pass failed.** lint-staged runs eslint from the repo root, so ESLint v9 uses the root `eslint.config.mjs` for every file. Each package lint uses that package's own config, which spreads `eslint-config-next/core-web-vitals` (`apps/web/eslint.config.mjs:3-14`, `apps/manager/eslint.config.mjs:3-7`). That set turns on `@next/next/no-location-assign-relative-destination`, so the directive suppresses a real report there. Before #2405, the root config turned on only `@next/next/no-img-element` among the `@next/next` rules for these apps. So in the root pass the rule was off, and the directive suppressed nothing. The root config sets no `reportUnusedDisableDirectives`, so ESLint v9's default applied and reported the directive as unused. The plugin version was not the cause: the root pins `@next/eslint-plugin-next` 16.3.8 (`package.json:104`), and both apps use `eslint-config-next` ^16.3.8 (`apps/web/package.json:69`, `apps/manager/package.json:52`), from the same release.

CI lints each package with its own config, so `main` stayed green. The drift shows up only when a commit stages one of these files, and a hooked merge of `main` stages all of them.

**This is a recurring class, not a one-off.** The root config records the same trap twice for `react-hooks` directives. The `apps/chat` block says "a directive valid in one lint pass must not be an unknown rule or unused suppression in the other" (`eslint.config.mjs:61-63`), and the `apps/web` block restates it (`eslint.config.mjs:76-78`). #2405 fixed the Next instance with a root block that turns the rule on for `apps/manager` and `apps/web` (`eslint.config.mjs:21-37`). The next package-only rule that a directive names will fail the same way.

## Guidance

**First, fix the PR's own files.** This procedure is only for failures in files that the PR does not change.

**Do not use these routes:**

- `git commit --no-verify`. The repo `CLAUDE.md` forbids it.
- A rebase onto `main` and a force-push. This rewrites the PR's history. It also breaks a stacked PR: PR #2286 uses `feat/admin-feedback-linear` as its base, so it would then carry commits that are no longer on its base.
- A fix to `main`'s files inside the unrelated PR. That puts out-of-scope changes into a PR that another team reviews. Fix root-versus-package drift in a small, separate PR. (#2405 landed this fix inside a large Shorts feature PR.)

**Make the merge from `main`'s side.** Check out `origin/main` and merge the PR branch into it. Then the hook compares the merge with `main`, so it lints only the PR's own files. The hook still runs in full. The result is still a merge commit that contains the old branch head, so the push is a normal fast-forward.

```bash
# 0. If you already resolved a merge in the usual direction, save the result.
git write-tree                      # prints <saved-tree>
git merge --abort

# 1. Merge the PR branch into main, not main into the branch.
git fetch origin main
git checkout --detach origin/main
git merge --no-ff --no-commit <branch>

# 2. Resolve the conflicts again, or copy the saved resolution.
git checkout <saved-tree> -- <conflicted files>

# 3. Confirm that only the PR's files are staged.
git diff --cached --name-only HEAD

# 4. Run the checks (typecheck, tests, codegen drift), then commit.
git commit -m "Merge origin/main into <branch>"

# 5. Confirm the hook did not change the resolution.
git diff --stat <saved-tree> HEAD   # only main's newer commits, if any

# 6. Move the branch to the merge commit and push it.
git branch -f <branch> HEAD
git checkout <branch>
git merge-base --is-ancestor <old-head> HEAD && echo fast-forward
git push origin <branch>            # no --force
```

Step 2 is safe only when `main`'s newer commits do not touch the conflicted files. Check with `git diff --stat <old-main> origin/main -- <files>` first. If they do, resolve those files again.

Step 5 matters because lint-staged runs `prettier --write` and adds what it changes to the commit. Compare the commit with the saved tree before you push.

Step 6 fails when another worktree has `<branch>` checked out, because git does not move a branch that a worktree holds. Run the procedure in that worktree.

The message `Merge origin/main into <branch>` passed the `commit-msg` hook (`pnpm exec commitlint --edit "$1"`) in this session.

The procedure works inside a `.claude/worktrees/` worktree. It needs no second worktree and no stash.

## Why This Matters

- **The hook stays on.** It lints exactly what the commit changes compared with its first parent. For PR #2285 that was the PR's 16 files. The 5 warnings already existed on `main`, and this commit did not add them.
- **There is no history rewrite.** The old branch head is a parent of the merge commit, so the push is a fast-forward. Open review comments, CI history, and a stacked PR's base stay valid.
- **The only difference is the parent order.** The first parent is `main`, not the branch. This repo merges PRs only by squash, and a squash merge ignores parent order.
- **The alternatives cost more.** Without this procedure, an engineer must choose between a forbidden `--no-verify`, a force-push that breaks a stacked PR, or out-of-scope edits to other teams' files.

## When to Apply

- You merge `main` into a long-lived branch, and the pre-commit hook fails on files that the branch never changed.
- The hook reports `Unused eslint-disable directive`, or an unknown-rule error, for a file that passes its own package's lint.
- eslint is `SIGKILL`ed during lint-staged because the merge staged hundreds of files.
- The branch has open review or is the base of a stacked PR, so a rebase and force-push is not acceptable.

## Examples

**Before: the usual direction fails the hook.**

```bash
git checkout feat/admin-feedback-linear
git merge origin/main              # 4 conflicts, then resolved and staged
git commit --no-edit
# ✖ eslint --max-warnings=0:
# apps/web/src/components/watch/AccountControl.tsx
#   213:17  warning  Unused eslint-disable directive (no problems were reported from '@next/next/no-location-assign-relative-destination')
# ✖ eslint --max-warnings=0 failed to spawn:
# Command was terminated with SIGKILL: eslint '--max-warnings=0' ...
```

**After: the reverse direction passes the hook.**

```bash
git write-tree                                  # saved the resolution
git merge --abort
git checkout --detach origin/main
git merge --no-ff --no-commit feat/admin-feedback-linear
git checkout <saved-tree> -- apps/admin/schema.graphql \
  apps/admin/src/graphql/schema.ts \
  apps/admin/src/graphql/public-resolvers.regression.test.ts \
  packages/admin-graphql/src/admin-graphql-env.d.ts
git diff --cached --name-only HEAD | wc -l      # 16, the PR's own files
git commit -m "Merge origin/main into feat/admin-feedback-linear"
# [COMPLETED] *.{ts,tsx} — 13 files
# All matched files use Prettier code style!
git branch -f feat/admin-feedback-linear HEAD
git checkout feat/admin-feedback-linear
git push origin feat/admin-feedback-linear      # fast-forward
```

After the push, GitHub reported PR #2285 as `MERGEABLE` (checked 2026-09-30).

## Related

- `docs/solutions/workflow-issues/merge-conflict-region-is-textual-not-semantic.md` — the same trigger (merging `main` into a long branch). It covers auditing aggregates that git merged without a conflict.
- `docs/solutions/workflow-issues/clean-merge-unused-import-removed-vs-new-usage-added.md` — a merge of `main` with no conflicts that still fails the typecheck.
- `docs/solutions/workflow-issues/gh-pr-checks-watch-silent-pass-on-unmergeable-pr.md` — why a conflicting PR needs the merge in the first place.
- `docs/solutions/workflow-issues/unattended-autonomous-plan-execution-tmux-headless-claude-20260622.md` — the order in which lint-staged runs eslint and prettier.
