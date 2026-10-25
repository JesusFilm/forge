---
date: 2026-04-23
topic: r3-experience-content-migration
---

# R3 — Experience Content Migration (cms → admin)

## Problem Frame

`apps/admin` is the strategic replacement for `apps/cms` (Strapi v5).
R1 + R2 (PR #828) gave admin scene + transcript embedding infrastructure,
but admin's Experience corpus is empty. R4 (hybrid search) and R5
(recommendations) both need real experience content to retrieve and rank
over; without it, admin's Experience surface is structurally complete but
operationally inert, and search/rec quality cannot be measured against
cms parity.

R3 closes that gap by populating admin's `Experience` + `ExperienceLocale`
tables from cms, transforming Strapi's field-level i18n + dynamic-zone
shape into admin's per-locale row + Zod `BlockSchema` shape. cms remains
the editor surface and the consumer-facing renderer until consumer
cutover at R8; admin's experience corpus is a refreshed mirror of cms
during the R3→R8 window, with a merge policy that lets admin-side
editor work coexist with periodic cms refreshes.

## Requirements

- **R3.1** Admin gains an ADMIN-only GraphQL mutation
  `triggerExperienceContentDump` that dumps cms's `experience` corpus
  into admin's `Experience` + `ExperienceLocale` tables. Returns the
  same JSON shape R1/R2 backfill mutations return (parity with
  `triggerSceneEmbeddingBackfill`, `triggerTranscriptEmbeddingBackfill`).
- **R3.2** The mutation runs as a useworkflow job dispatched via
  `start()` from `workflow/api`, with a dispatch-level test in the
  R1/R2 style (per the Cross-Cutting Constraints in the playbook).
- **R3.3** The dump reads cms data directly from cms's Postgres (not
  Strapi REST or GraphQL) using a new `CMS_DATABASE_URL` env on
  `forge-admin`. Read-only DB role recommended.
- **R3.4** Every cms `experience` row (one per locale, per Strapi v5
  field-level i18n) is dumped:
  - cms rows where `published_at IS NOT NULL` land as admin
    `ExperienceLocale.status = PUBLISHED` with `publishedAt =
cms.published_at`.
  - cms rows where `published_at IS NULL` (drafts) land as admin
    `ExperienceLocale.status = DRAFT` with `publishedAt = NULL`.
  - Sibling locales of the same cms experience are grouped into a
    single admin `Experience` (canonical) with N `ExperienceLocale`
    children, one per locale.
- **R3.5** `Experience.isTemplate` (the only non-localized cms attribute)
  is dumped onto the admin `Experience` row.
- **R3.6** Dumped block content is transformed from Strapi's dynamic-zone
  component shape into admin's Zod `BlockSchema` shape. Every dumped
  `ExperienceLocale.blocks` array MUST validate against
  `apps/admin/src/domain/blocks.ts::BlocksSchema` before being written.
  A locale with any block that fails validation fails that locale (not
  the whole run); failure is reported in the per-target stats and the
  workflow continues.
