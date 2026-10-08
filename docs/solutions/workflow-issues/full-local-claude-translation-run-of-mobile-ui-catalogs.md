---
title: "Run a full local Claude translation of the mobile UI catalogs"
date: 2026-10-08
category: workflow-issues
module: apps/mobile i18n catalogs
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "Translating many mobile UI catalogs with Claude subagents through translate-catalogs.mjs --local-export and --local-import"
  - "Adding locales to englishOnlyLocales, or taking a locale off that list"
  - "A translation run gives a locale its first real catalog while tests or runtime code treat that locale as catalog-less"
related_components:
  - "apps/mobile/scripts/i18n/translate-catalogs.mjs"
  - "apps/mobile/scripts/i18n/local-modes.mjs"
  - "apps/mobile/scripts/i18n/generate-catalog-index.mjs"
  - "apps/mobile/src/i18n/localeStore.ts"
  - "apps/mobile/src/i18n/resolveLocale.ts"
  - "apps/mobile/i18n/translation-policy.json"
  - "apps/web/scripts/openai-catalog-translator.mjs"
tags:
  - "mobile"
  - "i18n"
  - "locale-catalogs"
  - "machine-translation"
  - "local-translation"
  - "english-only"
  - "glotlid"
  - "translation-provenance"
---

# Run a full local Claude translation of the mobile UI catalogs

## Context

