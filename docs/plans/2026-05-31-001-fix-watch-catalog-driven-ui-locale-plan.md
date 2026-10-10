---
date: 2026-05-31
type: fix
scope: web-watch-i18n
status: completed
roadmap: docs/roadmap/platform/feat-150-watch-catalog-driven-ui-locale.md
owner: codex
---

# Catalog-Driven Watch UI Locale Fallback

## Goal

Remove the hardcoded watch UI locale whitelist and make UI chrome selection follow the message catalogs available in `apps/web/messages/*.json`.

The public URL/audio language remains validated by the watch route manifest and public language slug map. UI chrome then falls back through the closest available catalog and finally English. In practical terms, `russian.html` stays English while no `apps/web/messages/ru.json` exists, but starts rendering Russian UI automatically after a real `ru` catalog is added and the generated catalog list is refreshed.

## Request Traceability

- R1: Remove the hardcoded UI locale whitelist.
- R2: Select the closest mapped UI catalog for the requested public watch language.
- R3: Fall back to English when no matching catalog exists.
- R4: Preserve public audio slug validation so invalid watch language URLs do not become valid just because the UI fallback is more permissive.

## Current Behavior

- `apps/web/src/lib/locale.ts` exports `UI_LOCALE_FAMILIES = ["en", "es", "fr", "pt", "de"]`.
- `resolveUiLocale("russian")` returns `null` even though `apps/web/src/lib/language-bcp47-map.ts` maps `russian` to `ru`.
- `resolveWatchLocaleIdentity("russian")` therefore returns `{ locale: "en", htmlLang: "en" }`.
- `apps/web/src/proxy.ts` rewrites the public Russian URL to `/watch/en/en/.../russian.html`.
- `apps/web/src/i18n/locales.ts` already discovers message catalogs with `readdirSync`, but that module is `server-only` and cannot be pulled into middleware or client-safe route helpers.

## Constraints

- Keep the three identities separate:
  - Public audio slug, for example `russian`.
  - Message catalog key, for example `ru` or fallback `en`.
  - HTML language identity, for example `ru`, `ru-RU`, or fallback `en`.
- Keep public watch slug validation. Unknown public audio slugs should still 404 before the app route.
- Do not import `apps/web/src/i18n/locales.ts` into `apps/web/src/lib/locale.ts`, `apps/web/src/proxy.ts`, or route helpers that can be bundled for edge/client use.
- Do not hand-edit generated GraphQL outputs or unrelated route-manifest artifacts.
- Do not commit a placeholder `apps/web/messages/ru.json` as part of this fix unless product explicitly wants Russian UI copy included in the same PR.

## Assumptions

- The implementation should not add Russian translations in this PR; it should make `ru.json` work automatically when a real catalog is added later.
- A generated edge-safe catalog module is acceptable because middleware cannot import the existing filesystem-based `apps/web/src/i18n/locales.ts`.
- Build/test script wiring can refresh the generated module, so adding a catalog does not require a manual TypeScript edit.
- Existing public watch language slug validation remains the source of truth for whether a public audio URL is valid.

## Proposed Design

Add an edge-safe generated module, for example `apps/web/src/i18n/generated-ui-locales.ts`, derived from the filenames in `apps/web/messages/*.json`.

The generated module should export:

- `DEFAULT_LOCALE = "en"`.
- `AVAILABLE_UI_LOCALES = [...] as const`.
- `type UiLocale = (typeof AVAILABLE_UI_LOCALES)[number]`.
- A small membership helper or readonly set that is safe in middleware and app code.

Add a generator script, for example `apps/web/scripts/generate-ui-locales.ts`, that:

- Reads `apps/web/messages/*.json`.
- Validates `en.json` exists.
- Validates locale filenames are normalized BCP47-ish keys accepted by the app.
- Sorts locales deterministically.
- Writes the generated module with a clear header.
- Fails if the on-disk generated module is stale when running in check mode.

