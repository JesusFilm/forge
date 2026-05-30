---
module: apps/web
date: "2026-05-15"
problem_type: integration_issue
component: service_object
severity: high
symptoms:
  - "DownloadModal language pill renders blank for non-English dubs (Albanian, Afrikaans, …) after the data-layer flip to admin GraphQL"
  - "BibleQuotesCarousel citation cards render with an empty book-name slot next to chapter/verse references"
  - "Empty `<h1>` on some watch pages where title fell through to `language.name` as fallback"
  - "No TypeScript error at compile time — gql.tada surfaces `name: JSON` as `unknown`, consumer code coerced via `typeof === 'string'` and silently dropped the value"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - database
  - tooling
tags:
  - admin-graphql
  - strapi-migration
  - jsonb-locale
  - i18n
  - data-layer-flip
  - silent-drop
  - pothos
  - gql-tada
---

# JSON-locale-keyed name fields trap (Strapi-vs-admin seam)

## Problem

Admin's GraphQL schema types localized `name` columns as scalar `JSON` (`Language.name`, `BibleBook.name`, plus three other types' `name` fields at `apps/admin/schema.graphql` lines 32 / 140 / 167 / 414), but web's normalizers in `apps/web/src/lib/content.ts` were written against the Strapi vocabulary where those fields were plain `String`. The seam silently dropped every value that arrived as a locale-keyed object, so admin's actual payload — `{ "en": "Afrikaans", "af": "Afrikaans" }` — collapsed to `null`.

## Symptoms

User-visible breakage after the U13 cutover to admin:

- **DownloadModal** (`apps/web/src/components/watch/DownloadModal.tsx`): the language pill rendered blank for Albanian / Afrikaans dubs because `WatchChildVariant.language.name` came through as `null`. The conditional `{languageName ? (…) : null}` at line 443 silently swallowed the missing label.
- **Language picker** + child-variant rows: same root cause via `normalizeChildVariant` and `normalizeVariant`.
- **BibleQuotesCarousel** citation cards: `BibleBook.name` came in as `null`, so the book-name slot rendered empty next to the chapter/verse reference.
- Empty `<h1>` on some watch pages where the title fell through to `language.name`.

## What Didn't Work

The original code at all four call sites did:

```ts
name: typeof v.language.name === "string" ? v.language.name : null,
```

The `typeof === "string"` guard is correct for Strapi (where `name` is `String!`) but wrong for admin (where `name: JSON`). Every locale-keyed object failed the guard and was dropped.

The first fix attempt (commit `6d0b676f`) introduced `pickLocalizedName` but used `Object.values(map)` as the fallback when `en` was missing. JS spec guarantees insertion order on `Object.values`, but **admin-side jsonb serialization order is not contractually pinned** — a future Pothos transform, jsonb operator, or Postgres rewrite could reorder keys silently, shifting the rendered label between deploys with no code change here.

## Solution

Commit `9df13232` pinned a deterministic fallback list. The helper lives at `apps/web/src/lib/content.ts` lines 382–415:

```ts
const LOCALIZED_NAME_FALLBACK_ORDER = [
  "en",
  "es",
  "fr",
  "pt",
  "de",
  "id",
  "ja",
  "ko",
  "ru",
  "th",
  "tr",
  "zh",
  "zh-Hans-CN",
] as const

function pickLocalizedName(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null
  if (!value || typeof value !== "object") return null
  const map = value as Record<string, unknown>
  for (const key of LOCALIZED_NAME_FALLBACK_ORDER) {
    const candidate = map[key]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }
  // Last-ditch: any remaining non-empty string entry. Order is
  // implementation-defined; this branch should rarely fire because
  // every locale we support has a key in the fallback list above.
  for (const v of Object.values(map)) {
    if (typeof v === "string" && v.length > 0) return v
  }
  return null
}
```

Call sites (all in `content.ts`):

- Line 431 — `normalizeChildVariant` (child variant language pill)
- Line 505 — `normalizeVariant` (top-level variant language)
- Line 595 — `normalizeAdminVideo` BibleBook citation

Before / after at line 505:

```ts
// before
name: typeof v.language.name === "string" ? v.language.name : null,
// after
name: pickLocalizedName(v.language.name),
```

