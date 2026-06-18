# ai-chat Lane Decision & Renumber Record (CONSOLIDATED)

**Status:** DECISION RECORDED — executed by the **roadmap-only PR** that creates
this lane. This single record **supersedes and reconciles** the two earlier
per-branch records:

- `LANE-DECISION-RECORD.md` on `feature/seeker-ai-chat` (PR **#1279**, seeker)
- `LANE-DECISION-RECORD-WEB.md` on `feature/ai-chat-web-app` (PR **#1276**, chat web)

Both earlier records said the renumber/registration had to happen as **ONE
atomic pass**. This roadmap-only PR **is** that pass. When it merges, the two
feature branches inherit this record via `main` and execute only the residual
checklist below.

---

## The decision

**Decided on:** 2026-06-17 **By:** jian wei

**Outcome — "folder-only, unregistered" (a deliberate third option, not the
A/B/C of the old records):**

The `ai-chat` lane exists as a docs folder (`docs/roadmap/ai-chat/`) with its
own hand-maintained `README.md` and `CLAUDE.md`, and is **NOT registered in the
roadmap viewer app**:

- **NOT** added to `apps/roadmap/lib/features.ts` `LANE_DIRS` / `Lane` union →
  the viewer never renders these tickets.
- **NOT** added to `apps/roadmap/scripts/generate-roadmap-readme.js`
  `README_LANE_ORDER` → these tickets never appear in / are never counted by the
  generated root `docs/roadmap/README.md`.

This is neither the old "A — register the lane" (would render in the viewer) nor
"C — drop the tickets" (would delete them). The tickets are kept and tracked,
but the lane is intentionally invisible to the app. The roadmap-only PR adds a
documentation guard to `apps/roadmap` (a CLAUDE.md note + an inline comment above
`LANE_DIRS`) so nobody "fixes" the missing lane later.

**Root `CLAUDE.md` IS modified — minimally.** It is the instructional source of
truth that agents and the `ce-project-standards-reviewer` audit tickets against,
so leaving the owner `jian wei` undeclared there would make every ai-chat ticket
look like a vocabulary violation. The roadmap PR therefore: adds `jian wei` to the
owner list; lists `ai-chat/` in the Roadmap Structure tree annotated as a
docs-only, unregistered lane; and adds a one-line pointer telling anyone editing
an ai-chat ticket to read this folder's `CLAUDE.md` first. Those edits are
**durable** and point at the lane `CLAUDE.md`, never at this record.

**No `ai-chat` tag.** We deliberately do NOT add an `ai-chat` entry to the tag
vocabulary. Per the sibling `jesusfilm-ai` convention, tags are _secondary_
engineering scopes — a ticket is never tagged with its own lane (that re-encodes
the directory, the same anti-pattern as a `lane:` field). Forge's existing tag
vocab has no clean fit for mastra-agent / chat-web work, so tickets carry only a
genuinely-applicable existing facet (`search`, `infrastructure`) or `[]`.

### ID strategy

Stay in the global `feat-NNN` sequence (no separate namespace), and renumber to
the current global frontier. Rationale: the global sequence already contains 80+
duplicate IDs across lanes (pre-existing, not CI-enforced); a separate namespace
would buy isolation the rest of the roadmap doesn't have, and cross-lane
references (`feat-197 depends_on feat-129`) read naturally in one sequence.

---

## Mapping table — old (gated branches) → new (this lane)

> **Assigned once, here.** `feat-196` is the highest **defined** ID on this
> fresh-off-`main` branch (held by
> `topic-experiences/feat-196-watch-compatible-download-filenames.md`), so this
> block starts at `feat-197`; `197–200` are free today. We do **not** chase the
> frontier: if a parallel branch consumes one of these before merge, the
> resulting cross-lane duplicate is acceptable (the repo already carries 80+ such
> dups and this lane isn't rendered). Feature PRs adopt these IDs as-is. The only
> collision this renumber actually resolves is the within-lane / cross-PR clash —
> two `feat-174`s (seeker-RAG + chat-scaffold) would otherwise land in this same
> folder and corrupt the `depends_on` / `blocks` graph.

| Old (branch)                          | Source PR | New (this lane) | Lands as    | Flips to (on code-PR merge) |
| ------------------------------------- | --------- | --------------- | ----------- | --------------------------- |
| `feat-170` seeker-agent-skeleton      | #1279     | **`feat-197`**  | in-progress | complete                    |
| `feat-174` seeker-rag-retrieval-conn. | #1279     | **`feat-198`**  | in-progress | (true state at merge)       |
| `feat-174` chat-app-scaffold          | #1276     | **`feat-199`**  | in-progress | complete                    |
| `feat-192` chat-app-vigil-reskin      | #1276     | **`feat-200`**  | in-progress | complete                    |

Bidirectional links updated to the new IDs: 197 `blocks` 198 / 198 `depends_on`
197; 199 `blocks` 200 / 200 `depends_on` 199. `feat-197 depends_on feat-129`
(Mastra runtime, `platform` lane) is unchanged — a real, stable cross-lane ID.

### Plan-doc sequence collisions (separate namespace — rename in the feature PRs)

| Plan seq (branch)                                | Collides with (on `main`)                                       | Action                                      |
| ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------- |
| `2026-06-10-002` (seeker-rag plan, #1279)        | `2026-06-10-002-fix-watch-search-page-size-plan.md`             | rename the seeker plan to a free `002`+ seq |
| `2026-06-10-005` (chat-app-scaffold plan, #1276) | `2026-06-10-005-feat-official-media-signature-indexing-plan.md` | rename the chat plan to a free `005`+ seq   |

### Tag normalization applied to the tickets here

Tags are secondary scopes only — never the ticket's own lane. Normalized to the
genuinely-applicable existing forge facet, or `[]` where none fits:

- **feat-197 (seeker skeleton):** `["ai-chat", "agent"]` → **`[]`** (no existing
  forge facet fits a mastra agent; the lane already conveys ai-chat).
- **feat-198 (seeker RAG):** `["ai-chat", "agent"]` → **`["search"]`** (it's
  retrieval).
- **feat-199 (scaffold):** `["infrastructure", "chat", "scaffold"]` →
  **`["infrastructure"]`** (dropped generic `chat` and one-off `scaffold`;
  `infrastructure` covers standing up an app).
- **feat-200 (vigil):** `["web", "chat", "ai-chat"]` → **`[]`** (`web` is the
  wrong app — that tag is `apps/web`; `chat` is generic; no facet fits a chat-UI
  reskin).

---

## Status protocol (why everything is `in-progress`)

A ticket reflects what is on `main`. The roadmap-only PR lands ahead of the
feature code, so every ticket lands `in-progress` even when the work is finished
on its gated branch (feat-197 and feat-200 are `complete` on their branches).
Flip to `complete` only when the **code PR** merges. "In progress on `main`"
means "tracked, code pending merge" — not lost work. There is a transient window
after this PR merges where `main` shows `in-progress` for done-but-unmerged work;
that is expected and harmless.

---

## Residual checklist for the FEATURE PRs (after this roadmap PR merges)

Once this PR is on `main`, the two feature branches stop creating roadmap
tickets and shrink to the four mechanical steps below. The git reality: because
the tickets were **renumbered** (filenames changed), merging `main` does NOT
auto-collapse them — each branch will carry BOTH its old-ID file and the new-ID
file until you delete the old one by hand.

### PR #1279 (`feature/seeker-ai-chat`)

1. Merge/rebase `origin/main` (now carrying `feat-197` / `feat-198`).
2. `git rm` the branch's old-ID ticket files:
   `docs/roadmap/ai-chat/feat-170-seeker-agent-skeleton.md`,
   `docs/roadmap/ai-chat/feat-174-seeker-rag-retrieval-connection.md`, and the
   branch's old `LANE-DECISION-RECORD.md` (superseded by this one).
3. Flip status on the new-ID files: `feat-197` → `complete`; `feat-198` → its
   true state at merge. Prepend a `## Resolution` section (see the lane
   `CLAUDE.md` template) to each ticket flipped to `complete`. Update this lane's
   `README.md` Status block + table (emoji-prefixed).
4. Repoint references to the new IDs across the seeker IN-SCOPE inventory (from
   the old seeker record): brainstorms `2026-06-08-...` / `2026-06-10-...`; plans
   `2026-06-08-003-...` and `2026-06-10-002-...` (also rename the `002` plan
   seq); solutions docs (mocked-shape-vs-real, single-service-http-client,
   mastra-conversational-agent-memory, mastra-studio-api-auth-guard);
   `apps/mastra/CLAUDE.md`, `env.ts`(+test), `seeker-agent.ts`(+test),
   `memory.ts`, `seeker-route-isolation.test.ts`, `retrieve-answer.ts`,
   `jesusfilm-rag-client.ts`; and PR #1279's body.

### PR #1276 (`feature/ai-chat-web-app`)

1. Merge/rebase `origin/main` (now carrying `feat-199` / `feat-200`).
2. `git rm` the branch's old-ID ticket files:
   `docs/roadmap/ai-chat/feat-174-chat-app-scaffold.md`,
   `docs/roadmap/ai-chat/feat-192-chat-app-vigil-reskin.md`, and the branch's
   old `LANE-DECISION-RECORD-WEB.md` (superseded by this one).
3. Flip status on the new-ID files: `feat-199` → `complete`; `feat-200` →
   `complete`. Prepend a `## Resolution` section (see the lane `CLAUDE.md`
   template) to each. Update this lane's `README.md` Status block + table
   (emoji-prefixed).
4. Repoint references to the new IDs across the chat-web IN-SCOPE inventory (from
   the old web record): brainstorm `2026-06-10-chat-app-scaffold-requirements.md`;
   plan `2026-06-10-005-feat-chat-app-scaffold-plan.md` (also rename the `005`
   plan seq); solutions doc
   `new-app-package-name-must-be-forge-scoped-for-ci.md`; `apps/chat/AGENTS.md`,
   `apps/chat/README.md` (and re-grep `apps/chat/CLAUDE.md`); and PR #1276's body.

> **Do NOT touch** the EXCLUDED collision counterparts that live elsewhere on
> `main` (the `content-discovery/feat-170`, `feat-172`, `feat-174` files;
> `docs/roadmap/README.md`'s links to them; the watch-search and
> official-media-signature plans). Those reference different tickets and stay as
> they are.

---

## Verification (run on each feature PR before merging the renumber)

```bash
# Any seeker/chat-web hit on an OLD id/path/seq is a miss. Remaining feat-170 /
# feat-174 / feat-192 hits must be ONLY the EXCLUDED main-side counterparts.
git grep -nE 'feat-170|feat-174|feat-192|2026-06-10-002|2026-06-10-005' \
  -- ':!docs/roadmap/ai-chat/LANE-DECISION-RECORD.md'
pnpm prettier --check .
```

Stable identifiers (never renumber — prefer these in new cross-references):
PR numbers **#1276**, **#1277**, **#1279**, **#1294**; package/app names
`@forge/mastra`, `@forge/chat`, `apps/chat`; dev port **3200**; agent/file names
`seekerAgent`, `jesusfilm-rag-client.ts`; the `CONCEPTS.md` "Seeker Agent" entry.

## This file is disposable — delete it when both PRs land

This record is a **transient migration ledger**, not durable lane documentation.
The permanent knowledge (what the lane is, why it is unregistered, how to
maintain the README, the global-ID rule, the status-flip convention) lives in
this folder's `README.md` and `CLAUDE.md`. Those durable docs are self-contained
and deliberately do **not** reference this file, so it can be removed cleanly.

**Deletion is the last feature PR's job, not the first.** Both #1276 and #1279
need the mapping table + checklist, so the record must survive until both have
merged. Whichever of the two merges **second**:

1. `git rm docs/roadmap/ai-chat/LANE-DECISION-RECORD.md`.
2. Confirm nothing references it (should already be zero — no durable doc, and
   not even the tickets, names this file):
   ```bash
   git grep -n 'LANE-DECISION-RECORD' -- ':!docs/roadmap/ai-chat/LANE-DECISION-RECORD.md'
   ```

## Done when

- This PR merged; IDs confirmed against the live frontier (table updated if they
  moved).
- Both feature PRs executed their residual checklist; the verification grep
  returns only EXCLUDED main-side counterparts.
- This lane's `README.md` reflects the final statuses.
- The **second** feature PR to merge deleted this record and confirmed no
  durable doc references it.