U16 of feat-604 (PR #2604, open as of 2026-10-08) translated the 697 mobile UI strings into 222 locales. Claude subagents wrote the answer files in local mode, and one `--local-import` checked and wrote them. The command steps are in `apps/mobile/CLAUDE.md` ("Translate with Claude (local mode)" and "Check the translations"). This doc records what those steps do not say: the traps that the run found in the checks, the agents, the import, the runtime, the tests, and the bundle measurement. Each trap cost time to find, and the final code does not show most of them.

The result of the run: 179 locales were translated and 43 were declined. The owner then made 56 locales English-only (the 43 declined and the 13 with the lowest confidence), so 166 catalogs ship translated.

## Guidance

### Prepare the subagents

- Give every agent one shared instruction file with the rules, the process, and the report format. Give each agent about 3 locales of one script, and run about 12 agents at a time.
- Tell the agents to **decline** a locale that they cannot write reliably. Their text would otherwise be invented words or a bridge language (Kriol, Wolof, Tagalog, Zulu, Spanish). A declined locale is an owner decision about English, not a failed locale.
- Do not use a low-resource web catalog as a term source without a check. Many web catalogs for these locales are in another language in many strings. For example, `quc` shares many strings with Kaqchikel (`cak`), `nr` and `ss` with Zulu (`zu`), and `ho` with Tok Pisin (`tpi`). The agents also read `mfv` as Guinea-Bissau Kriol. Put a do-not-use list in the instructions.

### Know the traps in the checks

The import runs web's checks, and two of them reject natural text:

- **Explicit-script check.** `explicitScriptContractError` (`apps/web/scripts/openai-catalog-translator.mjs:440`) removes `{...}` groups in one pass before it counts letters (`value.replace(/\{[^{}]+\}/gu, "")`, line 447). That pass removes only the plural branches, so the Latin words `count plural one other` stay. A short Cyrillic or Arabic plural then has under 50% of its letters in the script and fails. For `az-Arab`, `az-Cyrl`, `bs-Cyrl`, `ms-Arab`, `sd-Deva`, `uz-Arab` and `uz-Cyrl`, put only `#` in the branches and move the words outside the braces. Use a "label: number" shape so the words read correctly for every number.
- **Equals-English check.** `isSourceEquivalent` (same file, line 428) rejects a value that equals the English when case and spaces are ignored. So "Video", "OK", "Home" and `{seconds} s` (for the English `{seconds}s`) fail even in languages that use those words. `intentionallyLocaleNeutral` exempts a key for every locale, not one locale. The agent must choose another real word ("Videoklipp", "Va bene", "Inizio", `{seconds} sek`). List these choices in the PR.
- A plural branch that starts with a word and a comma (`one {Word, ...}`) reads as an ICU variable and fails the variable check. An ASCII apostrophe before `{`, `}` or `#` starts ICU quoting (an ICU MessageFormat rule). Use `’` in prose.

### Make same-language tags identical

Different agents write the same language in different words. In U16, 187 texts differed between `nb` and `no`, 225 between `fil` and `tl`, 242 between `zh` and `zh-Hans`, and 221 between `sr` and `sr-Latn` after transliteration. Choose one source for each pair. Copy it (`nb` to `no`, `fil` to `tl`, `zh-Hans` to `zh`), or transliterate it (`sr` to `sr-Latn`). After a transliteration, fix the texts that now equal the English in Latin letters, and change the source text too, so both scripts still match. When you copy a pair after the import, copy both the answer file and the catalog. A new import sees the catalog as finished and writes nothing. `translate-catalogs.mjs --dry-run` then shows 0 requests when the record and the catalogs agree.

### Run the import with an explicit locale list

Without `--locales`, `--local-import` covers every exported locale (`apps/mobile/scripts/i18n/local-modes.mjs:174`). If you add locales to `englishOnlyLocales` after the export, the import refuses with `--locales must name translated web catalogs; not one: ...` (`translate-catalogs.mjs:403`). The refusal writes nothing. Pass `--locales` with the tags that have an answer file. Run one import at a time.

### Read the layer 1 report correctly

`evaluate-translations.mjs` uses GlotLID. In U16 it was weak for close pairs and for Han script, and its 3 catalog errors were false alarms: `bs-Cyrl` read as Serbian, and `hak-Hant` and `nan-Hant` read as Mandarin. Check those two for Hakka and Hokkien grammar words (愛…無, 摎; 欲, 袂, 閣). `mn-Mong` read as `und_Mong`, because the model has no label for it. Most warnings came from neighbor languages: Ndebele, Zulu and Xhosa; Adyghe and Kabardian; Ingush and Chechen; Norwegian and Danish. Send the largest warning groups to one review agent that knows the markers of each pair. That agent found real errors among the false alarms: the `nd` word for "device" meant "weapon", and `inh` used the Chechen word for "which".

Layer 1 finds errors of form, not errors of meaning. A known-error test put 4 errors into each of 15 answer files. The check found 15/15 added English sentences and 12/15 neighbor-language texts, but 0/15 wrong meanings and 0/15 removed negations. A message warning needs a GlotLID probability of at least 0.9 (`MESSAGE_ID_WARNING_PROBABILITY`, `apps/mobile/scripts/i18n/lib/translationEvaluation.js:93`). An Arabic message in the `fa` file read at 0.79 and passed. The result table is in `docs/roadmap/platform/feat-604-mobile-ui-translation-run-and-device-checks.md`.

### Make an English-only copy act as no catalog

Before U16 only `en` existed, so every phone read English. After the import, each English-only copy of `en.json` became a catalog under its own tag, and three defects followed:

- `ks` is a right-to-left language, so English text aligned right.
- 14 English-only tags took their own CLDR plural rules, so `sg` printed "1 episodes" (1 is `other` in `sg`).
- A phone set to `ff` and then `fr` matched the `ff` copy first and showed English, not French.

The fix keeps the copies for parity with web but never selects them. The generator reads the policy (`readEnglishOnlyTags`, `apps/mobile/scripts/i18n/generate-catalog-index.mjs:81`), writes `ENGLISH_ONLY_TAGS`, and gives those tags English plural data (line 114). The store resolves the phone over the other catalogs only (`RESOLVABLE_TAGS`, `apps/mobile/src/i18n/localeStore.ts:192`). So an English-only language acts as a language with no catalog, and the "A translation is wrong" tile does not show for it. After you add a tag to `englishOnlyLocales`, run the generator, or `--check` fails.

A real catalog can also be in the wrong script for some phones. The only Punjabi catalog is Gurmukhi, and a `pa-PK` phone reads Shahmukhi. `CATALOG_SCRIPT` (`apps/mobile/src/i18n/resolveLocale.ts:51`) makes the resolver skip a bare-language catalog in another script (line 131), so that phone reads English.

### Fix the tests that assumed "no catalog"

Some tests used `yo-NG` as a language with no catalog (R21: a phone change that keeps the catalog). After U16 `yo` has a catalog. The tests that use the real index failed. The tests that use a fixture index kept passing, but their comments became false. Search the tests for each newly translated tag, and move a "no catalog" case to a language that web has no catalog for, such as `ha` or `ig`. Name that dependency in a comment.

### Measure bundle size as bytecode

The 166 catalogs grew the iOS `.hbc` from 8.30 MB to 14.75 MB (+2.15 MB gzip). The raw JSON suggested that the 58 English-only copies cost about 2 MB. A `hermesc -O -emit-binary` test measured +5.5 KB, because Hermes stores each string once. Measure with `EXPO_NO_DOTENV=1 npx expo export --platform ios --platform android` on `main` and on the branch, or with `hermesc`. Do not estimate from JSON file sizes. Without `EXPO_NO_DOTENV=1`, the export printed `env: load .env.local` and took the local values. With it, both exports use the same environment.

## Why This Matters

The catalogs ship to real users, and no person reviews them. Each check in the pipeline proves the form of a text, not its meaning or its runtime behavior, so a missed trap reaches users as a defect: English shown right-to-left, "1 episodes", or a script that the reader cannot read. The run also needs owner decisions (decline, English-only, pair copies), and each decision depends on facts that only a run produces. A future run that knows these traps saves about a day, and it ships fewer defects.

## When to Apply

- A full translation run, a run for new keys or new locales, or a run that takes a locale off `englishOnlyLocales`.
- Any change to `englishOnlyLocales`, to the catalog index generator, or to the locale resolver.
- Any test or runtime code that names a locale as "has no catalog".

## Examples

Reword an explicit-script plural so the branches hold only the number:

```text
Before: {count, plural, one {Delete # video?} other {Delete # videos?}}
After:  Delete the selected videos? Number: {count, plural, other {#}}
```

Import only the answered locales after the owner adds English-only locales:

```bash
LOCS=$(ls "$TMPDIR/mobile-ui-u16"/*.answer.json | xargs -n1 basename | sed 's/.answer.json//' | paste -sd, -)
node scripts/i18n/translate-catalogs.mjs --local-import "$TMPDIR/mobile-ui-u16" \
  --translator claude-opus-5-5 --locales "$LOCS"
```

The tests that pin the English-only contract: `translationPolicy.test.ts` ("keeps every English-only catalog an exact copy of en.json", "gives the generated index the same English-only tags", "records every catalog as translated or English-only, never both"), and `useT.test.tsx` ("an English-only phone language", "a pa-PK phone reads English, not the Gurmukhi catalog").

## Related

- `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md`: web's version of the same gap (form checks pass in the wrong language), and the English-fallback remedy.
- `docs/solutions/workflow-issues/merge-pending-catalog-fallbacks-with-localized-provenance.md`: provenance covers only the translated part.
- `docs/solutions/best-practices/watch-ui-catalog-translation-context-prompts.md`: translator context for each key.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: the fixture-index tests that kept passing with a false premise.
- `docs/solutions/ui-bugs/ios-natural-text-alignment-follows-native-localization.md`: text direction on iOS.