String-typed inputs pass through unchanged at line 399, so any rows admin still emits as plain strings keep working through the same helper.

## Why This Works

**(a) Why admin uses jsonb here.** Admin's Prisma model mirrors JesusFilm Core's localized name shape — Core stores `name` as a per-locale map so a single row carries every translation. Pothos exposes that column as `name: JSON` (`apps/admin/schema.graphql` lines 32, 140, 167, 414). Strapi flattened to a single locale per request; admin doesn't.

**(b) Why insertion-order fallback is unsafe.** Even though `Object.values` iteration order is spec'd on JS objects, the values come from admin's jsonb serialization. Postgres jsonb does not preserve key order — `UPDATE`, vacuum, or replication can rewrite the order. A Pothos transform that touches the map (e.g. trimming unsupported locales) could equally reorder. Relying on `Object.values()[0]` makes the rendered label environment-dependent.

**(c) Why a pinned fallback order is the right contract.** The English label is the product-wide default for the language pill / citation card. Pinning `"en"` first and listing the next 12 high-traffic locales explicitly makes the rendered label a function of the input map's _contents_, not its _key order_. New locales get added to the constant deliberately, not by accident of jsonb serialization.

## Prevention

- **Treat every admin column whose schema type is `JSON` as `Record<string, string>` keyed by locale, not a flat string.** The five `name: JSON` fields in `apps/admin/schema.graphql` (lines 32, 140, 167, 414, plus any future additions) all route through `pickLocalizedName`. New jsonb-locale call sites must use this helper — never `typeof === "string"` and never `Object.values(map)[0]`.

- **Cross-link in the data-model decisions doc.** The principles in `docs/solutions/cms/admin-app-data-model-decisions.md` cover the admin schema-design intent but don't enumerate the locale-jsonb migration trap. Add a one-line pointer there so future schema ports surface this trap at review time.

- **Document the known JSON-locale fields** in `apps/admin/CLAUDE.md` and `apps/web/CLAUDE.md` so reviewers catch any new `name: JSON` Pothos field at PR time and require a `pickLocalizedName` consumer (or a server-side projection that flattens).

- **Add unit tests for `pickLocalizedName`** covering:
  1. `pickLocalizedName({ en: "Afrikaans" })` → `"Afrikaans"` (en-only object).
  2. `pickLocalizedName({ en: "Korean", ko: "한국어" })` → `"Korean"` (multi-locale must prefer `en`).
  3. `pickLocalizedName({ en: null, es: "Coreano", ko: "한국어" })` → `"Coreano"` (non-string `en` falls back deterministically per `LOCALIZED_NAME_FALLBACK_ORDER`, not insertion order).
  4. `pickLocalizedName(null)` → `null`.
  5. `pickLocalizedName("Plain string")` → `"Plain string"` (legacy string passthrough).

- **Watch for the same trap on other Strapi → admin field-type changes.** Any field whose admin schema type differs from its Strapi schema type (scalar widening to `JSON`, single-value to array, nullable-to-non-null) needs a normalizer pass — the typecheck won't catch it because gql.tada types `JSON` as `unknown`/`any` and consumers are free to over-narrow.

- **Mobile is the second consumer.** As of 2026-05-25 (PR #1011), `apps/mobile/src/lib/pickLocalizedName.ts` implements the same helper with the same fallback order. Both web and mobile now route JSON-locale fields through `pickLocalizedName`. See `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md` section 3.

## Related

- `docs/solutions/database-issues/prisma-video-relation-inverted-back-references-20260514.md` — sibling-session doc covering a different schema-shape mismatch (inverted `@relation` direction on `Video.parents` / `Video.children`) discovered in the same admin↔web port window.
- `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md` — the mobile migration pattern that adopted this helper.
- `docs/solutions/deployment/admin-local-dev-cms-content-dump-blocked-20260515.md` — same-session sibling on the local-dev auth/proxy gauntlet that blocked rerunning the cms content-dump while diagnosing this.
- `docs/solutions/cms/admin-app-data-model-decisions.md` — admin schema-design decisions log; this learning is a concrete instance of a gap there (no enumeration of the locale-jsonb consumer contract).
- `docs/solutions/best-practices/admin-image-enrichment-localized-media-workflow-20260504.md` — different concern (AI enrichment provenance) on the same admin localized-text surface.
