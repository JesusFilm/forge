---
title: "Roadmap status drift — audit your tickets against shipped work on origin/main"
category: "workflow-issues"
problem_type: "workflow_issue"
component: "documentation"
root_cause: "missing_workflow_step"
resolution_type: "workflow_improvement"
severity: "low"
module: "roadmap"
tags:
  - roadmap
  - hygiene
  - pr-workflow
  - git
  - status-drift
  - audit
date: "2026-05-07"
last_updated: "2026-05-07"
applies_when:
  - "Markdown roadmap with frontmatter status fields is the source of truth for planning"
  - "Feature work ships through PRs but no automation flips ticket status on merge"
  - "PR titles do not reliably include the feat-NNN identifier"
  - "Owners want roadmap accuracy without ad-hoc panic reconciliation at quarter-end"
related_prs:
  - "JesusFilm/forge#901" # the audit's output — flipped feat-076 + feat-106 to complete
related_docs:
  - "docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md"
  - "docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md"
  - "docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md"
---

# Roadmap status drift — audit your tickets against shipped work on origin/main

## Context

`CLAUDE.md` declares `docs/roadmap/` "the single source of truth for what work is planned, in progress, and complete," but no automation enforces the link between merged PRs and the `status:` field in a ticket's YAML frontmatter. PR merges and frontmatter edits are decoupled: a developer ships a `feat(tv): video-player auto-hide controls (#830)` branch, squash-merges to `main`, and the corresponding `feat-076` ticket sits at `status: "in-progress"` indefinitely. Drift accumulates per owner — every sprint adds tickets whose work shipped weeks ago but whose frontmatter still says otherwise. A second drift surfaces alongside it: feature files added to `docs/roadmap/<lane>/feat-NNN-*.md` without a corresponding row in `docs/roadmap/README.md`'s lane table, so the file exists on disk but is invisible in the rendered index. Both drifts erode the source-of-truth claim quietly until a stakeholder snapshot forces panic reconciliation.

## Guidance

Run this audit at the trigger points listed in **When to Apply**. Replace `<name>` with your owner handle (e.g. `urim`, `tataihono`, `vlad`).

### 1. Enumerate your tickets

```bash
grep -ril 'owner: "<name>"' docs/roadmap/
```

### 2. Read each ticket's frontmatter

```bash
for f in $(grep -ril 'owner: "<name>"' docs/roadmap/); do
  echo "=== $f ==="
  awk '/^---$/{c++; next} c==1' "$f" | grep -E '^(id|status|title):'
done
```

### 3. For every non-`complete` ticket, search merged history for evidence

```bash
git fetch origin main
git log origin/main --oneline -i --grep='feat-076'
```

**Caveat — feat-NNN is not reliably in PR titles.** Many PRs land with descriptive titles that don't include the ticket ID (e.g., `feat(tv): match video playback mockup and fix D-pad focus navigation (#749)`). When the direct grep returns nothing, fall back to semantic search keyed on the ticket title:

```bash
# feat-076 = "TV App — Video Playback + Polish"
git log origin/main --oneline -i --grep='tv.*playback\|tv.*video.*play'
```

### 4. Cross-check verification criteria

Open each ticket's `## Verification` section and walk through whether the merged PRs actually satisfy it. A PR title can contain `feat-076` and still be partial scope. The verification block is the contract — match against shipped behavior, not just PR existence.

### 5. Make the change in an isolated worktree

So your current branch stays untouched:

```bash
git worktree add ../forge-roadmap-sync -b chore/roadmap-status-sync origin/main
cd ../forge-roadmap-sync
```

Then for each drifted ticket:

- Flip the frontmatter: `status: "in-progress"` → `status: "complete"` in `docs/roadmap/<lane>/feat-NNN-*.md`.
- Update the lane table row in `docs/roadmap/README.md` (Status column).
- Update the snapshot count block at the top of `README.md` — bump `Complete: N` by +K and decrement `In progress: M` by K, where K is the number of tickets you're flipping. Leave the `Status (<date>)` label alone; it's a snapshot tag, not a live timestamp.

```bash
git add docs/roadmap/
git commit -m "chore(roadmap): sync shipped tickets to status: complete"
git push -u origin chore/roadmap-status-sync
gh pr create --title "chore(roadmap): sync shipped tickets" --body "..."
cd - && git worktree remove ../forge-roadmap-sync
```

### 6. Catch the secondary drift — file-on-disk without README registration

After creating any new `docs/roadmap/<lane>/feat-NNN-*.md`, immediately add a row to that lane's table in `docs/roadmap/README.md` in `start_date` order. To find existing gaps in one shot:

