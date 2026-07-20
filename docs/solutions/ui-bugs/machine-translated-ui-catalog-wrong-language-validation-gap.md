---
title: "Machine-translated UI catalogs can pass syntax gates in the wrong language"
date: "2026-07-17"
category: "ui-bugs"
module: "apps/web Watch i18n catalogs"
problem_type: "ui_bug"
component: "testing_framework"
symptoms:
  - "Low-resource Watch UI catalogs contained copy in an unrelated bridge language."
  - "Key parity, placeholder parity, ICU formatting, and provenance digest checks still passed."
  - "A syntactically valid catalog could be classified as translated without proving target-language identity."
root_cause: "missing_validation"
resolution_type: "workflow_improvement"
severity: "medium"
related_components:
  - "apps/web/messages"
  - "apps/web/src/i18n/__tests__/messages-parity.test.ts"
  - "apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts"
  - "docs/i18n/watch-ui-provisional-catalogs.json"
tags:
  - "watch"
  - "localization"
  - "machine-translation"
  - "target-language"
  - "locale-catalogs"
  - "icu"
  - "provenance"
  - "hassaniyya"
---

# Machine-translated UI catalogs can pass syntax gates in the wrong language

## Problem

The Watch UI catalog backfill used bridge-language translation for several
low-resource locales. Some output came back in the bridge language itself:
Moksha contained Russian, Noon contained French, Uspanteko and Xinka contained
Spanish, and the Hassaniyya-Latin candidate also contained Spanish.

These catalogs looked complete to the existing automated checks. They had the
same keys and ICU variables as English, formatted successfully, differed from
English, and matched the recorded source and catalog digests. None of those
properties proves that the copy is in the requested language.

## Root Cause

Translation integrity and target-language identity were treated as the same
thing. The gates could prove that a generated artifact was complete,
well-formed, non-English, and unchanged after generation. They could not prove
that a bridge-language model response actually used the target language.

This matters most for short UI strings and low-resource languages. Automatic
language detection is unreliable on phrases such as button labels, while a
digest only proves which bytes were reviewed or generated.

## Resolution

- Reviewed generated catalogs for identical cross-locale output and obvious
  bridge-language leakage.
- Replaced the Moksha, Noon, Uspanteko, and Xinka modal copy with
  source-grounded target-language translations.
- Rejected the unverified Hassaniyya-Latin output. `mey-Latn` is an explicit,
  byte-for-byte English fallback in `provisionalLocales`, not a claimed
  machine translation.
- Kept human-reviewed, machine-translated, and provisional ownership separate
  in `docs/i18n/watch-ui-provisional-catalogs.json` and its translation
  provenance.
- Formatted all 18 `LanguagePickerModal` messages through real `next-intl` for
  every catalog in CI, including plural branches and interpolated values.
- Added `feat-265` to obtain verified Senegal Latin-orthography Hassaniyya and
  target-language identity evidence before promoting that final fallback.

The result localizes 223 of 224 non-English UI catalogs. The remaining catalog
fails closed to clearly owned English fallback copy rather than displaying an
unrelated language as authentic localization.

## Why the Gates Are Still Useful

Recursive key and placeholder parity catch incomplete catalogs. Real ICU
formatting catches malformed messages before a route renders them. English-copy
rejection catches accidental fallback in catalogs claimed as translated.
Source and catalog digests make generated artifacts reproducible and expose
unreviewed edits.

Keep all of those checks, but do not describe them as semantic translation QA.
They validate shape and provenance, not language identity.

## Prevention

1. Treat target-language acceptance as a separate review step from catalog
   generation, ICU validation, and digest recording.
2. Review bridge-generated catalogs for cross-locale collisions and retained
   bridge-language vocabulary before classifying them as translated.
3. For low-resource languages, require native-speaker review or another
   verifiable target-language source. Do not rely on short-string language
   detection alone.
4. If target-language evidence is unavailable, keep an exact English fallback
   explicit in `provisionalLocales` and exclude it from machine-translation
   provenance.
5. Format every shipped message with the real runtime formatter, not only a
   representative subset.

## Verification

```bash
pnpm --filter @forge/web test -- \
  src/i18n/__tests__/messages-parity.test.ts \
  src/lib/__tests__/watch-ui-provisional-catalogs.test.ts \
  src/components/watch/__tests__/LanguagePickerModal.test.tsx
pnpm --filter @forge/web check:provisional-ui-catalogs
pnpm --filter @forge/web check:ui-locales
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Browser-smoke representative Latin, right-to-left, and CJK Watch routes with
the language modal open. Check localized actions and links, missing-message
errors, and horizontal overflow.

## Related

- `docs/roadmap/content-discovery/feat-264-watch-language-modal-link-localization.md`
- `docs/roadmap/content-discovery/feat-265-hassaniyya-latin-watch-ui-localization.md`
- `docs/solutions/architecture-patterns/forge-algolia-search-modal-20260610.md`
- `docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md`
- `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md`
