---
id: "feat-676"
title: "Declare verified native language names in Watch language pickers"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-09"
duration: 2
depends_on: []
blocks: []
tags: [web, i18n]
---

## Problem

Watch language pickers show an English name plus a native-script name (FGE-50). The native name is not marked up, so screen readers and fonts treat it as English text, and right-to-left names (Arabic, Hebrew, Sorani) can reorder surrounding text.

`pickNativeName` in `apps/web/src/lib/content.ts` returned the first non-`en` entry of the language's name map. Core sync's `toNameMap` keys that map by the translation language, so the first non-`en` key can be a translation (`{ en: "French", de: "Französisch", fr: "Français" }` returned German). Declaring the language of such a string would be wrong.

Related, not a dependency: feat-659 (language index native labels, PR #2670) owns `apps/web/src/lib/language-index.ts` and is not on `main`. Do not edit that file here.

## Entry Points — Read These First

1. `apps/admin/src/services/core-sync/transforms.ts`: `toNameMap`, `localeFor` (read-only). Map keys are the translation language's own BCP 47 tag.
2. `apps/web/src/lib/content.ts`: `pickNativeName`, `normalizeVariant`, `normalizeSubtitlesFromVariants`.
3. `apps/web/src/lib/locale.ts`: `normalizeBcp47Tag`, `isDeclarableHtmlLangTag`, `textDirectionForLocale`.
4. `apps/web/src/components/watch/LanguageCombobox.tsx`: `nativeNameForOption`.
5. `apps/web/src/components/watch/SubtitleTranscript.tsx`: `languageLabel`, the subtitle chip and the subtitle `<select>`.
6. `apps/web/src/lib/language-display.ts`: `isolateLanguageName`.

## Grep These

`pickNativeName`, `nativeNameLang`, `nativeNameForOption`, `isDeclarableHtmlLangTag`, `textDirectionForLocale`, `isolateLanguageName`.

## What To Build

1. A shared web helper (`apps/web/src/lib/language-native-name.ts`) that selects a language's OWN name from a name map:
   - the key equal to the normalized own BCP 47 tag, or
   - the primary-subtag key, only when `Intl.Locale(...).maximize()` gives the same script for the primary tag and the full source tag (`ku` does not match `ku-Arab`; `zh` does not match `zh-Hant`).
   - It never uses "first non-en", `native`, `local` or any guessed key.
   - It returns the text plus the matched key as `lang`, only when `isDeclarableHtmlLangTag(lang)`; otherwise `lang` is null and the text stays untagged. Script is preserved.
2. `content.ts` uses the helper for variant and subtitle languages and carries an optional `nativeNameLang`.
3. `LanguageCombobox` options take an optional `nativeNameLang`. Explicit `nativeName` is tagged only with a verified `nativeNameLang`; any other provenance stays untagged. Unsupported Intl locales are suppressed to avoid an English fallback. The Intl-derived native label is tagged with its primary subtag only when the script check above passes.
4. Tagged native text renders as `<bdi lang dir>`, with `dir` from `textDirectionForLocale`.
5. Subtitle chip: a separate `<bdi lang="en" dir="ltr">` for the English name and a verified native `<bdi>`. The English tag is declared only when the producer marks `nameLang: "en"`. `content.ts` sets it from a language-specific `pickEnglishLanguage` (map `en`; the public slug fallback remains untagged); the generic `pickLocalizedName` is unchanged for other entities.
6. `LanguageCombobox` takes an optional `nameLang`; the primary English name is isolated as `<bdi lang="en" dir="ltr">` only when it is proven English (content-carried `nameLang`), so an RTL UI (ar, he) cannot reorder it.
7. Search provider (`search-language.ts`), global switcher projection (`watch-language-switcher.ts`), language inventory (`watch-language-inventory.ts`), Global picker, Feedback modal, Search overlay, collection switcher and What's New switcher carry an optional `nativeNameLang`, present only when non-null. Provider label text keeps its existing candidate order; the tag is declared only when that exact text is the language's own-language entry, so `native`/`local`/script-mismatched labels stay untagged. The global projection also carries the published `bcp47`.

## Constraints

- Native `<option>` content is text only. Nested markup is not allowed, and `lang` on the `<option>` would tag the whole mixed English-plus-native label. Keep the subtitle `<select>` option as a plain mixed label and wrap each language name with `isolateLanguageName` (Unicode isolates). Do not misdeclare the whole option.
- Do not use `deriveLanguageDisplay` (a slug heuristic) as evidence for declared metadata.
- No invented aliases or translations. No edits to `apps/web/src/lib/language-index.ts` or admin.
- Do not depend on feat-659 or PR #2670.
- No new `any`; tests colocated.

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib/language-native-name.test.ts src/lib/content.test.ts src/components/watch --maxWorkers=2` (Node 24).
- Cases: ar, he, ku-Arab, ku-Latn, ru, zh-Hans/zh-Hant, es, a shuffled French map, an invalid/unknown tag.
- `npx prettier --check` on changed files; `pnpm --filter @forge/web exec eslint` on changed sources; `tsc --noEmit` for the web package.
- Remaining scope is recorded in `/tmp/watch-fge-50-implementation.md`.

## Resolution

Scoped work for FGE-50 is verified (see the implementation report). Residual, not done here: the native `<select>` option stays a plain isolated mixed label (no per-string `lang` is possible in option text), `language-index.ts` labels (feat-659 / PR #2670) and the legacy `deriveLanguageDisplay` slug heuristic stay untagged, and the Linear issue as a whole is not complete.