```bash
for f in docs/roadmap/*/feat-*.md; do
  id=$(awk -F'"' '/^id:/{print $2; exit}' "$f")
  grep -q "$id" docs/roadmap/README.md || echo "MISSING in README: $id ($f)"
done
```

## Why This Matters

A roadmap that lags shipped work makes completion metrics lie to stakeholders — quarter-end snapshots understate output and overstate WIP. Dependency chains break: tickets with `depends_on: ["feat-076"]` stay auto-flagged as blocked by the viewer even after feat-076 actually shipped, so downstream owners wait on phantom blockers. Agents reading the roadmap for planning context propose work that's already done, wasting tokens and review cycles. The longer drift accumulates, the cheaper it feels to ignore — until a snapshot review forces a panicked one-shot reconciliation that's far more expensive than per-sprint hygiene.

## When to Apply

- After every sprint or planning checkpoint — cheapest cadence, typically 2–3 tickets to flip.
- Before publishing any roadmap snapshot, status report, or stakeholder update.
- The moment a PR with `(feat-NNN)` in the title merges to `main` — flip the ticket as part of the merge ritual.
- When you finish a ticket-named branch locally, before deleting it.
- Monthly hygiene pass across all your owned tickets, even ones you assume are correct.

## Examples

This session, urim's audit surfaced two drifted tickets in `docs/roadmap/topic-experiences/`.

**Step 1–2 — enumerate + read frontmatter:**

```bash
$ grep -ril 'owner: "urim"' docs/roadmap/ | xargs -I{} sh -c 'awk "/^---$/{c++;next}c==1" "{}" | grep -E "^(id|status):" && echo'
id: "feat-076"
status: "in-progress"

id: "feat-106"
status: "in-progress"
... (10 others already complete)
```

**Step 3 — merged-PR evidence:**

```bash
# feat-106 — direct grep works, the PR title carries the ID
$ git log origin/main --oneline -i --grep='feat-106'
c9b120c7 feat(tv): search UI — chip, /search route, semantic search,
         results grid, browse surface (feat-106) (#847)

# feat-076 — direct grep returns nothing; fall back to semantic
$ git log origin/main --oneline -i --grep='feat-076'
(no output)

$ git log origin/main --oneline -i --grep='tv.*playback\|tv.*video.*play'
ed0be511 feat(tv): video-player auto-hide controls + play/pause initial
         focus + crimson palette (#830)
2d11a55d feat(tv): focus-driven hero swaps to selected experience video (#803)
f67c547b feat(tv): cinematic video card redesign with playback fixes (#773)
81ab9964 feat(tv): match video playback mockup and fix D-pad focus (#749)
0dafa1df feat(tv): enhance video hero with inline autoplay (#742)
```

**Step 4 — cross-check.** feat-076's verification ("center toggles play/pause", "menu exits playback", "focus feels responsive", "complete home → experience → video → back flow") all map to the five shipped PRs. feat-106's verification (chip on home, `/search` route, results grid, no-results state, gql.tada `String!` locale type) matches PR #847's full-scope title.

**Step 5 — frontmatter and README diffs:**

```diff
 ---
 id: "feat-076"
 title: "TV App — Video Playback + Polish"
 owner: "urim"
-status: "in-progress"
+status: "complete"
 ---
```

```diff
 ## Status (April 29, 2026)
-- **Complete:** 63
-- **In progress:** 7
+- **Complete:** 65
+- **In progress:** 5

 ### Topic Experiences
-| feat-076 | TV App — Video Playback + Polish | urim | P1 | … | in-progress |
+| feat-076 | TV App — Video Playback + Polish | urim | P1 | … | complete    |
+| feat-106 | TV App — Search UI               | urim | P1 | … | complete    |
```

The feat-106 row also exposed the secondary drift: the file `docs/roadmap/topic-experiences/feat-106-tv-app-search-ui.md` existed on disk but had never been registered in the README table. The agent inserted it in `start_date` order between feat-076 and feat-016.

**Step 6 — loop closed by [PR #901](https://github.com/JesusFilm/forge/pull/901)**, prepared in `git worktree add` off `origin/main` so the active `feat/dual-client-codegen-unit-3` branch was untouched.

## Related

- `docs/solutions/developer-experience/env-matrix-drift-from-runtime-requirements-20260421.md` — closest sibling pattern: drift between intent-authored docs and reality.
- `docs/solutions/workflow-issues/check-migration-playbook-before-extending-source-side-20260429.md` — same family: an existing CLAUDE.md rule isn't reliably executed at the right moment.
- `docs/solutions/best-practices/challenge-predecessor-plan-framing-and-read-named-memory-pointers-20260429.md` — forced-read of authoritative pointers before acting; the roadmap is one such pointer.
