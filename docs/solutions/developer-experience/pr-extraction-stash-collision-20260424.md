---
title: "Focused PR extraction corrupts worktree when stash-pop crosses branches with divergent files"
date: "2026-04-24"
last_updated: "2026-07-08"
category: "developer-experience"
module: "git-workflow"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
applies_when:
  - "Shipping a focused PR from a feature branch that has pre-existing uncommitted edits"
  - "Source branch differs from target base on any tracked file outside the intended PR scope"
  - "Using `/pr`, `/ce-commit-push-pr`, or any flow that stashes, branches from `origin/main`, then pops"
  - "The dirty file is `apps/cms/schema.graphql` or any other Strapi/codegen artifact that drifts per-branch"
  - "Relocating an ENTIRE dirty worktree (tracked + untracked) into a fresh git worktree without committing"
tags:
  - "git"
  - "git-stash"
  - "git-worktree"
  - "git-cherry-pick"
  - "pr-workflow"
  - "ce-pr"
  - "schema-graphql"
---

# Focused PR extraction corrupts worktree when stash-pop crosses branches with divergent files

## Context

The `/pr` skill needed to ship a focused 4-file subset (new `feat-106` TV search ticket, two reverse-dependency edits, one `CLAUDE.md` tag-list edit) from a busy feature branch (`feat/web-floating-search-redesign`). The branch had pre-existing uncommitted modifications to `apps/cms/schema.graphql` and `apps/roadmap/tsconfig.json` plus several untracked brainstorm/plan files — none of which belonged in the focused PR.

The natural instinct — `git stash push -u` → `git checkout -b new-branch origin/main` → `git stash pop` → stage only the 4 intended files → commit — contains a silent landmine when the source branch and the target base disagree about a tracked file's committed content.

**This is not hypothetical in this repo.** `apps/cms/schema.graphql` drifts per-branch whenever anyone touches a Strapi content type. It was the collision file on 2026-04-20 (during a `git pull`), on 2026-04-23 (during a `git checkout`), and on 2026-04-24 (during the `/pr` stash-pop). Session history confirmed the recurring pattern (session history).

## Guidance

**Do not use `git stash push -u` + rebranch + `git stash pop`** to extract a focused PR from a dirty feature branch when the source branch differs from the target base on any tracked file. The stash records diffs against the source branch's HEAD; popping onto a branch with a different HEAD silently three-way-merges those diffs against the _wrong parent_, producing a worktree that matches neither branch.

Prefer one of the following, in order of preference:

### 1. Cherry-pick path (most reliable — recommended default)

```bash
# On feat/<branch> with dirty worktree:
git add <focused files only>
git commit -m "<focused commit message>"
FOCUSED_SHA=$(git rev-parse HEAD)

git checkout -b <topic-branch> origin/main
git cherry-pick "$FOCUSED_SHA"
git push -u origin HEAD
gh pr create ...

# Optional: if the commit should not live on the feature branch:
git checkout feat/<branch>
git reset --soft HEAD~1    # un-commits, preserves the dirty worktree intact
```

The commit is a self-contained diff. `cherry-pick` applies it against the target branch's HEAD with proper three-way context, not against stash metadata.

### 2. Worktree path (best when the feature branch must stay untouched)

```bash
git worktree add ../forge-pr origin/main -b <topic-branch>
cd ../forge-pr
# Author the focused changes here, or copy blobs from the sibling worktree.
git add <files> && git commit -m "<message>"
git push -u origin HEAD
gh pr create ...
cd - && git worktree remove ../forge-pr
```

The original worktree's dirty state is never touched. No stash, no branch switch on the source, no collision surface. Recommended when the dirty state is long-running work you don't want to commit yet.

### 3. Scoped-pathspec stash (fallback — only when the stash must travel)

If you must carry an uncommitted change across branches, scope the stash to specific paths and do **not** pop it on a branch where the target file differs:

```bash
# Stash only the specific paths you want to carry:
git stash push -m "pre-<target>-checkout" -- <path1> <path2>
git checkout <target-branch>
# DO NOT pop here if <target-branch>'s committed content for <pathN> differs.
# Pop later, only on a branch where the parent matches.
```

