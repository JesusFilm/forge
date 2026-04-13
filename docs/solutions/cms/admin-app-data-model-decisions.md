---
title: Admin App Data Model Decisions
category: cms
date: 2026-04-13
tags:
  [
    data-model,
    schema-design,
    prisma,
    content-modeling,
    drafts,
    revisions,
    video,
    experience,
    admin-app,
  ]
---

# Admin App Data Model Decisions

## Problem

The custom admin app (`apps/admin/`, the Strapi replacement) needed a data
model decision in Unit 4 of its plan. The naive approach was to mirror Core
API and Strapi shapes one-for-one. That would have shipped a model with at
least eight design defects we'd have paid for repeatedly: confusing names,
attachment grains that contradicted their semantics, embedding placement
that fights language-aware search, redundant timestamp columns, and no
plausible answer for revision tracking.

This entry captures the modeling decisions made during Phase 2 of the admin
app build (PR #748) so future contributors don't re-derive them. Each
decision states the principle, the alternative we considered, and the
reason we landed where we did.

## Underlying principles

Three principles drove most decisions in this thread. When in doubt, fall
back to these.

### 1. Things attach where their semantics live, not where they're generated

The grain at which an artifact is stored should match the grain of the
property it depends on, not where it happened to be produced.

- **Subtitles** attach to `VideoEdition` because timecodes derive from the
  cut (a director's cut starts scenes at different timestamps than a
  theatrical cut). They do NOT attach to `Video` (the wrapper) or to
  `VideoDub` (the audio language). Subtitle text is independent of audio
  language — a French subtitle says "Bonjour" whether the audio plays
  English or Spanish.
- **Editorial metadata** (title, description, snippet) attaches to
  `VideoLocale` because it's audience-bound — the title's job is to
  communicate to a Spanish-speaking viewer, which is a property of the
  locale, not of which audio dub plays. Metadata does NOT attach to
  `VideoDub` even though AI generation runs per-dub.
- **Embeddings for semantic search** attach to `ExperienceLocale`, not the
  canonical `Experience` row. A Spanish user's query embeds against
  Spanish content, an English user's against English. Per-locale
  embeddings give in-language semantics; one canonical embedding leans on
  multilingual-embedding-model approximation and loses editor-curated
  locale nuances.

The unifying observation: AI generation runs against one source (a
specific dub, a specific edition's frames) but the _output_ often projects
up to a different grain (the locale, the audience). Keep the source/output
asymmetry honest in the schema.

### 2. Name things by what they ARE, not by external convention

External APIs use whatever vocabulary they were born with. The local model
should use vocabulary that matches the actual varying axis.

- Core API exposes `video-variant` as an umbrella term. The varying axis
  between rows is the **audio language** (a dub of an edition's frames).
  We renamed to `VideoDub`; Core sync translates `coreVariant → dub` at
  the boundary.
- Subtitles, transcripts, and closed captions are all "timed text tracks
  for an edition." A transcript is a source-language subtitle; closed
  captions are same-language-as-the-dub subtitles; everything else is a
  translation. The semantic distinction is derivable from `languageId` vs
  the dub's audio language at query time. One unified `VideoSubtitle`
  table — no separate `Transcript` or `ClosedCaption` models.

### 3. Canonical row = current state. History lives elsewhere

Mixing "what is" and "what was" in the same row creates ambiguity. The
canonical row should be the authoritative current state; pending and prior
states live in a separate history table.

- For PUBLISHED entities, the canonical row IS the published version.
  Public reads target it directly with no `WHERE status = 'published'`
  filter.
- DRAFT revisions hold editor's in-flight changes. Canonical is untouched
  until publish.
- Publish snapshots canonical to a HISTORICAL revision, then applies the
  DRAFT to canonical, then deletes the DRAFT.
- New content uses a stub canonical with `status=DRAFT` (`LocaleStatus`)
  so multi-day editing sessions don't pollute the public read path.

## Concrete decisions

### Naming: `VideoDub` not `VideoVariant`

`VideoDub` is the entity formerly known as `VideoVariant`. The varying
axis is the audio dub language; the frames belong to the parent
`VideoEdition`. "Variant" was Core's umbrella term but ambiguous about
what varies; "dub" is what editors and AI workflows actually mean.

`VideoDubDownload` is the rename of `VideoVariantDownload` — quality tiers
(mp4 480p, 720p, …) of a dub's packaging.

Boundary translation: Core API still exposes `video-variant`. Core sync
translates at the transform layer (`coreVariant → dub`), not at the DB.

Other naming considerations rejected:

- **Rendition** — overloaded with "quality tier" in everyday streaming
  vocabulary; would collide with `VideoDubDownload`.
- **AudioTrack** — accurate but technical; "dub" is editorial-friendly
  and shorter.
- **Release** — has marketing flavor; loses the connection with the
  Mux/encoding layer.

### Subtitles attach to `VideoEdition`

The current model has `VideoSubtitle.videoEditionId` (FK to
`VideoEdition`), not `videoId`. Reasoning:

- Timecodes derive from the edition's cut.
- The same French subtitle file works across all language dubs of the
  same edition because the dialogue text is independent of audio dub.
- Storage and editorial efficiency: 5 editions × 100 dubs = 1 subtitle
  file per language at edition grain, vs 500 at dub grain.

If a variant has its own timing tweaks (regional broadcast cut,
censorship), it should be modeled as a different `VideoEdition`, not as
a Variant/Dub variation. Forces the model to be crisp: anything that
breaks timecode alignment with the edition becomes its own edition.

### One unified `VideoSubtitle` entity

No separate `Transcript` or `ClosedCaption` models. The `VideoSubtitle`
table covers all timed text tracks; semantics derive from `languageId`
vs the dub's audio language at query time:

- **Source-language subtitle** ≈ transcript
- **Target-language subtitle** = translation
- **Same-language-as-dub subtitle** ≈ closed caption

Application code can interpret. Adding a `kind` enum is premature for v1.

### Embeddings attach per-locale (`ExperienceLocale.embedding`)

`embedding Unsupported("vector(1536)")?` lives on `ExperienceLocale`,
not the canonical `Experience` row. The HNSW partial index is on
`experience_locale.embedding WHERE embedding IS NOT NULL`.

Reasoning:

- Per-locale embeddings give in-language semantic search. A Spanish
  user's query embeds against Spanish content embeddings.
- Editor-curated locale nuances (different emphasis in the Spanish
  version vs English) are captured per-locale, not averaged through a
  multilingual embedding model.
- Cross-locale discovery (Spanish user wanting English-only content) is
  an application-level concern, easy to handle by querying multiple
  locales and ranking.

`embedding` is NEVER exposed via GraphQL (technical control: omitted
from the Pothos type definition; schema test asserts no
`/embed|vector|similarit/i` field appears anywhere).

### Drop `coreUpdatedAt`; sync writes Core's value into `updatedAt`

Two-column model (`coreUpdatedAt` + `updatedAt`) was over-engineered.
For Core-sourced entities that are read-only at the GraphQL layer in
v1, the two values are always equal.

The collapse: sync passes `updatedAt: coreData.updatedAt` explicitly in
the upsert payload. **Prisma's `@updatedAt` only auto-fills when the
value is omitted**, so the explicit value is respected.

Behavior:

- Sync writes: `updatedAt` = Core's authoritative timestamp
- Local writes via Prisma client (rare; only for `source='manager'` rows
  or future admin-authoritative entities): `updatedAt` auto-bumps to
  `NOW()` — the right semantic for editor edits
- Stale-write guard reads `updatedAt` for ordering across both cases
- `syncedAt` stays as the "when did admin last refresh this row"
  freshness signal

Strategic consequence: when admin eventually becomes the source of
truth for some entities (Language, Country, etc.), `source` flips from
`'core'` to `'manager'`, sync stops running for those phases, and
`updatedAt` naturally becomes "when admin's row last changed" via
auto-bump. The model accommodates the transition without further
schema changes.

### Canonical-as-published + draft-as-revision pattern

`ContentRevision` is a generic, append-only revision log covering five
editor-mutable entity types: `ExperienceLocale`, `Experience`,
`VideoLocale`, `Video`, `VideoDub`. One table for all so adding revision
tracking to a new entity is a service-layer change, not a migration.

Status enum:

- `DRAFT` — pending changes; not yet promoted to canonical. At most
  ONE draft per `(entity_type, entity_id)` enforced by partial unique
  index `WHERE status = 'draft'`.
- `HISTORICAL` — snapshot of canonical at the moment of a publish.
  Builds the audit trail for rollback / diff.
- `DISCARDED` — draft abandoned without being published.

**Editor flow (PUBLISHED entities):**

1. Editor opens published entity → reads canonical
2. Edits → service creates or updates the entity's DRAFT revision;
   canonical untouched. In-flight changes can span days.
3. Publish → service `$transaction`: snapshot canonical to HISTORICAL,
   apply DRAFT to canonical, delete DRAFT row.

**New content (no canonical yet):**

- Service creates a stub canonical row with `status=DRAFT`
  (`LocaleStatus`) and minimum required fields filled with placeholders.
- Editor's actual content evolves in a DRAFT revision over the multi-day
  editing session.
- First publish: snapshot canonical (stub) to HISTORICAL, apply DRAFT to
  canonical, flip canonical status to PUBLISHED.

The reason for stub-then-draft (not editor-edits-canonical-directly): a
brand-new Experience may take days to author. Editing canonical directly
would require a `WHERE status != 'draft'` filter on every public read or
risk leaking placeholder content. Routing through draft revisions keeps
public reads simple: just read canonical filtered by `status=PUBLISHED`.

### Generic `ContentRevision` table, not per-entity

Rejected per-entity revision tables (`ExperienceLocaleRevision`,
`VideoLocaleRevision`, …). Reasoning:

- One table covers all editor-mutable entities; adding revision
  tracking to a new entity is a service-layer change with no schema
  migration.
- Aligns with R25 (agent extensibility — agents don't have to remember
  to add per-entity revision tables).
- Cross-entity audit queries become possible ("what did Alice edit last
  week?").
- Future migration is supported: when admin becomes source of truth for
  an entity (e.g., Language), bulk-update `source` from `'core'` to
  `'manager'`, stop running that Core sync phase. From then on, edits
  through the service layer create revisions automatically — no schema
  change needed.

Trade-off: snapshot column is JSONB (not type-safe at the DB level) and
indexing on JSON fields is painful. Acceptable: revisions are read by
service code that knows the entity type and can cast.

### Service-layer rule (lands in Unit 7)

Any service-driven UPDATE on a covered entity creates / updates a
revision in the same `$transaction`. Specific rules:

- First local edit on a `source='core'` row also flips `source` to
  `'manager'` so future Core sync skips it.
- Sync writes (raw SQL or via Prisma with explicit `updatedAt`) skip
  revisioning — sync isn't editorial.
- Workflow-derived column updates (e.g.,
  `ExperienceLocale.embedding` from the embedding workflow) skip
  revisioning — derived data isn't editorial intent.
- `revisedByKind` provenance:
  - `'user'` — editor in admin UI
  - `'ai'` — AI workflow output (e.g., AI-generated metadata draft)
  - `'system'` — migration scripts, programmatic lifecycle events
    (archive, ownership transfer)

### 60-day retention via useworkflow job (Unit 11)

Daily prune: `DELETE FROM content_revision WHERE revised_at < NOW() -
INTERVAL '60 days'`. Index on `revised_at` makes it fast.

Lands with the rest of useworkflow wiring in Unit 11. Until then no
pruning runs (acceptable — minimal revision volume in dev).

### Reference data localization: JSON map, not per-locale rows

Localized display names on reference data (`Language.name`,
`Country.name`, `Continent.name`, `BibleBook.name`) use a single JSONB
column keyed by locale code:

```json
{ "en": "English", "es": "Inglés", "fr": "Anglais" }
```

Reasoning: low-cardinality reference data with a single localized field
(just the display name) doesn't justify a per-locale rows table. Per-
locale rows are reserved for content where editors curate translations
independently and embeddings are per-locale (Experience, Video).

## Decisions captured for future work (deferred but documented)

- **Encoding decoupling**: `hls`, `dash`, `muxVideoId`, `brightcoveId` on
  `VideoDub` could move to a `VideoEncoding` table so a Dub becomes
  purely `{ language, edition, audioFile }`. The encoded artifacts are
  separate concerns. Cleaner separation; harder to retrofit later.
  Deferred — not blocking v1.
- **Video embedding grain (post-manager-absorption)**: Scene embeddings
  attach to Edition (frames + timeline), VideoLocale embeddings handle
  editorial-metadata search. No `Video.embedding` and no single
  `VideoLocale.embedding` catchall — the search use cases have different
  attachment grains.
- **`VideoLocaleMetadataDraft`**: future table capturing AI-generated
  metadata suggestions with source Dub/Edition, proposed values, and
  status. Editor reviews and either promotes to VideoLocale canonical or
  discards. Not needed in v1.
- **Closed-caption / transcript split**: keep one `VideoSubtitle` table;
  derive semantic at query time. Add a `kind` enum only when access
  patterns diverge enough to need it.
- **Approval workflow**: not in v1. Direct publish via existing
  `LocaleStatus` enum. Add a `pending_review` status + reviewer
  assignment when the team actually asks for it.
- **Concurrent-editor drafts**: one draft per entity in v1 (last write
  wins on the draft row, optimistic locking via `revisedAt`). Per-editor
  drafts (Alice has a draft, Bob has a draft) are out of scope until an
  actual collision happens.
- **`VideoOrigin.name` / `VideoEdition.name`**: currently plain `String`,
  while most Core-sourced reference types use JSONB locale-map. Audit
  Core's response shape during Unit 10 and normalize.

## Migration history

Phase 2 collapsed iterative schema migrations into a single `0001_init`
because no production database had applied any of them. Future schema
changes append new migration files as normal. The collapse + per-locale
embedding move was a single commit; subsequent commits in the same PR
edited `0001_init` in place (acceptable while pre-remote-DB).

When the next environment receives `0001_init`, the assumption is broken
and migrations become append-only forever after.

## References

- Phase 1 PR: https://github.com/JesusFilm/forge/pull/746 (scaffold +
  Prisma/pgvector + GraphQL spike)
- Phase 2 PR: https://github.com/JesusFilm/forge/pull/748 (data model)
- Plan: `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md`
- Requirements: `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md`
- App-level docs: `apps/admin/CLAUDE.md` and `apps/admin/AGENTS.md`
