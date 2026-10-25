---
title: "Roadmap feat-NNN ids collide when you allocate from your own tree; scan every branch and worktree"
date: "2026-09-28"
category: "workflow-issues"
module: "roadmap"
problem_type: "workflow_issue"
component: "development_workflow"
severity: "medium"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
applies_when:
  - "You create a new roadmap ticket (feat-NNN) in any lane under docs/roadmap/"
  - "You push, open a PR for, or merge main into a branch that adds a ticket file"
  - "Two ticket files share an id and one of them is not merged yet"
related_components:
  - "roadmap"
  - "apps/roadmap"
tags:
  - "roadmap"
  - "feat-id"
  - "id-allocation"
  - "renumber"
  - "git-branches"
  - "worktrees"
---

# Roadmap feat-NNN ids collide when you allocate from your own tree; scan every branch and worktree

## Context

Each roadmap ticket is a file `docs/roadmap/<lane>/feat-NNN-<slug>.md`. The file name and the frontmatter `id:` carry the same number. On `origin/main` on 2026-09-28, all 846 ticket files have an `id:` line that matches the number in the file name. The roadmap viewer reads the frontmatter `id` (`apps/roadmap/lib/features.ts:154`), not the file name.

In this document, a ticket file **claims** an id. A claim exists when a ticket file with that id is on any branch or in any worktree, merged or not.

### The rule text that causes the mistake

The root `CLAUDE.md` gives the only general rule (`CLAUDE.md:201`, the same line on `origin/main`):

> **IDs are globally unique**: next ID is one higher than the highest existing `feat-NNN`.

The rule does not say where "existing" is. An agent reads its own working tree, takes the highest id there, and adds one. Other texts repeat the same gap:

- `AGENTS.md:17` says: "create one in the correct lane using the next sequential `feat-NNN` ID".
- `docs/roadmap/rag/CLAUDE.md:8` says: "IDs are globally allocated."
- `docs/roadmap/ai-chat/CLAUDE.md:57-66` is the most careful text. It tells the agent to scan every `feat-*.md` in all lanes, with `grep -rhoE 'feat-[0-9]+' docs/roadmap --include='*.md'`. But that command also reads only the current tree.

The working tree does not show the tickets that sit on unmerged branches. Tickets often stay on a branch for days or weeks. Thus "highest in my tree + 1" gives an id that another branch has frequently claimed already.

The first half of the rule is also not true today. "IDs are globally unique" is a goal, not a fact. No check enforces it. A search of `apps/roadmap/`, `scripts/`, and `.github/` finds no duplicate-id check, and `docs/roadmap/ai-chat/CLAUDE.md:69-70` says the duplicates are "pre-existing, not CI-enforced".

### Measured state of `origin/main` (2026-09-28)

- 846 ticket files hold 532 distinct ids. 188 ids have more than one ticket file.
- 155 of those 188 ids have two or more files inside the four lanes that the viewer reads (`content-discovery`, `topic-experiences`, `media-generation`, `platform`; `apps/roadmap/lib/features.ts:142-147`). The other 33 ids collide only between a docs-only lane (`ai-chat`, `rag`) and another lane.
- `feat-501` has five files: four in `platform` and one in `topic-experiences`. `feat-524` has two files in `platform`.
- The highest id on `origin/main` is `feat-551`. The highest id on all branches and worktrees is `feat-553`.

### Earlier occurrences