- **R3.7** The set of locales dumped is data-derived: the workflow
  enumerates `SELECT DISTINCT locale FROM experience` against cms at
  enumeration time. No hardcoded locale list, no fallback to `en`.
  Caller may restrict via an optional `locales: [String!]` arg as a
  pure inclusion predicate (omitted = "every locale that exists in the
  cms corpus"). Same convention as R1's `locales` arg.
- **R3.8** Reruns are idempotent and merge-aware:
  - Match cms-source rows to admin rows on a stable cms identifier
    (cms's numeric `document_id` / `id`, captured on each
    `ExperienceLocale` as a new `cmsExperienceId` column or equivalent
    — schema decision deferred to planning).
  - On rerun, fields admin can derive from cms (slug, title,
    metaDescription, ogTitle, ogDescription, ogImageUrl, pathSegment,
    isHomepage, blocks, status, publishedAt) are overwritten when
    cms's value differs from the per-row last-dumped snapshot.
  - Admin-only state survives reruns: any `ContentRevision` row
    (DRAFT or HISTORICAL) attached to the locale is untouched. Admin
    can also accept editor input during the R3→R8 window via
    ContentRevisions, knowing that subsequent reruns won't wipe them.
- **R3.9** Per-locale embedding refresh: after the merge writes for a
  locale complete, the workflow computes a content hash over the
  text the embedder consumes (`title` + `metaDescription` + `blocks`
  flattened to text per admin's existing `runExperienceEmbedding`
  text-flattener). If the hash differs from the previously-stored
  hash for that locale, dispatch `runExperienceEmbedding` for that
  locale. Otherwise skip. First-time dumps always embed.
- **R3.10** `Experience.ownerId` is `NULL` on every dumped
  Experience. No "system" user is seeded.
- **R3.11** Per-target error isolation in the workflow: a single
  failing locale (validation error, slug-uniqueness collision,
  embedding-dispatch failure) is recorded and does not halt the run.
  Run summary returned by the mutation tallies counts per outcome
  (`created`, `updated`, `skipped_unchanged`, `failed_validation`,
  `failed_other`).
- **R3.12** Verifiable rerun safety: running the mutation twice with
  no cms-side changes between runs produces zero writes on the
  second run beyond updating per-row last-dumped timestamps.
- **R3.13** A planning-time recon step (NOT shipped code): connect a
  read-only role against prod cms's Postgres and capture the exact
  Strapi v5 i18n + dynamic-zone schema (`experiences`,
  `experiences_localizations_lnk`, `experiences_components`,
  `components_sections_*`, `files` for media) so the dump SQL is
  written against verified shape. Per the existing CLAUDE.md note,
  Strapi snake-cases field names in the DB (`bcp47` → `bcp_47`).

## Success Criteria

- After a clean run against prod cms: `SELECT COUNT(*) FROM experience`
  in admin equals `SELECT COUNT(DISTINCT document_id) FROM experiences`
  in cms.
- After the same run: `SELECT COUNT(*) FROM experience_locale` in admin
  equals `SELECT COUNT(*) FROM experiences` in cms (each cms i18n row
  is one admin locale).
- Every dumped `ExperienceLocale.blocks` array passes
  `BlocksSchema.parse()` — zero validation failures on the prod cms
  corpus.
- `LocaleStatus` distribution in admin matches cms's draft/published
  distribution per locale.
- Re-running the mutation with no cms-side changes produces zero block
  / metadata writes (only timestamp bookkeeping).
- After the embed-trigger phase: `SELECT COUNT(*) FROM
experience_locale WHERE status='PUBLISHED' AND embedding IS NOT NULL`
  equals the published row count, downstream of normal workflow
  completion latency.
- A subsequent edit in cms to one block of one locale results in
  exactly that locale's row being re-written and exactly that
  locale's `runExperienceEmbedding` being dispatched on the next
  rerun.
- An admin-side `ContentRevision` DRAFT created between two reruns
  exists unchanged after the second rerun.

## Scope Boundaries

- **No write-protection on cms.** R3 does not lock cms's Experience
  content type or restrict cms editing in any way. Editors can keep
  authoring in cms during R3→R8; the rerunnable dump picks up their
  changes. Adding cms-side enforcement is a separate decision that
  doesn't belong here.
- **No consumer cutover.** apps/web and apps/mobile keep reading
  Strapi-backed `packages/graphql` until R8. R3 doesn't change any
  consumer query.
- **No cms decommission work.** Deleting Strapi code, the
  `experience` content type, or the `feat-022` kill switch are R8 /
  R9 / R10 concerns owned by whoever drives Strapi removal.
- **No Strapi REST or GraphQL dependency.** Direct Postgres only,
  per the chosen trigger model — REST omits/gates fields based on
  permissions and dynamic-zone populate has known limits that can
  silently drop blocks.
- **No new Strapi-source-only fields persisted on admin.** If a cms
  field has no admin-side equivalent (e.g. Strapi internal metadata
  like `created_by_id`), it's dropped at the boundary. Adding new
  admin columns to mirror cms internals is out of scope.
- **No new admin-side write surface for "advance an admin DRAFT to
  PUBLISHED on a dumped row."** That's already supported by the
  existing ContentRevision publish flow; R3 just doesn't change it.
- **No admin Experience UI changes.** Tatai's parallel feat-100 /
  feat-103 editor work is unaffected. R3 ships data + workflow only.
- **No backwards or forwards compatibility scaffolding.** First
  dump runs against the schema the planning recon step verifies; a
  future cms schema drift would need a new R3 PR, not a versioned
  dumper.
- **No hardcoded locale defaults of any kind**, including on the
  embed-trigger phase. Confirmed pattern from R1/R2 retrofits.
- **Embedding generation runs through admin's existing
  `runExperienceEmbedding` workflow unchanged.** R3 dispatches it;
  it does not modify or fork it.

## Key Decisions

- **Operational model: rerunnable, cms remains source until R8.** cms
  is the editor surface during the R3→R8 window. Admin's Experience
  corpus is a refreshed mirror that catches cms edits on each rerun.
  **Why:** lets editors keep working in cms uninterrupted while admin
  builds out R4/R5/R6 against a representative corpus; avoids needing
  to coordinate a cms editing freeze that could last weeks.
- **Conflict policy on rerun: cms-derived fields overwrite; admin
  ContentRevisions survive.** A rerun re-writes the canonical row's
  content fields from cms; admin-side DRAFTs (ContentRevision rows)
  are preserved because they live in a separate table that the dump
  doesn't touch. **Why:** treats cms as canonical for content during
  the window without invalidating in-flight admin editor work, which
  matters because tatai's editor surfaces continue evolving.
- **Trigger: admin GraphQL mutation → useworkflow → direct cms
  Postgres.** Mirrors R1/R2's mutation parity (return shape,
  ADMIN-only, useworkflow dispatch). Reads cms via PG, not REST or
  GraphQL. **Why:** cms's Strapi REST gates fields by permission and
  has known dynamic-zone populate limits that can silently omit
  blocks; PG sees the canonical state. Cost is a new env dep on
  forge-admin (`CMS_DATABASE_URL`, read-only role) and admin code
  that understands Strapi v5's i18n + dynamic-zone tables — both
  acceptable given admin will outlive cms.
