# CLAUDE.md — AI Chat Roadmap Lane

## What this is

The roadmap lane for **Jesus Film AI Chat** (Mastra backend agents + the
`apps/chat` web surface).

The **canonical** roadmap conventions — feature-file format, **Roadmap Rules**,
and **When To Update the Roadmap** — live in root `CLAUDE.md → ## Roadmap` and
apply here in full. This file records only where `ai-chat` **differs from or
extends** that baseline (and, per forge's package-CLAUDE precedence, this file
wins on conflicts).

## This lane is deliberately UNREGISTERED in the viewer app

Unlike the four main lanes, `ai-chat` is **intentionally not** wired into the
roadmap viewer (`apps/roadmap`):

- It is **not** in `apps/roadmap/lib/features.ts` `LANE_DIRS` / `Lane` union →
  the viewer never loads or renders these tickets.
- It is **not** in `apps/roadmap/scripts/generate-roadmap-readme.js`
  `README_LANE_ORDER` → these tickets never appear in, and are never counted by,
  the generated root `docs/roadmap/README.md`.

**Do not register it** to "fix" the missing lane — the omission is the design.
The lane is tracked here in docs (these tickets + a hand-maintained `README.md`)
and is intentionally invisible to the viewer app: it should not render in the
dashboard, and its tickets should not count toward the generated root roadmap
totals. The work it tracks (Mastra seeker agents, the `apps/chat` web surface)
ships via its own feature PRs, not through the roadmap app.

## Maintaining `README.md` (this folder)

`README.md` here is **hand-maintained** — no generator writes it, and the root
roadmap generator never touches it. When you add, renumber, or change the status
of a ticket in this folder, update `README.md` in the same change:

1. Update the matching row in the **Feature Index** table (ID, title, status,
   code PR).
2. Recompute the **Status** block counts (total / complete / in-progress /
   not-started / blocked) by hand from the tickets — they must agree with the
   ticket frontmatter.
3. Bump the `## Status (Month D, YYYY)` date to the day you edited it.
4. Keep the dependency notes accurate if `depends_on` / `blocks` changed.

**Code PR column format:** every PR entry is a clickable markdown link —
`[#NNNN](https://github.com/JesusFilm/forge/pull/NNNN)` — never a bare `#NNNN`.
For multi-PR arcs, list each link comma-separated in the same cell. Tickets
without a code PR yet use `—`. Fill the cell in the same PR that flips the
ticket to `complete` (the PR number exists once the PR is open) — with the same
PRs the ticket's `## Resolution` section cites.

The README's totals block and `Status` column prefix each status with an emoji
(README-only — frontmatter `status` stays plain text): `✅ complete`,
`🟡 in-progress`, `🔵 not-started`, `🔴 blocked`.

## Allocating ticket IDs — scan ALL lanes, not just this one

IDs are the **global** `feat-NNN` sequence shared with every other lane. To pick
the next ID, scan **every** `feat-*.md` under `docs/roadmap/` (all lanes,
including this one), not just the main four and not the generated root README
(which excludes this lane):

```bash
grep -rhoE 'feat-[0-9]+' docs/roadmap --include='*.md' | sort -t- -k2 -n | tail -1
```

Take the next free number above that when you create a ticket. **Don't re-chase
the frontier afterward:** the global sequence already carries many duplicate IDs
across lanes (pre-existing, not CI-enforced), and this lane isn't rendered — so
if a parallel branch later lands the same number, the resulting cross-lane
duplicate is acceptable. The one rule that matters: **keep this lane's own IDs
distinct from each other** — two files with the same `id` in this folder would
break the `depends_on` / `blocks` graph.

## Status reflects `main`, not the branch

When a ticket is created here ahead of its code (the tickets can sometimes land
on a roadmap PR only), set its status to what's on `main` — so it stays
`in-progress` even if the work is already finished on a gated branch. Flip it
to `complete` **inside the code PR itself** — as a final commit once the
feature is done — so the status and the code land on `main` together. This
keeps `main`'s roadmap from claiming `complete` for code that isn't there yet.

`blocked` is **manual** in this lane. The viewer auto-computes `blocked` from
incomplete dependencies for the rendered lanes — but this lane isn't rendered,
so nothing computes it here. Set `status: "blocked"` by hand when a ticket can't
start, and flip it back when the block clears.

## Cross-lane dependencies — record them on the ai-chat side only

When an ai-chat ticket depends on (or is blocked by) a ticket in a rendered
lane, put the reference on **this** lane's ticket and **do not** add a
back-reference inside the rendered-lane ticket. The repo-wide "dependencies are
bidirectional" rule does **not** safely cross the rendered/unrendered boundary —
honoring it on the rendered side breaks the viewer:

- A rendered ticket with `depends_on: [<ai-chat-id>]` is marked **permanently
  blocked** — the viewer never loads the ai-chat ticket, so the dependency can
  never read as `complete` (it computes blocked status from `depends_on` against
  only the loaded lanes).
- A rendered ticket with `blocks: [<ai-chat-id>]` renders a **dead link** — the
  `/ticket/<id>` route `notFound()`s for an unloaded ticket.

So a cross-boundary link is one-way: the ai-chat side carries the `depends_on` /
`blocks`; the rendered side stays untouched. (This is why, e.g., `feat-129` in
`platform` is not edited to list this lane's tickets in its `blocks`.)

## Completing a ticket — prepend a `## Resolution` section

When you flip a ticket to `status: "complete"`, prepend a `## Resolution` section
at the very top of the body (above `## Problem`). Write it **in the feature PR
itself, as its final step before merge** — not in a follow-up PR (for multi-PR
arcs: in the arc's final PR, the one that flips the status; the PR number and
title exist once the PR is open; `Shipped:` is the expected merge date). The
original brief stays below as the historical record. A ticket flipped to
`complete` without a Resolution is not done — the resolution is part of
"complete". Template:

```markdown
## Resolution

**Shipped:** YYYY-MM-DD via [PR #NNNN](https://github.com/JesusFilm/forge/pull/NNNN) (`<merge commit subject>`). List each PR for multi-PR arcs.

**What landed.** 2–4 sentences on what shipped in practice — defaults chosen, scope cut, deviations from the brief. Don't restate the PR title; capture what `git log` alone wouldn't tell a future reader.

**Compound docs.** Links to any `docs/solutions/` entries created. Omit if none.

**Residual risk / follow-ups.** Links to follow-up `feat-NNN` tickets or accepted limitations. Omit if none.

**Unblocked.** Tickets whose `depends_on` this satisfies. Omit if none.
```
