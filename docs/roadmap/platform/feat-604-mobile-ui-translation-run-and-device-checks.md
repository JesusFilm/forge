---
id: "feat-604"
title: "Mobile UI first translation run (U16) and open device checks"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-10-06"
duration: 7
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

PR #2510 moves all mobile UI text into one English catalog (`apps/mobile/messages/en.json`, 698 strings) and adds a local translation mode. No locale catalog exists yet, so the app shows English in every language. The plan's U16 (the first full translation) is not done. Some device and performance checks are also open. The production native build that carries the localization waits for U16.

No person can review the translations (owner, 2026-10-06). Web's contract checks look only at the form of each answer. So the owner chose two more quality layers before U16: automatic checks of each translation (layer 1), and an in-app report of a wrong translation (layer 4). Layers 2 (back-translation with an open model) and 3 (a second AI reviewer) wait for the known-error test below.

## Entry Points — Read These First

1. `apps/mobile/CLAUDE.md`, section "Localization", then "Translate with Claude (local mode)" and "Check the translations". They give the export, translate, check, and import steps, and the rules for large runs.
2. `docs/plans/2026-09-28-1016-feat-mobile-ui-localization-plan.md`: U16 (with its 2026-10-02 amendment), KD5 (with its amendment), the Verification Contract, and Sequencing.
3. `apps/mobile/scripts/i18n/translate-catalogs.mjs` and `apps/mobile/scripts/i18n/local-modes.mjs`: the command and the local modes.
4. `apps/mobile/scripts/i18n/lib/localTranslation.js`: the answer checks (`checkAnswer`).
5. `apps/mobile/scripts/i18n/evaluate-translations.mjs`, `apps/mobile/scripts/i18n/lib/translationEvaluation.js`, and `apps/mobile/scripts/i18n/language-id.py`: layer 1.
6. `apps/mobile/src/components/feedback/feedbackFlow.ts` (`visibleFeedbackKinds`), `FeedbackSheetContent.tsx`, and `apps/mobile/src/lib/feedbackSubmission.ts` (`safeUiLocale`): layer 4 on the phone.
7. `apps/admin/src/graphql/mutations/feedback.ts` (`UI_LOCALE`) and `apps/admin/src/services/feedback-linear.ts` (`appLanguageText`): layer 4 in admin.
8. `apps/mobile/i18n/translation-contexts.json`: the translator notes for each namespace and key.

## Grep These

- `--local-export`, `--local-import`, `import-report.json`
- `evaluation-report.json`, `KEPT_NAMES`, `SCRIPT_VALUES`, `MODEL_REVISION`
- `translation-provenance.json`, `machineTranslatedLocales`
- `generate-catalog-index.mjs`
- `LOCAL_TRANSLATOR_ID`
- `TRANSLATION`, `uiLocale`, `kindTranslation`, `translationLanguageNotice`

## What To Build

### Layer 1: automatic checks (built)

`evaluate-translations.mjs` checks the answers of a local export (`--answers <dir>`) or the catalogs (`--catalogs`). It writes a report and never stops an import. The rules are `script`, `language` (GlotLID through `uv`), `english-left`, `length`, `repeat`, and `web-script`, plus agreement with web for the strings that web shares. `apps/mobile/CLAUDE.md` "Check the translations" gives each rule and its severity.

- Tuned on web's 222 translated catalogs on 2026-10-06: 118 errors and 1,054 warnings, mostly in low-resource catalogs. `es`, `fr`, `pt`, `ru`, and `id` each had 0 or 1 finding.
- After U16, propose to move each rule that raised no false alarm into `checkAnswer`, so that the import refuses it.
- Review fixes (ce-code-review run `20261006-104007-8eeaf5af`, "Ready with fixes"): `no` and `tl` now get a language check, a real-Python test (`languageId.test.js`) pins the accepted-code rule, and a Simplified/Traditional character table checks the `Hans` and `Hant` locales.

### Layer 4: report a wrong translation in the app (built)

- The feedback sheet shows a fourth kind, "A translation is wrong" (`TRANSLATION`), only when the catalog tag is not `en`.
- Only that kind sends `uiLocale` (the catalog tag), and the sheet tells the person so.
- Admin accepts the new kind and `uiLocale` (a BCP 47 shape, 35 characters at most) and writes "App language: Arabic (ar)" in the Linear ticket.

### U16: the first full translation (local mode)

