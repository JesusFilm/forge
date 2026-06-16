# ai-chat Lane Decision & Renumber Record

**Status:** OPEN — gated on a pending team decision about how the `ai-chat`
roadmap lane is registered (or whether the seeker tickets belong in the main
roadmap at all).

This record is the **single source of truth** for that decision and for the
ID/path migration it triggers. It governs PR **#1268** (`feature/seeker-ai-chat`
→ `main`), which stays **draft** until this record's checklist is executed.

Do not delete this file until the migration below is complete and verified.

---

## Why this exists

Two coupled problems block the seeker line from landing on `main`:

1. **Structural (the gate).** Registering a new `ai-chat` roadmap lane requires
   canonical edits that are intentionally NOT applied on this branch yet,
   pending a team decision:
   - root `CLAUDE.md` "Roadmap Structure" tree + the `tags:` vocabulary
   - the hardcoded lane spots in `apps/roadmap/` — `Lane` union, `LANE_DIRS`,
     `ALL_LANES` (×2, incl. the `Sidebar.tsx` copy), `README_LANE_ORDER`,
     `getLaneLabel` + the Sidebar label map

   The decision may instead **relocate** these tickets into an existing lane, or
   **drop them from the main roadmap entirely** (keeping the plans/brainstorms
   only). All three outcomes are in scope below.

2. **ID collisions (already real, and recurring).** Roadmap IDs are a shared
   sequential namespace that `main` keeps consuming while this branch is gated.
   The seeker tickets currently **collide** with tickets already on `main`:

   | Seeker ticket (this branch)                           | Collides with (already on `main`)                                |
   | ----------------------------------------------------- | ---------------------------------------------------------------- |
   | `ai-chat/feat-170-seeker-agent-skeleton.md`           | `content-discovery/feat-170-yt-video-mapper-backend-scaffold.md` |
   | `ai-chat/feat-174-seeker-rag-retrieval-connection.md` | `content-discovery/feat-174-watch-search-page-size.md`           |

   Plan-doc sequence collision (separate namespace):
   `docs/plans/2026-06-10-002-feat-seeker-rag-retrieval-connection-plan.md`
   collides with `docs/plans/2026-06-10-002-fix-watch-search-page-size-plan.md`.

   This already violates the repo's "IDs are globally unique" rule, so a
   renumber is **forced regardless of the structural decision**. It has happened
   once before (169 → 170, after a firecrawl ticket collision) and will keep
   drifting as `main` advances. Do the renumber as ONE atomic pass at the same
   time the gate clears — don't chase `main` repeatedly while gated.

---

## Living document — expand this as the branch grows

