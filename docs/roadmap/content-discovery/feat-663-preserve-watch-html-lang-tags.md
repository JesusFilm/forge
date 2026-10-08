---
id: "feat-663"
title: "Preserve Watch BCP-47 tags in the HTML language route segment"
owner: "urim"
priority: "P2"
status: "complete"
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

## Completion Evidence

- Added a tag-first resolver for internal `[htmlLang]` while retaining slug-first public resolver behavior.
- Preserved generated Admin tags, including private-use `ble-x-Naga`; kept the existing `mey-Latn` Hassaniyya catalog exception.
- `Intl.Locale("prs").toString()` returns `fa-AF` in the current runtime, so Intl canonical output is not used to rewrite authoritative Admin language identities. Intl remains the validity check; output casing is normalized structurally, preserving `prs`.
- Focused locale and root-layout tests: 82 passed.
- `pnpm --filter @forge/web typecheck`, targeted ESLint, Prettier check, `git diff --check`, and `pnpm --filter @forge/web check:language-bcp47-map` passed. Generator check fetched 2,329 map entries with no drift.
- US Team seat verified as first-party claude.ai / Jesus Film Project / Team. Claude Code review was started but did not return output; personal review and focused verification found no remaining blocker.
- Production probes on 2026-10-08 confirmed Awadhi and Balanta Naga response language mismatches; see Validation Evidence.
- Draft PR: pending.