Wire the generator into the web package so adding `apps/web/messages/ru.json` is enough before build/test:

- Add package scripts such as `generate:ui-locales` and `check:ui-locales`.
- Run generation before `build`, `typecheck`, and test workflows, either through explicit script chaining or local lifecycle scripts.
- Keep `apps/web/src/i18n/locales.ts` server-only, but make it consume or verify against the generated list instead of being the only source of catalog truth.

## Fallback Algorithm

Refactor `resolveUiLocale` around generated catalog membership:

1. Convert the requested segment to a BCP47 tag using existing slug/BCP47 handling:
   - Public slug map: `russian` -> `ru`.
   - Direct tag handling: `pt-BR`, `es-419`, `zh-Hant-TW`.
2. Normalize casing.
3. Try exact catalog match.
4. Try progressively less specific tags:
   - `zh-Hant-TW` -> `zh-Hant` -> `zh`.
   - `pt-BR` -> `pt`.
   - `es-419` -> `es`.
5. Try existing ISO-639-3 alias fallback where applicable:
   - `fra` -> `fr`.
   - `eng` -> `en`.
6. Return `null` only when no catalog candidate matches.

Keep `resolveWatchLocaleIdentity` responsible for the final English fallback:

- If `resolveUiLocale(input)` finds a catalog, use it as `locale`.
- If no catalog is available, use `DEFAULT_LOCALE`.
- Preserve a regional `htmlLang` only when the requested tag resolves to the chosen catalog family.
- Otherwise use the chosen catalog key for `htmlLang`.

Expected examples:

| Input        | Catalogs present     | locale    | htmlLang     |
| ------------ | -------------------- | --------- | ------------ |
| `russian`    | `en, es, fr, pt, de` | `en`      | `en`         |
| `russian`    | `en, ru`             | `ru`      | `ru`         |
| `pt-BR`      | `en, pt`             | `pt`      | `pt-BR`      |
| `es-419`     | `en, es`             | `es`      | `es-419`     |
| `zh-Hant-TW` | `en, zh-Hant`        | `zh-Hant` | `zh-Hant-TW` |
| `zh-Hant-TW` | `en`                 | `en`      | `en`         |

## Implementation Units

### 1. Generated Catalog Source

Files:

- `apps/web/scripts/generate-ui-locales.ts`
- `apps/web/src/i18n/generated-ui-locales.ts`
- `apps/web/src/i18n/locales.ts`
- `apps/web/src/i18n/__tests__/messages-parity.test.ts`
- `apps/web/package.json`

Tasks:

- Add the generator script and generated locale module.
- Move `DEFAULT_LOCALE`, `AVAILABLE_UI_LOCALES`, and `UiLocale` type ownership to the generated module or a thin edge-safe wrapper.
- Replace the current drift test that compares `UI_LOCALE_FAMILIES` to filesystem catalogs with a generated-module parity check.
- Keep structural message parity checks intact.

Validation:

- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- `pnpm --filter @forge/web generate:ui-locales`
- `pnpm --filter @forge/web check:ui-locales`

### 2. Catalog-Driven Locale Resolution

Files:

- `apps/web/src/lib/locale.ts`
- `apps/web/src/lib/locale.test.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/proxy.test.ts`
- `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

Tasks:

- Remove `UI_LOCALE_FAMILIES`.
- Rename or narrow `isLocale` so it clearly means generated UI catalog membership.
- Implement the fallback algorithm above without importing server-only filesystem code.
- Keep `isPublicWatchLanguageSlug` and route-manifest admission unchanged.
- Update proxy tests for:
  - Russian public URL falls back to `/watch/en/en/.../russian.html` without `ru`.
  - Regional tags preserve `htmlLang` when a close catalog exists.
  - Unknown public audio slugs still 404.
- Update page-routing tests so unsupported catalog families fall back through generated membership rather than a hardcoded tuple.

Validation:

- `pnpm --filter @forge/web test -- src/lib/locale.test.ts`
- `pnpm --filter @forge/web test -- src/proxy.test.ts`
- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

### 3. Revalidation and Public Slug Fanout

Files:

- `apps/web/src/app/api/revalidate/route.ts`
- `apps/web/src/app/api/revalidate/route.test.ts`
- `apps/web/src/lib/locale.ts`

Tasks:

- Remove assumptions that every UI catalog locale has a hardcoded public watch slug mapping.
- Keep explicit canonical slugs for current core locales:
  - `en` -> `english`
  - `es` -> `spanish-castilian`
  - `fr` -> `french`
  - `pt` -> `portuguese-brazil`
  - `de` -> `german-standard`
- Add deterministic fallback mapping from UI locale to a public audio slug by inverting `LANGUAGE_BCP47_MAP` for exact BCP47 matches, for example `ru` -> `russian`.
- If no public slug exists for a catalog locale, skip public slug fanout for that locale while still keeping internal catalog revalidation bounded to generated locales.
- Ensure no generated catalog key becomes a public URL slug by accident.

Validation:

- `pnpm --filter @forge/web test -- src/app/api/revalidate/route.test.ts`
- Add focused helper tests for canonical slug selection if the helper lives in `apps/web/src/lib/locale.ts`.

### 4. Docs and Operator Guidance

Files:

- `apps/web/CLAUDE.md`
- `docs/roadmap/platform/feat-150-watch-catalog-driven-ui-locale.md`
- This plan

Tasks:

- Update the web i18n guidance from "drop messages/{locale}.json and widen UI_LOCALE_FAMILIES" to "drop messages/{locale}.json and run/generate the catalog list."
- Document that middleware and route helpers must use the generated edge-safe catalog module, not filesystem discovery.
- Mark the roadmap ticket complete only after implementation, tests, and browser smoke proof pass.

Validation:

- Manual doc review for stale references to `UI_LOCALE_FAMILIES`.
- `rg -n "UI_LOCALE_FAMILIES|widen UI_LOCALE_FAMILIES|generated-ui-locales" apps/web docs`

## Browser Smoke Plan

Use Helium after implementation.

Smoke without a Russian catalog:

1. Start the web app locally.
2. Open `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`.
3. Confirm the page renders and document language/UI chrome are English.
4. Confirm the public URL is accepted because `russian` is a valid audio slug.

Smoke with a real or temporary local Russian catalog:

1. Add a local `apps/web/messages/ru.json` only for validation, or use a test fixture if implementation supports injected catalogs.
2. Run the generator.
3. Restart or rebuild the app.
4. Open the same Russian public URL.
5. Confirm the internal route chooses `locale=ru`, `htmlLang=ru`, and visible UI strings come from the Russian catalog.
6. Remove the temporary catalog before commit unless product wants it included.

## Risks

- Importing filesystem-based catalog discovery into `apps/web/src/lib/locale.ts` would break middleware/client-safe usage. The generated module avoids this.
- Inverting `LANGUAGE_BCP47_MAP` can produce ambiguous public slugs. Preserve explicit overrides for existing locales and use deterministic tie-breaking for all fallback mappings.
- If generation is not wired into CI-sensitive scripts, adding a catalog can still require manual TypeScript edits or produce stale builds.
- A catalog key does not guarantee complete translation quality. Existing message parity tests should continue to enforce shape, but product review still owns copy quality.

## Done When

- `UI_LOCALE_FAMILIES` no longer exists.
- UI catalog membership is generated from `apps/web/messages/*.json`.
- `resolveWatchLocaleIdentity("russian")` returns English with current catalogs and Russian once `ru.json` exists.
- Unknown public audio slugs still 404.
- Revalidation no longer assumes only the original five UI locales exist.
- Web i18n docs describe catalog-driven locale onboarding.
- Targeted tests and Helium smoke proof pass.