`feature/seeker-ai-chat` is long-lived and gated, so it will accumulate **more
features** (a third, fourth, …) before it lands. Every new feature added to this
trunk inherits the same two problems above: its roadmap ticket ID is provisional
and collision-prone (`main` keeps consuming IDs while we're gated), and its
references spread across code / plans / solutions exactly like `feat-170` /
`feat-174` did.

So this record is a **living migration ledger, not a one-time snapshot.** When
you add anything to this branch (a new ticket, plan, brainstorm, solutions doc,
or code that names a ticket ID):

1. Treat its roadmap ticket ID as **provisional** — assume it will be renumbered
   at merge time. Don't build anything that hard-depends on the exact number.
2. **Append its files to the IN-SCOPE inventory** below, and **add its ID to the
   mapping table.** Keep the EXCLUDED list current too if it touches sibling
   tickets.
3. Re-run the grep and hand-classify any new hits as IN-SCOPE (seeker/ai-chat)
   vs EXCLUDED (a collision counterpart that lives on `main`):
   ```bash
   git grep -lE 'feat-[0-9]{3}' -- docs/roadmap/ai-chat docs/plans docs/brainstorms docs/solutions apps/mastra
   ```

If the inventory falls behind the branch, the merge-time renumber **will** miss
the newer features and strand stale references — which is the exact failure this
record exists to prevent. Updating this file is part of "done" for every feature
on this branch.

---

## Decision outcomes (fill in when the team decides)

Pick one. Record the date and the chooser.

- **Decided on:** `YYYY-MM-DD` **By:** `name`

- [ ] **A — Register `ai-chat` lane as-is.** Apply the canonical lane edits
      above. Seeker tickets stay in `docs/roadmap/ai-chat/` but **renumber** to
      the next free IDs.
- [ ] **B — Relocate** into an existing lane (which: `____`). Tickets move
      path AND renumber. No new lane registration.
- [ ] **C — Drop from the main roadmap.** Delete the roadmap tickets; the
      plans + brainstorms remain as the historical record. Repoint all
      references (incl. solutions/code/CLAUDE.md) to the plan docs / PRs instead
      of the deleted tickets. No lane registration.

### Mapping table (fill in at decision time)

| Old                                          | New (A/B)                | C (drop)                                  |
| -------------------------------------------- | ------------------------ | ----------------------------------------- |
| `feat-170` (seeker-agent-skeleton)           | `feat-____`              | removed; refs → plan doc / PR #1170       |
| `feat-174` (seeker-rag-retrieval-connection) | `feat-____`              | removed; refs → plan doc / PR #1199       |
| lane path `docs/roadmap/ai-chat/`            | `docs/roadmap/________/` | n/a (tickets removed)                     |
| plan seq `2026-06-10-002` (seeker-rag plan)  | `2026-06-10-____`        | (rename to free the collision regardless) |

---

## Reference inventory — files to update on renumber/relocate

Generated from `git grep -lE 'feat-170|feat-174'` on `feature/seeker-ai-chat`,
classified by hand. **Update every file in the IN-SCOPE lists; do NOT touch the
EXCLUDED list** (those reference the content-discovery tickets that caused the
collision).

### IN SCOPE — roadmap tickets (rename file + frontmatter `id`/`depends_on`/`blocks`)

- `docs/roadmap/ai-chat/feat-170-seeker-agent-skeleton.md`
- `docs/roadmap/ai-chat/feat-174-seeker-rag-retrieval-connection.md`
  - These two are **bidirectionally linked** (170 `blocks` 174; 174
    `depends_on` 170) — update both ends together.

### IN SCOPE — plan & brainstorm docs (references updated in full, per decision)

- `docs/brainstorms/2026-06-08-seeker-agent-skeleton-requirements.md`
- `docs/brainstorms/2026-06-10-seeker-rag-connection-requirements.md`
- `docs/plans/2026-06-08-003-feat-seeker-agent-skeleton-plan.md`
- `docs/plans/2026-06-10-002-feat-seeker-rag-retrieval-connection-plan.md` (also rename to fix the `002` seq collision)

### IN SCOPE — solutions docs (keep ticket-ID references; renumber them)

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
- `docs/solutions/conventions/single-service-http-client-result-union-convention.md`
- `docs/solutions/integration-issues/mastra-conversational-agent-memory-and-model-router-wiring.md`
- `docs/solutions/integration-issues/mastra-studio-api-auth-guard.md`

### IN SCOPE — code & package docs (ID lives in comments / instruction strings)

- `apps/mastra/CLAUDE.md`
- `apps/mastra/src/config/env.ts`
- `apps/mastra/src/config/env.test.ts`
- `apps/mastra/src/mastra/agents/seeker-agent.ts`
- `apps/mastra/src/mastra/agents/seeker-agent.test.ts`
- `apps/mastra/src/mastra/memory.ts`
- `apps/mastra/src/mastra/seeker-route-isolation.test.ts`
- `apps/mastra/src/mastra/tools/retrieve-answer.ts`
- `apps/mastra/src/services/jesusfilm-rag-client.ts`

### IN SCOPE — PR surface (not in git; update by hand)

- PR **#1268** body "Integration order" section, if IDs change.
- This record file itself (mark the migration complete; under outcome C,
  relocate or delete it once refs are repointed).

### EXCLUDED — do NOT change (these reference the COLLIDING content-discovery tickets)

- `docs/roadmap/README.md` (links the content-discovery feat-170 / feat-174)
- `docs/roadmap/content-discovery/feat-170-yt-video-mapper-backend-scaffold.md`
- `docs/roadmap/content-discovery/feat-171-yt-video-mapper-broad-catalog-prototype.md`
- `docs/roadmap/content-discovery/feat-172-web-search-keyword-first-opt-in.md`
- `docs/roadmap/content-discovery/feat-174-watch-search-page-size.md`
- `docs/plans/2026-06-10-002-fix-watch-search-page-size-plan.md`

> Note: PR numbers (**#1170**, **#1199**, **#1268**), agent/file names
> (`seekerAgent`, `jesusfilm-rag-client.ts`), and the `CONCEPTS.md` "Seeker
> Agent" entry are **stable identifiers** — they never change under any
> outcome. Prefer them when adding new cross-references so future churn stays
> contained to the lists above.

---

## Execution checklist (run when the decision lands)

1. Sync `main` into `feature/seeker-ai-chat` first (it drifts behind while gated).
2. Fill in the **Decision outcomes** + **Mapping table** above.
3. Apply the change across every IN-SCOPE file (rename roadmap ticket files,
   update frontmatter `id`/`depends_on`/`blocks`, update all ID + path strings).
4. For outcome A/B: apply the canonical lane edits (root `CLAUDE.md` +
   `apps/roadmap/` hardcoded spots) and add the lane to `docs/roadmap/README.md`.
   For outcome C: delete the roadmap tickets; repoint their inbound references to
   the plan docs / PRs.
5. Update PR #1268's body + this record (mark complete).
6. **Verify zero stale references** before merging the renumber:

   ```bash
   # Must return ONLY the EXCLUDED content-discovery files (or nothing, if
   # those have since moved). Any seeker hit on an old ID/path is a miss.
   git grep -nE 'feat-170|feat-174|roadmap/ai-chat' -- ':!docs/roadmap/ai-chat/LANE-DECISION-RECORD.md'
   pnpm prettier --check .
   ```