1. Merge PR #2510 first (merged 2026-10-04). Merge the layer 1 and layer 4 work before the export, so that U16 translates the three new strings.
2. Export every language into a new folder outside every git repository:
   `node scripts/i18n/translate-catalogs.mjs --local-export "$TMPDIR/mobile-ui-u16"` in `apps/mobile`.
3. Translate with subagents. Give each subagent a batch of locales. Each request file is about 280 KB, so read it in parts with `jq`. A subagent writes only the `<locale>.answer.json` files of its own locales.
4. Check: `node scripts/i18n/evaluate-translations.mjs --answers "$TMPDIR/mobile-ui-u16"`. Fix an answer only when a finding shows a real error, and check again. Leave a false alarm as it is, and list it in the U16 PR. Do not change a correct translation to clear a warning. When a locale keeps a `language` or `script` error that you cannot fix, ask the owner before it ships; the default is to put it on the English-only list in `i18n/translation-policy.json`.
5. Run one import, after the subagents finish:
   `node scripts/i18n/translate-catalogs.mjs --local-import "$TMPDIR/mobile-ui-u16" --translator <claude-model-id>`.
   Read `import-report.json`, fix the answer files, and import again until every locale finishes.
6. Run `node scripts/i18n/generate-catalog-index.mjs`, then the mobile suites.
7. Spot-check `es`, `ru`, `ar`, `zh-Hans`, and one low-resource locale for the right language and script.
8. Known-error test: put known errors into copies of some answer files (a wrong meaning, a negation, English text, the wrong language), and count what layer 1 finds in each language group. Record the result here. It decides whether layers 2 and 3 are needed.
9. Open one PR with the catalogs, `i18n/source-record.json`, `i18n/translation-provenance.json`, and the catalog index.

### Open checks (device or release build)

| Check                             | How                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Live language change on Android   | Android emulator: change the app language while a watch screen is open; playback stays.                       |
| Right-to-left text                | Arabic phone language: text aligns right, layout does not mirror (KTD4, KTD13).                               |
| VoiceOver                         | iOS simulator: labels read in the UI language; English fallback reads as English.                             |
| Plurals in a Hermes release build | A release build shows correct plural forms (for example in `ru` and `ar`).                                    |
| Bundle size                       | `npx expo export` on `main` and on the branch; compare `.hbc` and gzip bytes.                                 |
| Cold launch                       | Release build; `js_tti` against the `main` baseline over repeated launches.                                   |
| Longest translations              | After U16: tab labels, buttons, and sheet titles in `de`, `fi`, `ru`, `ta`, `ml`.                             |
| Recommended shelf                 | Against a provisioned Admin, with the shelf in a non-English UI.                                              |
| Translation report                | Non-English UI: the fourth tile, the notice, and one report that reaches Linear with its "App language" line. |

### Native build

Entry condition: the admin change with the `TRANSLATION` kind and `uiLocale` is deployed to production.

After U16 merges, the owner ships one production native build (TestFlight and Play) that carries the localization.

## Constraints

- Do not publish a production over-the-air update between the merge of #2510 and that native build. The update fingerprint moved, so an update reaches no installed build.
- Do not cut the production native build before U16 merges. Without catalogs, iOS Settings lists 225 languages that all show English.
- Deploy the admin change before any build that sends `TRANSLATION`. An older admin does not know `TRANSLATION` or `uiLocale`, so the request fails GraphQL validation before the resolver runs. Admin then writes no `event=refused` line, and the phone shows the one failure message and files a RUM error (checked with graphql-js on 2026-10-06).
- The local mode costs nothing extra. A paid OpenAI run is the fallback only, and it needs the owner's key and budget.
- Layer 1 is report-only. Do not make an import depend on GlotLID: it is weakest in low-resource languages and in close pairs such as `sr` and `bs`.
- Run one import at a time. Two imports at the same time overwrite each other's record and provenance changes.
- Keep the work folder outside every git repository; the command refuses one inside.

## Verification

- `pnpm --filter @forge/mobile test` passes. The `catalogParity`, `catalogFormat`, `sourceRecord`, and `translationPolicy` suites cover all 225 catalogs.
- `node scripts/i18n/generate-catalog-index.mjs --check` passes.
- `i18n/translation-provenance.json` names the Claude model for each translated locale.
- The pending list in `i18n/translation-policy.json` is empty.
- `evaluate-translations.mjs --catalogs` gives no error for a shipped locale, or the U16 PR explains each error.
- The known-error test has a recorded result in this ticket.
- Each open check above has a recorded result in the U16 PR or in this ticket.
