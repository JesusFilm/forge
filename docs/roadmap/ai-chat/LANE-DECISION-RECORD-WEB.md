# ai-chat Web App — Lane Decision & Renumber Record

**Status:** OPEN — gated on the same pending team decision as the seeker line
about how (or whether) the `ai-chat` roadmap lane is registered.

This record is the **web-app counterpart** to the seeker line's
`docs/roadmap/ai-chat/LANE-DECISION-RECORD.md` (which governs PR **#1279**,
`feature/seeker-ai-chat`; #1279 supersedes the closed #1268). It governs PR **#1276**
(`feature/ai-chat-web-app` → `main`), the integration trunk for the
`apps/chat` web app, which stays **draft** until this record's checklist is
executed.

> **Canonical vs. counterpart.** The seeker record is the **canonical** source
> of truth for the _structural_ lane gate (the root `CLAUDE.md` + `apps/roadmap/`
> edits that register a new lane). This web record does NOT re-decide that gate —
> it tracks the **web app's own tickets, IDs, and references**, plus the
> web-specific correction of the chat ticket's lane placement (moved
> `platform/` → `ai-chat/`). The two records must be reconciled into ONE
> renumber/registration pass when the decision lands. Do not delete this file
> until that pass is complete.

---

## Why this exists

Three coupled problems block the web-app line from landing on `main`:

1. **Structural (the shared gate).** Registering a new `ai-chat` roadmap lane
   requires canonical edits that are intentionally NOT applied yet, pending the
   team decision (full list in the seeker record). For the web side the outcome
   is either register the lane (A) or drop the tickets from the main roadmap (C)
   — see Decision outcomes below.