- `feat-334` has four files on `origin/main` (one in `ai-chat`, one in `content-discovery`, two in `platform`). A session note records that mobile search observability moved from `feat-334` to `feat-335` for this reason.
- `feat-335` now also has four files on `origin/main`. The mobile search observability ticket (PR #1823) is one of them. Three other commits added the other three. The renumber to the next number did not end the collision; it moved it.
- A session note from 2026-08-17 records that `main` held a highest id of 362 while origin branches held ids up to 368, and `feat-363` was claimed three times on three unmerged branches. One of those tickets (the mobile mini player) is now `feat-367`.

- A session on 2026-09-18 (branch `docs/roadmap-complete-mobile-tickets`,
  for localized push campaigns) scanned with
  `git log --all --diff-filter=A --name-only -- 'docs/roadmap/*/feat-*.md'`.
  That command sees only refs that the checkout has already fetched, and the
  session did not check the id again before its push. It chose `feat-521` as a
  candidate, and the ticket later became `feat-524`. The branch of the open
  PR #2366 now holds `feat-524-localized-push-campaigns.md`, while `main`
  already has two other `feat-524` tickets (session history).

### The occurrence on this branch (PR #2427, open, not merged as of 2026-09-28)

1. 2026-09-24 08:28 UTC: PR #2422 (branch `codex/tv-beta-feedback`, open) is opened. Its branch holds `docs/roadmap/platform/feat-551-tv-beta-qr-feedback-linear.md`, from a commit dated before the PR opened.
2. 2026-09-24 21:35 UTC: this branch commits the Bible reader ticket as `feat-551`, locally. The branch is not pushed.
3. 2026-09-25 02:28 UTC: PR #2424 merges `docs/roadmap/platform/feat-551-auth-discovery-startup.md` to `main`. That PR opened only seven minutes earlier.
4. 2026-09-26: before the first push, a scan of every origin branch, local branch, and worktree finds `feat-552` as the highest id. `feat-552` is claimed twice: `feat-552-android-tv-play-availability.md` on `origin/codex/tv-beta-feedback`, and `feat-552-mobile-explore-clips-feed.md` on a local branch.
5. The ticket becomes `feat-553` in one renumber commit. The commit touches 128 files (126 in `apps/mobile`, 60 of them test files, plus the ticket and the plan). It has 161 insertions and 161 deletions. No behavior changes, and the full gate passes again (jest 341 suites / 5806 tests, tsc, lint, prettier).
6. Two minutes after the renumber commit, PR #2427 opens with `feat-553`.

At step 2, `feat-551` was already claimed on the branch of an open PR (#2422). An all-branch scan at that time would have shown it. Three tickets claimed `feat-551` inside about 18 hours.

---

## Guidance

### 1. Allocate the id from a scan of every branch and worktree

Do not take "highest in my tree + 1". Take "highest claimed anywhere + 1". "Anywhere" means:

- every `refs/remotes/origin/*` branch (after `git fetch origin --prune`),
- every local branch (`refs/heads/*`), and
- every worktree on this machine, because a worktree can hold a ticket file that nobody has committed yet.

The script below does this. Save it outside the repo (for example in `$TMPDIR` or your session scratchpad), and run it with `bash`. Do not add it to the repo by accident.

In a worktree-isolated Claude Code session, the guard refuses an inline `for ... done` pipeline. It also refuses a plain command with a value that is computed at run time. A script file that you run with `bash <file>` works. The script takes about 8 seconds for about 470 refs.

```bash
#!/usr/bin/env bash
# Scan every origin branch, local branch, and worktree for roadmap ticket ids.
# No argument: print the highest feat-NNN and the next free id.
# With an id (e.g. 553): print every ref or worktree that holds a ticket file with that id.
set -euo pipefail

want="${1:-}"
git fetch origin --prune --quiet

list_claims() {
  # A ref that another session deletes during the scan is skipped without noise.
  git for-each-ref --format='%(refname)' refs/remotes/origin refs/heads |
    while read -r ref; do
      git ls-tree -r --name-only "$ref" -- docs/roadmap/ 2>/dev/null |
        grep -E '/feat-[0-9]+[^/]*\.md$' |
        sed "s#^#${ref} #" || true
    done
  git worktree list --porcelain | sed -n 's/^worktree //p' |
    while read -r wt; do
      [ -d "$wt/docs/roadmap" ] || continue
      find "$wt/docs/roadmap" -name 'feat-*.md' |
        sed "s#^${wt}/#worktree:${wt} #"
    done
}

claims="$(list_claims)"

if [ -n "$want" ]; then
  printf '%s\n' "$claims" | grep -E "/feat-${want}[^0-9/][^/]*\.md$" | sort -u || echo "feat-${want}: no claim found"
  exit 0
fi

max="$(printf '%s\n' "$claims" | sed -E 's#.*/feat-([0-9]+)[^/]*$#\1#' | sort -n | tail -1)"
echo "highest claimed id: feat-${max}"
echo "next free id:       feat-$((10#$max + 1))"
```

Run it from the repo root (or any worktree of the repo):

```bash
bash "$TMPDIR/feat-id-scan.sh"        # highest claimed id and the next free id
bash "$TMPDIR/feat-id-scan.sh" 553    # every ref or worktree that claims feat-553
```

Notes on the script:

- It reads file names only. On `origin/main` every file name matches its frontmatter `id`, so the file name is a safe key.
- It matches the number on the file name, not on the full path. A worktree directory whose name contains `feat-` does not add a false id.
- It sees only pushed branches of other people. It cannot see a ticket on another person's machine that is not pushed.
- Stale branches (merged or abandoned) can raise the highest id. That is safe. A gap in the sequence costs nothing; a duplicate id costs a renumber.

### 2. Push the ticket early

The scan of other people sees only what you push. Push the branch that holds the new ticket file soon after you create it. A draft PR is not necessary; a pushed branch is sufficient. Until you push, your claim is invisible, and other agents can take the same id.

### 3. Check the id again before the first push, and again before merge

Other branches keep claiming ids while you work. Run the scan again with your id as the argument:

```bash
bash "$TMPDIR/feat-id-scan.sh" 553
```

The output must show only your own ticket file (on your local branch, your origin branch, and your worktree). Any other file name is a collision.

When to run the check:

- Right before the first push, or before you open the PR. A collision found here costs one renumber commit on your branch.
- Again before merge, and after you merge `main` into your branch. After such a merge, also look in the tree: `ls docs/roadmap/*/feat-553-*`.

A collision found after merge is more expensive. By then the id is on `main`, other tickets can cite it in `depends_on` or `blocks`, and the viewer already shows two tickets under one id.

### 4. Renumber, when the check finds a collision

The ticket that is not on `main` yet moves. Do not change the id of a ticket that is already on `main`.

1. Get the new id from the full scan (step 1). Do not use "old id + 1". The `feat-335` case above shows that "old id + 1" is often claimed too.
2. List every file that cites the old id. Use a pattern without backslash escapes, because `git grep -E` on Apple Git reads `\b` as a literal `b` (see `docs/solutions/workflow-issues/git-grep-e-backslash-escapes-make-removal-greps-vacuous.md`):

   ```bash
   git grep -lE 'feat-551([^0-9]|$)'
   ```

3. Read the list. Remove from the list every file that cites the **other** ticket with that id. After you merge `main`, such files are on your branch too. On this branch they were `docs/roadmap/platform/feat-551-auth-discovery-startup.md` and `docs/solutions/auth/self-rp-oauth-discovery-deadlock-standalone-proxy-recipe.md`.
4. Replace the old id in the remaining files. The lookahead stops a match on a longer id such as `feat-5510`:

   ```bash
   perl -pi -e 's/\bfeat-551(?![0-9])/feat-553/g' <file> [<file> ...]
   ```

   This step also changes the frontmatter `id:` of the ticket. The viewer reads that line, not the file name.

5. Rename the ticket file:

   ```bash
   git mv docs/roadmap/platform/feat-551-mobile-native-bible-reader.md \
          docs/roadmap/platform/feat-553-mobile-native-bible-reader.md
   ```

6. Verify. Run `git grep -nE 'feat-551([^0-9]|$)'` again. Each remaining line must cite the other ticket, or be a note that you wrote on purpose (for example "first numbered `feat-551`"). If your branch holds no other ticket with the old id, the result must be empty.
7. Run the full gate again. A renumber changes test names and comments in code, so run the tests, type check, lint, and `npx prettier --check` on the changed markdown.
8. Commit the renumber alone, as `docs(roadmap): renumber <ticket> to feat-NNN`. In the body, say which PR or branch took the old id and how you picked the new one.
9. If a PR is already open, update its title and body.

Commit messages that are already on the branch keep the old id. That is acceptable: the repo uses squash merge (`CLAUDE.md:126`), so the PR title replaces those messages on `main`.

If the session guard refuses the `git grep | xargs perl` pipeline, put steps 2 to 6 in a script file and run it with `bash`, as in step 1.

### 5. The `ai-chat` lane has its own rule after allocation

`docs/roadmap/ai-chat/CLAUDE.md:68-74` says: "Don't re-chase the frontier afterward". That lane is not in the viewer, so it accepts a later cross-lane duplicate. It requires only that ids inside the `ai-chat` folder are distinct. For that lane, use the scan at allocation time (step 1), and follow the lane rule for later collisions. For the four viewer lanes, use steps 3 and 4.

---

## Why This Matters

### The viewer cannot show two tickets with one id correctly

`apps/roadmap/lib/features.ts` keys on the id in three places:

- **Blocked status uses the last file read.** `getAllFeatures` builds `statusById = new Map(features.map((f) => [f.id, f.status]))` (`features.ts:239`). A `Map` keeps the last value for a key, so for a duplicated id the status of the file that the loader reads last wins. The loader reads the lanes in `LANE_DIRS` order (`features.ts:142-147`), then the files in directory order (`features.ts:231`). A ticket that `depends_on` that id becomes "blocked" or not from that one status (`features.ts:243-248`). On `origin/main`, 61 duplicated ids have files with different statuses.
- **The ticket page shows only one of the tickets.** `getFeatureById` returns the first match (`features.ts:260-261`) in the sorted list (priority, then `start_date`; `features.ts:251-255`). The slug is the id (`features.ts:181`), and every card links to `/ticket/${feature.id}` (for example `apps/roadmap/components/FeatureCard.tsx:9`, `StatusBoard.tsx:27`, `DependencyList.tsx:18`). Both cards open the same page, so the viewer cannot open the detail page of the other ticket.
- **Dependencies name ids only.** `depends_on` and `blocks` are lists of id strings (`features.ts:176-177`). A reference to a duplicated id does not say which ticket it means. On `origin/main`, 442 of the 1,109 `depends_on` and `blocks` entries in the four viewer lanes name a duplicated id, in 290 ticket files.

### The cost of a renumber grows each day

An id spreads into code comments, test names, plan files, and docs soon after you create the ticket. The Bible reader ticket file existed for about 37 hours on an unpushed branch before the renumber. In that time its id reached 126 files in `apps/mobile`, 60 of them test files. The renumber was mechanical, but it still needed the full test gate again. After a merge to `main`, a renumber also needs a change on `main` and a check of every other ticket that cites the id.

### The rule text sends the next agent to the same mistake

The root rule is short and sounds complete. An agent that follows it exactly gets a duplicate id when any unmerged branch holds a higher id. That happens most of the time. The 2026-08-17 note, the `feat-334` / `feat-335` case, and this branch all followed the rule, and all collided.

---

## When to Apply

- You create a new roadmap ticket in any lane under `docs/roadmap/`.
- You split one ticket into two, or add a follow-up ticket.
- You are about to push a branch, or open a PR, that adds a ticket file.
- You merge `main` into a branch that adds a ticket file.
- A reviewer, a scan, or the viewer shows two tickets with the same id, and one of them is not merged yet.

The guidance does not ask you to fix old duplicates that are already on `main`. That is a separate clean-up, and it changes ids that other tickets cite.

---

## Examples

### Example 1: allocate an id (2026-09-28)

```text
$ bash "$TMPDIR/feat-id-scan.sh"
highest claimed id: feat-553
next free id:       feat-554
```

On the same day, `origin/main` alone gives `feat-551` as the highest id. The "highest in my tree + 1" rule on a fresh branch from `main` gives `feat-552`, which two branches already claim.

### Example 2: check one id before a push

```text
$ bash "$TMPDIR/feat-id-scan.sh" 552
refs/heads/feat/mobile-explore-clips-feed docs/roadmap/content-discovery/feat-552-mobile-explore-clips-feed.md
refs/remotes/origin/codex/tv-beta-feedback docs/roadmap/platform/feat-552-android-tv-play-availability.md
worktree:<repo>/.claude/worktrees/mobile-explore-clips-feed docs/roadmap/content-discovery/feat-552-mobile-explore-clips-feed.md
```

Two different ticket files claim `feat-552`. Neither is merged. If you own one of them, renumber it before your first push.

```text
$ bash "$TMPDIR/feat-id-scan.sh" 551
refs/heads/feat/mobile-native-bible-reader docs/roadmap/platform/feat-551-auth-discovery-startup.md
refs/heads/main docs/roadmap/platform/feat-551-auth-discovery-startup.md
refs/remotes/origin/HEAD docs/roadmap/platform/feat-551-auth-discovery-startup.md
refs/remotes/origin/codex/tv-beta-feedback docs/roadmap/platform/feat-551-tv-beta-qr-feedback-linear.md
refs/remotes/origin/feat/mobile-native-bible-reader docs/roadmap/platform/feat-551-auth-discovery-startup.md
refs/remotes/origin/main docs/roadmap/platform/feat-551-auth-discovery-startup.md
worktree:<repo> docs/roadmap/platform/feat-551-auth-discovery-startup.md
worktree:<repo>/.claude/worktrees/feat+mobile-native-bible-reader docs/roadmap/platform/feat-551-auth-discovery-startup.md
```

`feat-551` is on `main` (PR #2424). The branch of the open PR #2422 still claims it for a different ticket. That PR will add a duplicate to `main` when it merges, unless its owner renumbers first.

### Example 3: the renumber on this branch

The renumber commit on PR #2427 is `docs(roadmap): renumber the native Bible reader to feat-553`. It:

- renames `docs/roadmap/platform/feat-551-mobile-native-bible-reader.md` to `feat-553-mobile-native-bible-reader.md`, and changes `id: "feat-551"` to `id: "feat-553"`;
- replaces `feat-551` with `feat-553` in 126 files in `apps/mobile` (comments, test names, `apps/mobile/CLAUDE.md`) and in the plan `docs/plans/2026-09-24-1251-feat-mobile-native-bible-reader-plan.md`;
- has a body that names PR #2424 as the owner of `feat-551`, says `feat-552` is claimed twice, and lists the gate results.

A later merge of `main` brought the auth ticket and its solution doc to the branch. After that merge, `git grep -nE 'feat-551([^0-9]|$)'` finds three files. Two cite the auth ticket. The third, `docs/solutions/logic-errors/measure-cache-keyed-wider-than-view-key-misses-onlayout-on-fabric.md:45`, says on purpose that the ticket was "first numbered `feat-551`". All three are correct.

### Example 4: a clearer rule text (a proposal, not applied)

The root `CLAUDE.md` rule could say:

> **IDs are allocated from every branch**: the next ID is one higher than the highest `feat-NNN` that any origin branch, local branch, or worktree holds, not only your working tree. Push a new ticket soon. Check the id again before the first push and before merge, and renumber the unmerged ticket on a collision. See `docs/solutions/workflow-issues/<this doc>.md`.

The same change applies to `AGENTS.md:17`, and to the scan command in `docs/roadmap/ai-chat/CLAUDE.md:64-66`.

## Related

- `docs/solutions/workflow-issues/git-grep-e-backslash-escapes-make-removal-greps-vacuous.md`:
  why the renumber step uses `([^0-9]|$)` and not `\b` in `git grep -E`.
- `docs/solutions/workflow-issues/roadmap-status-drift-audit-recipe-20260507.md`:
  roadmap hygiene against `origin/main`. Its per-id checks assume one ticket
  for each id, which is not true for the duplicated ids above.
- `docs/solutions/build-errors/roadmap-frontmatter-normalization-next-build-crash.md`:
  hardens `apps/roadmap/lib/features.ts`, the same loader, for field types. It
  does not check for duplicate ids.
- `docs/roadmap/ai-chat/CLAUDE.md`: the lane rule that scans all lanes, but
  only in the current tree.
- PR #2427 (open, not merged as of 2026-09-28): the branch that hit this, and
  the renumber commit in Example 3.