- **Owner mapping: NULL.** Dumped Experiences carry `ownerId = NULL`.
  **Why:** matches the schema's existing comment ("Nullable for
  system-imported templates"); the implicit signal "ownerId NULL =
  came from cms" is more honest than synthesizing a fake user; ABAC
  for ADMIN-tier already accepts null ownership.
- **Draft+publish mapping: 1:1 onto admin LocaleStatus.** cms drafts
  → admin `DRAFT`; cms published → admin `PUBLISHED`. **Why:** keeps
  cms's full editor state visible in admin so editors can browse
  drafts cross-app; the merge policy + ContentRevision separation
  cleanly handle the resulting "cms DRAFT and admin
  ContentRevision DRAFT both exist" case (they describe different
  layers, not competing states).
- **Re-embed on per-locale content change only.** Skip
  `runExperienceEmbedding` dispatch when the locale's hashable
  content is unchanged from the last dump. **Why:** cron-friendly
  reruns shouldn't bill OpenRouter for identical content; the cost
  of computing a hash is trivial vs the cost of re-embedding.
- **Locale enumeration is data-derived.** `SELECT DISTINCT locale
FROM experience` against cms; no hardcoded list, no `en` fallback.
  **Why:** R1 and R2 both got retrofitted to the data-derived
  pattern in PR #828; R3 ships with it from day one per the
  prototype-defaults learning.
- **Block transform mirrors cms component names 1:1.** Strapi's 15
  experience-level + 1 quiz-button section-only components map
  directly onto admin's 16 BlockSchema variants by name (Strapi's
  `sections.cta` → admin's `t: "cta"`, etc. — see admin's
  `src/domain/blocks.ts` header which already asserts this mapping
  is an authored intent). Block transform inventory + per-component
  field-level deltas land in planning.
- **Per-row last-dumped snapshot.** Some store of "what cms looked
  like on the last dump" is required for the change-detection +
  conflict policy. Concrete shape (a column on `ExperienceLocale`
  vs a separate `CmsExperienceDumpSnapshot` table) deferred to
  planning, but the requirement to persist it is settled here.

## Dependencies / Assumptions

- `forge-admin` Railway service can be granted a read-only role on
  cms's Railway Postgres. Platform team to authorize the connection;
  cross-service DB access on Railway is supported.
- cms's Strapi v5 schema for `experience` + the 16 `components_sections_*`
  tables is stable for the duration of R3→R8. A schema change in cms
  during the window means the dump's SQL needs updating before the
  next rerun.
- The Strapi `experiences_localizations_lnk` table (or equivalent —
  Strapi v5 uses `documentId` for the cross-locale grouping) is the
  authoritative way to identify "these N rows are the same
  Experience in different locales". Planning recon must confirm the
  exact table + column names.
- admin's `runExperienceEmbedding` workflow accepts a per-locale
  dispatch shape compatible with what R3 will hand it. If not, the
  embed-trigger phase needs a small workflow-side wrapper, captured
  in planning.