This is the pattern that worked correctly in a prior session when the same `apps/cms/schema.graphql` collision was anticipated (session history — session `0ecf19bb`, 2026-04-23).

### 4. Pre-flight check (when you cannot avoid the unscoped stash-pop)

Before popping, verify the stash's tracked paths are disjoint from files that differ between source and target:

```bash
BASE_DIFF=$(git diff --name-only origin/main...HEAD)
STASH_DIFF=$(git diff --name-only HEAD)
comm -12 <(echo "$BASE_DIFF" | sort) <(echo "$STASH_DIFF" | sort)
```

Non-empty intersection ⇒ stash-pop will mis-merge those files. Bail and use path 1 or 2.

### 5. Relocating an entire dirty worktree into a new worktree (safe stash-move — same-HEAD only)

The paths above extract a _focused subset_ onto `origin/main`. A different task —
moving ALL uncommitted work (tracked edits **and** untracked new files) out of
the main checkout into an isolated worktree **without committing** — has a clean
stash-move recipe, and it is safe precisely because it avoids the divergent-base
trap this doc warns about:

```bash
# In the main checkout (the only worktree so far):
git stash push --include-untracked -m "<feature> wip"          # -u carries untracked files too
git worktree add -b <feature-branch> /path/to/worktrees/<name> HEAD   # SAME HEAD you stashed from
git -C /path/to/worktrees/<name> stash pop                     # pops onto an identical base -> no mis-merge
```

Why this is safe where the focused-PR stash-pop is dangerous: the new worktree's
branch is created from **`HEAD`** — the exact commit the stash was recorded
against — so the three-way merge on pop has the _same_ parent and cannot
silently mis-merge. The divergent-base danger that paths 1–4 exist to avoid
arises only when the pop lands on a base where `origin/main` ≠ the feature HEAD.
**Same base ⇒ safe; divergent base ⇒ use cherry-pick.**

Two things a fresh `git worktree add` does NOT do — which is why the stash step
is needed at all: it checks out the branch **clean** (it never carries the main
checkout's uncommitted changes, so the untracked new files especially would be
left behind), and worktrees do **not** share `node_modules`. After the move, run
`pnpm install --frozen-lockfile` in the new worktree before its pre-commit hook
or tests can run (see
`docs/solutions/build-errors/worktree-pnpm-install-8mb-file-truncation-20260624.md`).
`git stash` is repo-global — stashes live in the shared `.git` and are visible
from every worktree — which is what lets a stash created in one worktree pop in
another. Verify the move by comparing the changed-file set before and after: the
new worktree should carry exactly what the main checkout did, and the main
checkout should read clean (`git status --porcelain` empty).

**Caveat — gitignored files do not travel.** `--include-untracked` carries
tracked edits and untracked new files, but **not** gitignored ones (e.g.
`.env.local`); and `git status --porcelain` hides ignored files, so both
worktrees read "clean" whether or not those files came across — the verification
above does not cover them. Per-worktree env files must be copied or recreated
separately, like `node_modules`.

**Caveat — staged/index state does not travel.** A plain `git stash pop` restores
everything as _unstaged_, flattening any curated index (your staged-vs-unstaged
split) you had before the move — and the changed-file-set check above can't
detect it, because it compares file _sets_, not staging state. If the index
mattered, pop with `git stash pop --index` to restore it too; that is safe here
precisely because the base is identical, so there is no conflict for `--index` to
trip on.

## Why This Matters

The failure mode is **silent**:

- `git stash pop` onto a divergent base does _not_ report a conflict when the three-way merge resolves cleanly. The resulting worktree contains a ghost version of the file — content that matches neither branch's committed state.
- If the operator then stages only the intentionally-focused files, the ghost content sits undetected in the worktree and later blocks checkout:
  ```
  error: Your local changes to apps/cms/schema.graphql would be overwritten by checkout.
  Aborting
  ```
- Recovery requires knowing that `git stash pop` does not auto-drop the stash entry when the worktree is left in a merge-adjacent state — the original stash is still at `stash@{0}`, which is the rescue hatch.

