---
id: "feat-663"
title: "Preserve Watch BCP-47 tags in the HTML language route segment"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "languages"
  - "i18n"
---

## Problem

The Watch root layout resolves its internal `[htmlLang]` route parameter with the public-slug-first `resolveWatchLocaleIdentity`. A generated BCP-47 value can therefore be mistaken for a different public slug (`awa` resolves to Awa (China), `vwa`), and private-use tags such as `ble-x-Naga` are rejected by the shape-only BCP-47 fallback. Production inventory routes currently return the wrong `lang` for Awadhi, Awadhi Nepal, and Balanta Naga.

## Entry Points — Read These First

- `apps/web/src/lib/locale.ts`
- `apps/web/src/lib/locale.test.ts`
- `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/layout.test.tsx`
- `apps/web/src/lib/language-bcp47-map.ts`
- `apps/web/scripts/generate-language-bcp47-map.ts`
- `apps/web/CLAUDE.md`

## What To Build

- Add an explicit resolver for the internal `[htmlLang]` segment that prefers known, declarable generated BCP-47 tag values over slug keys.
- Keep public language slug resolution slug-first so `awa` as a public language slug still means Awa (China), while `awa` as the internal tag means Awadhi.
- Accept registered generated values with private-use subtags such as `ble-x-Naga` when reading the internal tag segment.
- Preserve the existing Hassaniyya UI catalog exception (`mey-Latn`) unless current Admin/standard evidence establishes a different valid tag.
- Add root-layout tests for the reported tags and a regression test proving public slug behavior is unchanged.

## Validation Evidence

On 2026-10-08, production inventory URLs returned HTTP 200 with prerendered HTML (`x-nextjs-prerender: 1`):

- `/watch/awadhi.html/videos` and `/watch/awadhi-nepal.html/videos` returned `<html lang="vwa">`; the generated Admin map says `awa` (Awadhi).
- `/watch/balanta-naga.html/videos` returned `<html lang="en">`; the generated Admin map says `ble-x-Naga`.
- Control `/watch/balanta.html/videos` returned `<html lang="ble">`; Admin maps Balanta to `ble`.
- The Admin language-map drift check fetched 2,329 rows and reported no changes from the committed generated map.
- IANA records identify `awa` as Awadhi, `vwa` as Awa (China), `ble` as Balanta-Kentohe, and `mey` as Hassaniyya. The current Hassaniyya UI catalog exception remains `mey-Latn`.

## Constraints

- Do not hand-edit generated `language-bcp47-map.ts`; use its Admin-driven generator and drift check.
- Keep public slug mapping and internal BCP-47 segment parsing explicit and separate.
- Do not change Watch UI language fallback or route admission behavior.

## Verification

- Run `pnpm --filter @forge/web check:language-bcp47-map`.
- Run focused `locale.test.ts` and `[locale]/[htmlLang]/layout.test.tsx` tests.
- Run Web typecheck, targeted ESLint, and Prettier.
- Review with Claude Code using the verified US Team profile.

## October 8 Implementation Evidence

- Added a tag-first resolver for internal `[htmlLang]` while retaining slug-first public resolver behavior.
- Preserved generated Admin tags, including private-use `ble-x-Naga`; kept the existing `mey-Latn` Hassaniyya catalog exception.
- `Intl.Locale("prs").toString()` returns `fa-AF` in the current runtime, so Intl canonical output is not used to rewrite authoritative Admin language identities. Intl remains the validity check; output casing is normalized structurally, preserving `prs`.
- Focused locale and root-layout tests: 82 passed.
- `pnpm --filter @forge/web typecheck`, targeted ESLint, Prettier check, `git diff --check`, and `pnpm --filter @forge/web check:language-bcp47-map` passed. Generator check fetched 2,329 map entries with no drift.
- US Team seat verified as first-party claude.ai / Jesus Film Project / Team. Claude Code review was started but did not return output; personal review and focused verification found no remaining blocker.
- Production probes on 2026-10-08 confirmed Awadhi and Balanta Naga response language mismatches; see Validation Evidence.
- Draft PR: https://github.com/JesusFilm/forge/pull/2674 (registered with T3).

## October 14 Refresh Evidence

- Refreshed the existing branch against `main` at `e6f5347bf123f887ecb94fcbd1813569f80fd3f1`. Source merged cleanly; regenerated and formatted the roadmap README to resolve its only conflict.
- Fresh native-browser production checks reproduced `/watch/awadhi.html/videos` and `/watch/awadhi-nepal.html/videos` as `lang="vwa"`, and `/watch/balanta-naga.html/videos` as `lang="en"`. Live Admin metadata still supplies `awa`, `awa`, and `ble-x-Naga`. Controls returned Balanta `ble/ltr`, Dari `prs/rtl`, and English `en/ltr`.
- Against the actual current-main layout, the existing layout regression failed independently for both causes: `vwa` instead of `awa`, and `en` instead of `ble-x-naga`. Restoring this branch passed all 83 locale/layout tests.
- Another 187 proxy, matcher, inventory, language-index, and history tests passed. Web typecheck and targeted ESLint passed. The isolated checkout initially lacked the Admin dependency overlay; adding that local overlay resolved the setup-only typecheck failure without source changes.
- Fresh Admin drift check fetched 2,330 rows, generated 2,329 corpus/map entries, and reported zero drift. The one excluded row has no slug.
- The focused source review included a separate agent's adversarial read of all 13 tag/public-slug collisions, 27 private-use map values, and public URL/document-language guards. It retained no introduced findings. This was a same-provider source review; Claude inference was not run because included allowance could not be safely established.
- A warm benchmark of the changed synchronous root-layout locale phase measured median `0.003354 ms` before and `0.003639 ms` after across seven batches of 10,000 operations: approximately `0.000285 ms` additional work per call. This is not an end-to-end page-load benchmark. Static route settings, client imports, providers, and resource requests are unchanged.
- Actual after-change browser validation and refreshed CI remain release gates. The feature stays in progress until those stages finish.

## M55 Scope and Hassaniya Residual

This PR addresses the three reproduced parsing failures above. It does not establish that all four M55 cases are fixed, and must link FGE-285 without an automatic close directive.

`/watch/arabic-hassaniya.html/videos` still returns the deliberate `mey-Latn/ltr` override. Its current inventory heading and collection copy render in English, with an Arabic native-name label; that observation alone does not authorize choosing a different document language or script. The `mey-Latn` catalog is an explicit English provisional fallback, and existing `feat-265` tracks verified Hassaniyya Latin-orthography translations.

The live [IANA registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry) records `mey` as the language Hassaniyya, with no corresponding registered extlang entry. Admin's `ar-mey` value therefore cannot be treated as a registered extlang whose primary-subtag spelling makes `mey-Latn` an incorrect language identity. Preserve the current product contract pending a content/script decision; keep the complete M55 finding and FGE-285 open.