2. **Web-specific: corrected lane placement.** The chat scaffold ticket was
   originally filed in the **`platform`** lane by mistake; it has been moved to
   `docs/roadmap/ai-chat/feat-174-chat-app-scaffold.md` to sit alongside the
   seeker work, matching the original intent. Like the seeker tickets, it lives
   in the (not-yet-registered) `ai-chat/` directory **without** the canonical
   lane-registration code edits — the same gated posture as `#1279`. Its
   `tags: [infrastructure, chat, scaffold]` remain provisional (the gated tag
   vocabulary doesn't yet include `chat`/`ai-chat`/`scaffold`). What stays OPEN
   is only the shared structural registration (problem 1) and the renumber
   (problem 3) — not the lane choice.

3. **ID + sequence collisions (already real, recurring).** Roadmap IDs and plan
   sequences are shared sequential namespaces that `main` keeps consuming while
   this trunk is gated. The web scaffold already collides:

   | Web artifact (this trunk)                                  | Collides with                                                                     |
   | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
   | `ai-chat/feat-174-chat-app-scaffold.md`                    | `content-discovery/feat-174-watch-search-page-size.md` (on `main`)                |
   | `ai-chat/feat-174-chat-app-scaffold.md`                    | `ai-chat/feat-174-seeker-rag-retrieval-connection.md` (on `#1279`, **same lane**) |
   | `docs/plans/2026-06-10-005-feat-chat-app-scaffold-plan.md` | `docs/plans/2026-06-10-005-feat-official-media-signature-indexing-plan.md`        |

   So **`feat-174` is a triple collision** and the plan **seq `2026-06-10-005`**
   collides too. Note the seeker collision is now **same-directory** (both land
   in `docs/roadmap/ai-chat/` once the lines merge), which sharpens — but does
   not create — the need to renumber. The two `feat-174` _ticket files_ are also
   **already both present on this trunk** (`content-discovery/` + `ai-chat/`),
   violating the "IDs are globally unique" rule today. A renumber is **forced
   regardless** of the structural decision; do it as ONE atomic pass when the
   gate clears (reconciled with the seeker record) rather than chasing `main`
   repeatedly while gated.

---

## Living document — expand this as the trunk grows

`feature/ai-chat-web-app` is long-lived and gated, so it will accumulate **more
features** before it lands — styling, conversation memory, auth, database
persistence, and the real Mastra agent wiring. Every new feature added to this
trunk inherits the same problems: its roadmap ticket ID + plan seq are
provisional and collision-prone (`main` keeps consuming them while we're gated),
and its references spread across code / plans / solutions exactly like
`feat-174` did.

When you add anything to this trunk (a new ticket, plan, brainstorm, solutions
doc, or code that names a ticket ID):

1. Treat its roadmap ticket ID + plan seq as **provisional** — assume they'll be
   renumbered at merge time. Don't hard-depend on the exact number.
2. **Append its files to the IN-SCOPE inventory** below, and **add its ID to the
   mapping table.** Keep the EXCLUDED list current too.
3. Re-run the grep and hand-classify new hits as IN-SCOPE (chat web) vs EXCLUDED
   (a collision counterpart that lives elsewhere):
   ```bash
   git grep -lE 'feat-[0-9]{3}' -- docs/roadmap docs/plans docs/brainstorms docs/solutions apps/chat
   ```

Updating this file is part of "done" for every feature on this trunk.

---

## Decision outcomes (fill in when the team decides)

Pick one. Record the date and the chooser. Coordinate with the seeker record so
both lines resolve in the same pass.

- **Decided on:** `YYYY-MM-DD` **By:** `name`

The chat tickets already live in `ai-chat/` (lane placement is settled); these
outcomes only decide the lane's **registration** and the renumber.

- [ ] **A — Register the `ai-chat` lane.** Apply the canonical lane edits (per
      the seeker record) so the viewer renders `ai-chat`, and **renumber** the
      chat tickets to the next free IDs. (This is the expected outcome — the
      tickets are already filed in `ai-chat/`.)
- [ ] **C — Drop from the main roadmap.** Delete the chat roadmap ticket(s); the
      plans + brainstorms remain as the historical record. Repoint all
      references (solutions / code / package docs) to the plan docs / PRs.

### Mapping table (fill in at decision time)

| Old                                           | New (A)           | C (drop)                                  |
| --------------------------------------------- | ----------------- | ----------------------------------------- |
| `feat-174` (chat-app-scaffold)                | `feat-____`       | removed; refs → plan doc / PR #1198       |
| `feat-192` (chat-app-vigil-reskin)            | `feat-____`       | removed; refs → PR #1277                  |
| plan seq `2026-06-10-005` (chat-app-scaffold) | `2026-06-10-____` | (rename to free the collision regardless) |

---

## Frontmatter vocabulary additions (apply with outcome A)

Code review of #1277 (feat-192) flagged frontmatter values outside the
vocabularies declared in root `CLAUDE.md` → "Feature File Format". Where a value
is an **intended addition**, the ticket keeps it (tracked deviation, same gated
posture as the provisional tags noted in problem 2) and root `CLAUDE.md` is
extended **when the lane decision lands** (outcome A), in the same atomic pass as
the renumber. Where a value is **wrong** (borrowed from another app, or a one-off
descriptor), the renumber pass corrects the ticket instead of extending the
vocabulary.

### Add to the allowed vocabulary

1. **Owner `jianwei`.** Not in the allowed owner set
   (`tataihono, vlad, ekkasit, nisal, urim`). `jianwei` owns the chat web-app
   line and will own more tickets on this trunk — **add `jianwei` to the allowed
   owner set** in root `CLAUDE.md` "Feature File Format" rather than reassigning
   the ticket. (Owner is a one-line change under any outcome; doing it at
   decision time avoids a churny pre-merge edit on a gated trunk.)

2. **Tag `ai-chat` (only).** Not in the allowed tag vocabulary
   (`cms, manager, web, mobile, tv, graphql, ai-pipeline, search, pgvector, infrastructure, i18n`).
   **Add exactly one tag — `ai-chat`** — as part of registering the lane. It is
   the lane's domain/capability tag (sibling to `ai-pipeline`), and it is the
   umbrella that spans BOTH this `apps/chat` web line AND the Mastra/seeker
   backend work — one concept, one name, mirroring the lane directory.

### Do NOT add (correct the tickets instead, at the renumber pass)

- **`chat` tag — rejected.** Too generic, and it collides semantically with the
  unrelated admin AI-chat work (experience-editor chat panel, four-channel
  providers, thumb-rating scorer — see `docs/brainstorms/2026-05-*`). A flat
  searchable vocabulary should not carry both `chat` and `ai-chat`; `ai-chat` is
  the specific, non-colliding name. Tickets currently carrying `chat` drop it for
  `ai-chat`.
- **`web` tag — wrong app; remove.** In this repo `web` is the **`apps/web`**
  app tag (the watch/search/experience consumer app), parallel to `mobile` / `tv`
  / `manager` / `cms`. `apps/chat` is a separate deployable that does not touch
  `apps/web`, so `web` on a chat ticket mis-files it. Remove `web` from the chat
  tickets (do not treat it as an addition).
- **`scaffold` tag — rejected.** A one-off activity descriptor, not a durable
  searchable facet. `infrastructure` already covers standing up a new app's
  skeleton + deploy config. Drop `scaffold`; keep `infrastructure`.

### Resulting ticket tags (apply at the renumber pass)

- **feat-192** (Vigil re-skin): `["web", "chat", "ai-chat"]` → **`["ai-chat"]`**.
- **feat-174** (scaffold): `["infrastructure", "chat", "scaffold"]` →
  **`["infrastructure", "ai-chat"]`**.

> No app-scoped tag is minted for `apps/chat` (the obvious name `chat` is the one
> rejected above, and the `ai-chat/` lane directory already provides the app
> grouping). Introduce one later only if a concrete need appears.

Under outcome **C** (drop the tickets), no vocabulary addition is needed — the
tickets are deleted and the vocabularies stay as-is.

---

## Reference inventory — files to update on renumber/relocate

Generated from `git grep -lE 'feat-174'` + `chat-app-scaffold` on
`feature/ai-chat-web-app`, classified by hand. **Update every file in the
IN-SCOPE lists; do NOT touch the EXCLUDED list** (those reference the colliding
content-discovery ticket on `main`, or the seeker ticket governed by the other
record).

### IN SCOPE — roadmap ticket (rename file + frontmatter `id`/`depends_on`/`blocks`)

- `docs/roadmap/ai-chat/feat-174-chat-app-scaffold.md` (moved here from
  `platform/`; renumber the `feat-174` ID at merge time). `blocks: [feat-192]`.
- `docs/roadmap/ai-chat/feat-192-chat-app-vigil-reskin.md` (Vigil re-skin +
  conversation shell; `depends_on: [feat-174]`). No `main` collision today
  (highest there is `feat-191`), but the ID is **provisional** — renumber both
  ends together with `feat-174` at merge time.

### IN SCOPE — plan & brainstorm docs

- `docs/brainstorms/2026-06-10-chat-app-scaffold-requirements.md`
- `docs/plans/2026-06-10-005-feat-chat-app-scaffold-plan.md` (also rename to fix the `005` seq collision)

### IN SCOPE — solutions docs (keep ticket-ID references; renumber them)

- `docs/solutions/workflow-issues/new-app-package-name-must-be-forge-scoped-for-ci.md`

### IN SCOPE — package docs (ID lives in instruction strings / links)

- `apps/chat/AGENTS.md`
- `apps/chat/README.md`
- (`apps/chat/CLAUDE.md` references the scaffold by slug but NOT the `feat-174`
  ID — no renumber needed, but re-grep on every change in case that drifts.)

### IN SCOPE — PR surface (not in git; update by hand)

- PR **#1276** body "Folds in" / integration order, if IDs change.
- This record file itself (mark the migration complete; under outcome C,
  relocate or delete it once refs are repointed).

### EXCLUDED — do NOT change (these reference the COLLIDING / other-record tickets)

- `docs/roadmap/content-discovery/feat-174-watch-search-page-size.md` (the `main` collision counterpart)
- `docs/roadmap/content-discovery/feat-172-web-search-keyword-first-opt-in.md` (links the content-discovery `feat-174`)
- `docs/roadmap/README.md` (links the content-discovery `feat-174`)
- `docs/plans/2026-06-10-002-fix-watch-search-page-size-plan.md` (the watch-search plan)
- `docs/plans/2026-06-10-005-feat-official-media-signature-indexing-plan.md` (the `005` seq collision counterpart — owned elsewhere; we renumber OUR plan, not this one)
- `ai-chat/feat-174-seeker-rag-retrieval-connection.md` (seeker line — governed by the **seeker** record, not this one)

> Note: PR numbers (**#1198**, **#1276**), the app/package name (`@forge/chat`,
> `apps/chat`), and the dev port (**3200**) are **stable identifiers** — they
> never change under any outcome. Prefer them when adding new cross-references
> so future churn stays contained to the lists above.

---

## Execution checklist (run when the decision lands)

1. Sync `main` into `feature/ai-chat-web-app` first (it drifts behind while gated).
2. Reconcile with the **seeker** record so both lines renumber in ONE pass
   against the same free-ID frontier (don't allocate the same new IDs twice).
3. Fill in the **Decision outcomes** + **Mapping table** above.
4. Apply the change across every IN-SCOPE file (rename the roadmap ticket file,
   update frontmatter `id`/`depends_on`/`blocks`, update all ID + path + plan-seq
   strings).
5. For outcome A: apply the canonical lane edits (per the seeker record), add
   the lane to `docs/roadmap/README.md`, apply the **Frontmatter vocabulary
   additions** above (owner `jianwei`; the single tag `ai-chat`) to root
   `CLAUDE.md` "Feature File Format", AND correct the ticket tags per "Resulting
   ticket tags" above (drop `web` / `chat` / `scaffold`). For outcome C: delete
   the chat roadmap ticket and repoint inbound references to the plan docs / PRs.
6. Update PR #1276's body + this record (mark complete).
7. **Verify zero stale references** before merging the renumber:

   ```bash
   # Any chat-web hit on an old ID/path/seq is a miss. The remaining feat-174
   # hits must be ONLY the EXCLUDED counterparts above.
   git grep -nE 'feat-174|2026-06-10-005' -- ':!docs/roadmap/ai-chat/LANE-DECISION-RECORD-WEB.md'
   pnpm prettier --check .
   ```