- cms's `published_at` semantics in Strapi v5 (one row per locale, so
  draft vs published is a per-locale property, not a per-document
  property) hold against the recon. A documented Strapi v5 quirk —
  re-confirm against the actual cms DB schema.
- Tatai's parallel feat-100 / feat-103 work on admin's experience
  editor surfaces does not depend on the dumped corpus being absent.
  Confirmed by playbook's "editor UX parity is not blocking" scope
  boundary.

## Outstanding Questions

### Resolve Before Planning

_(none — all blocking product decisions resolved.)_

### Deferred to Planning

- **[Affects R3.6][Technical] Block transform field-level delta.**
  Walk every `apps/cms/src/components/sections/*.json` against the
  matching `apps/admin/src/domain/blocks.ts` Zod schema and produce a
  field-by-field delta: which Strapi fields don't exist on admin's
  shape (drop?), which admin fields are required but unmapped (fail
  validation?), which differ in shape (e.g. Strapi `richtext` →
  admin plain string for `cta.body`, Strapi media relation →
  admin URL string for `*.imageUrl`, `videoHero.video` relation →
  admin `videoId` cuid). Resolve drop vs extend admin schema vs
  enrich at transform time on a per-field basis.
- **[Affects R3.6][Technical] Strapi media → admin URL resolution.**
  cms uses Strapi media relations for `experience.ogImage` and
  `*.imageUrl` / `*.backgroundImageUrl` / `*.mediaUrl` fields on
  components. Admin stores these as plain URL strings. Confirm
  whether to read the resolved CDN URL from Strapi's `files` table
  directly, or join through the polymorphic `files_related_mph` join
  table to find each component's media reference.
- **[Affects R3.6][Technical] Video relation resolution.**
  `videoHero.video` (Strapi relation to `api::video.video`) and
  `mediaCollection.items[].video` need to land as admin `videoId`
  (cuid). Mapping requires resolving cms's numeric video id →
  admin's cuid via the existing `core_id` axis (admin Video has
  `coreId`, cms Video has `coreId`, and the
  `refresh-core-id-mapping` artifact already covers part of this).
  Decide whether R3 reuses that mapping snapshot or queries cms +
  admin directly.
- **[Affects R3.7][Technical] cms locale enumeration query shape.**
  Confirm whether Strapi v5 stores locale on the `experience` row
  directly or on a sibling i18n table. `SELECT DISTINCT locale
FROM experience` is the assumed query; recon must verify.
- **[Affects R3.8][Technical] Per-row dump-snapshot storage shape.**
  New column on `ExperienceLocale` (`cms_dump_snapshot JSONB`,
  `cms_document_id TEXT`, `dumped_at TIMESTAMP`) vs a separate
  `cms_experience_dump_snapshot` table. Migration shape decision.
- **[Affects R3.8][Technical] Slug-uniqueness collision handling on
  rerun.** admin enforces partial unique `(locale, slug) WHERE
status='published'`. If cms publishes two experiences with the
  same locale + slug (a cms invariant we don't control), the dump
  must surface this clearly rather than silently failing one.
- **[Affects R3.9][Technical] Hash function for content-change
  detection.** SHA-256 over a deterministic JSON-stringified
  `{title, metaDescription, ogTitle, ogDescription, blocks}` is the
  obvious answer; verify against admin's existing
  `runExperienceEmbedding` text-flattener so the hash actually
  covers the bytes the embedder sees.
- **[Affects R3.11][Technical] Mutation return JSON shape.** Lock
  the per-outcome counter keys to match R1/R2 conventions exactly
  (`created`, `updated`, `skipped`, `failed`, plus the per-target
  details array shape). Cross-reference
  `triggerSceneEmbeddingBackfill`'s actual return type before
  authoring this one.
- **[Affects R3.13][Needs research] Read-only PG role provisioning
  on cms.** Coordinate with platform team to provision a `forge-
admin-readonly` role on cms's Postgres with `SELECT` on the
  experience-related tables only. Capture the exact `GRANT`
  statements in the operational runbook.
- **[Affects R3.13][Needs research] Doppler env wiring for
  `CMS_DATABASE_URL`.** Confirm Doppler `forge-admin` project layout
  and where the new env lands; coordinate with the existing R1
  Doppler-access blocker rather than waiting on it.

## Next Steps

→ `/ce:plan` for structured implementation planning. Planning's first
order of business is the read-only-role recon against prod cms's PG
to verify Strapi v5 i18n + dynamic-zone table shapes, then the
block-transform field-level delta inventory.
