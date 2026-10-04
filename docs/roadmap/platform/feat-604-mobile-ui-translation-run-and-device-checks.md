---
id: "feat-604"
title: "Mobile UI first translation run (U16) and open device checks"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-10-06"
duration: 7
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

PR #2510 moves all mobile UI text into one English catalog (`apps/mobile/messages/en.json`, 695 strings) and adds a local translation mode. No locale catalog exists yet, so the app shows English in every language. The plan's U16 (the first full translation) is not done. Some device and performance checks are also open. The production native build that carries the localization waits for U16.

## Entry Points — Read These First

1. `apps/mobile/CLAUDE.md`, section "Localization", then "Translate with Claude (local mode)". It gives the export, translate, and import steps and the rules for large runs.
2. `docs/plans/2026-09-28-1016-feat-mobile-ui-localization-plan.md`: U16 (with its 2026-10-02 amendment), KD5 (with its amendment), the Verification Contract, and Sequencing.
3. `apps/mobile/scripts/i18n/translate-catalogs.mjs` and `apps/mobile/scripts/i18n/local-modes.mjs`: the command and the local modes.
4. `apps/mobile/scripts/i18n/lib/localTranslation.js`: the answer checks (`checkAnswer`).
5. `apps/mobile/i18n/translation-contexts.json`: the translator notes for each namespace and key.

## Grep These

- `--local-export`, `--local-import`, `import-report.json`
- `translation-provenance.json`, `machineTranslatedLocales`
- `generate-catalog-index.mjs`
- `LOCAL_TRANSLATOR_ID`

## What To Build

### U16: the first full translation (local mode)

1. Merge PR #2510 first.
2. Export every language into a new folder outside every git repository:
   `node scripts/i18n/translate-catalogs.mjs --local-export "$TMPDIR/mobile-ui-u16"` in `apps/mobile`.
3. Translate with subagents. Give each subagent a batch of locales. Each request file is about 280 KB, so read it in parts with `jq`. A subagent writes only the `<locale>.answer.json` files of its own locales.
4. Run one import, after the subagents finish:
   `node scripts/i18n/translate-catalogs.mjs --local-import "$TMPDIR/mobile-ui-u16" --translator <claude-model-id>`.
   Read `import-report.json`, fix the answer files, and import again until every locale finishes.
5. Run `node scripts/i18n/generate-catalog-index.mjs`, then the mobile suites.
6. Spot-check `es`, `ru`, `ar`, `zh-Hans`, and one low-resource locale for the right language and script.
7. Open one PR with the catalogs, `i18n/source-record.json`, `i18n/translation-provenance.json`, and the catalog index.

### Open checks (device or release build)

| Check                             | How                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Live language change on Android   | Android emulator: change the app language while a watch screen is open; playback stays. |
| Right-to-left text                | Arabic phone language: text aligns right, layout does not mirror (KTD4, KTD13).         |
| VoiceOver                         | iOS simulator: labels read in the UI language; English fallback reads as English.       |
| Plurals in a Hermes release build | A release build shows correct plural forms (for example in `ru` and `ar`).              |
| Bundle size                       | `npx expo export` on `main` and on the branch; compare `.hbc` and gzip bytes.           |
| Cold launch                       | Release build; `js_tti` against the `main` baseline over repeated launches.             |
| Longest translations              | After U16: tab labels, buttons, and sheet titles in `de`, `fi`, `ru`, `ta`, `ml`.       |
| Recommended shelf                 | Against a provisioned Admin, with the shelf in a non-English UI.                        |

### Native build

After U16 merges, the owner ships one production native build (TestFlight and Play) that carries the localization.

## Constraints

- Do not publish a production over-the-air update between the merge of #2510 and that native build. The update fingerprint moved, so an update reaches no installed build.
- Do not cut the production native build before U16 merges. Without catalogs, iOS Settings lists 225 languages that all show English.
- The local mode costs nothing extra. A paid OpenAI run is the fallback only, and it needs the owner's key and budget.
- Run one import at a time. Two imports at the same time overwrite each other's record and provenance changes.
- Keep the work folder outside every git repository; the command refuses one inside.

## Verification

- `pnpm --filter @forge/mobile test` passes. The `catalogParity`, `catalogFormat`, `sourceRecord`, and `translationPolicy` suites cover all 225 catalogs.
- `node scripts/i18n/generate-catalog-index.mjs --check` passes.
- `i18n/translation-provenance.json` names the Claude model for each translated locale.
- The pending list in `i18n/translation-policy.json` is empty.
- Each open check above has a recorded result in the U16 PR or in this ticket.