On today's run the PR itself shipped clean (only the 4 intended files were staged; PR #841 opened with all CI green). But on a less careful run, the ghost content could have been staged and a regression shipped. On a repeat of this pattern against `apps/cms/schema.graphql`, a subtly-wrong schema could escape to CI and cause downstream codegen failures.

**`apps/cms/schema.graphql` is the canonical recurring trigger in this repo.** Strapi regenerates it per-branch whenever anyone touches a content type. Any `/pr` or `/ce-work` flow extracting a focused subset from a branch with uncommitted Strapi work will hit this unless the flow uses one of the safer paths above.

## When to Apply

- Shipping a focused subset PR (docs, roadmap tickets, config tweaks) from a feature branch with unrelated pre-existing modifications
- Running `/pr` or `/ce-commit-push-pr` from a dirty feature branch
- Any time `git diff origin/main...HEAD` and `git diff HEAD` share at least one path
- Especially when the overlap includes `apps/cms/schema.graphql` or other codegen-derived artifacts

Skip this guidance (unscoped stash-pop is fine) only when the source branch is already at `origin/main` (no divergence) or the stash touches only files that are identical between source and target base.

## Examples

**Before (what broke on 2026-04-24):**

```bash
# On feat/web-floating-search-redesign with dirty worktree:
git stash push -u -m "ce-pr-roadmap-separator"
git checkout -b docs/roadmap-tv-search-ticket origin/main
git stash pop
# Silent mis-merge of apps/cms/schema.graphql against main's version.

git add CLAUDE.md docs/roadmap/content-discovery/feat-010-*.md \
        docs/roadmap/topic-experiences/feat-074-*.md \
        docs/roadmap/topic-experiences/feat-106-*.md
git commit -m "docs(roadmap): add TV search ticket"
# PR ships clean (only the 4 intended files were staged).

git checkout feat/web-floating-search-redesign
# error: Your local changes to apps/cms/schema.graphql would be overwritten by checkout.
```

Recovery that day: instead of force-checking out, the pristine pre-session state was preserved in `stash@{0}` (the original full stash that `git stash pop` did not auto-drop), and the user was handed manual recovery steps (`git checkout -- apps/cms/schema.graphql` + `git checkout feat/<branch>` + `git stash pop stash@{0}`).

**After (cherry-pick path):**

```bash
# On feat/web-floating-search-redesign with dirty worktree:
git add CLAUDE.md docs/roadmap/content-discovery/feat-010-*.md \
        docs/roadmap/topic-experiences/feat-074-*.md \
        docs/roadmap/topic-experiences/feat-106-*.md
git commit -m "docs(roadmap): add TV search ticket + reverse deps"
SHA=$(git rev-parse HEAD)

git checkout -b docs/roadmap-tv-search-ticket origin/main
git cherry-pick "$SHA"
git push -u origin HEAD
gh pr create ...

# Dirty worktree on feat/web-floating-search-redesign is untouched.
# If the commit shouldn't live on feat:
git checkout feat/web-floating-search-redesign
git reset --soft HEAD~1
```

**After (worktree path):**

```bash
git worktree add ../forge-pr origin/main -b docs/roadmap-tv-search-ticket
cd ../forge-pr
# Author the 4 files fresh, or copy specific blobs from the sibling worktree.
git add CLAUDE.md docs/roadmap/...
git commit -m "docs(roadmap): add TV search ticket + reverse deps"
git push -u origin HEAD
gh pr create ...
cd - && git worktree remove ../forge-pr
```

## Related

- Session history: same `apps/cms/schema.graphql` collision handled correctly on 2026-04-23 via scoped-pathspec stash in session `0ecf19bb`; same file surfaced as a cross-branch-divergence signal during a `git pull` on 2026-04-20 in session `5afc6d7b` (session history)
- `/pr` skill default flow at `/Users/urimchae/.claude/commands/pr.md` — the specific trigger surface; step 1 uses the unscoped stash-rebranch-pop pattern
- No prior entries in `docs/solutions/` cover git stash/cherry-pick/worktree patterns — this seeds the cluster
