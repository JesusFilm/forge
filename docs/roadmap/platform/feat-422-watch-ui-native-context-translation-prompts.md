---
id: "feat-422"
title: "Watch UI native-context translation prompts and Chinese catalog review"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-25"
duration: 1
depends_on:
  - "feat-277"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "i18n"
---

## Problem

The Watch catalog translator tells the model not to translate word for word,
but most messages still arrive as only a dotted key and an English value.
Without the screen, user intent, and message role, generated Chinese can retain
English sentence structure instead of reading like interface copy authored by
a native Chinese writer.

## Entry Points - Read These First

1. `apps/web/scripts/openai-catalog-translator.mjs` - system and per-locale prompts.
2. `apps/web/scripts/translate-ui-catalogs.test.mjs` - translation prompt contracts.
3. `apps/web/messages/en.json` - source messages and namespace structure.
4. `apps/web/messages/zh-Hans.json` - representative Simplified Chinese output.
5. `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md` - limits of syntactic translation checks.

## Grep These

- `buildUserPrompt|contextualInstructions|messagesToTranslate`
- `WatchUnavailableLanguage|SearchOverlay|LanguageInventory|ExperienceError`
- `machine-translated; native-speaker review recommended`

## What To Build

1. Supply a concrete UI surface and message role for every requested message,
   while keeping dotted keys and English source values unchanged.
2. When a scoped translation contains only part of a UI namespace, include the
   omitted English messages from that namespace as read-only surrounding
   context so terminology can be judged in the complete screen flow.
3. Give Chinese locales native-authoring guidance that prefers concise,
   idiomatic interface copy over English syntax without changing product facts
   or runtime behavior.
4. Give every target language shared native-authoring guidance: write for the
   actual UI situation, use established target-language Christian and product
   conventions, and treat any supplied reference material as terminology and
   tone evidence rather than copy. Keep Chinese script and wording guidance
   additional and Chinese-specific.
5. Compare representative Chinese source/output pairs first against real usage
   on established Chinese-language Christian, Bible, and faith-video websites,
   using general Chinese video products only for generic interaction patterns.
   Derive reusable writing patterns from those products; do not copy wording
   blindly.
6. Apply the validated rules locally to `zh`, `zh-Hans`, and `zh-Hant`, keeping
   the two Simplified catalogs aligned while preserving the Traditional
   catalog's own terminology and recording the local-agent provenance.

## Constraints

- Do not change subtitle content or VTT files, video metadata records, locale
  routing, or non-Chinese catalogs in this change. UI labels and help text about
  subtitle controls remain part of the UI catalog scope.
- Do not alter ICU variables, rich-text tags, or translation ownership; update
  provenance to identify the local-agent catalog review without marking it as
  human-reviewed.
- Do not claim semantic quality from syntax tests alone.
- Do not send repository data to non-OpenAI model providers.

## Verification

- Prompt tests prove every requested message carries surface and role context.
- Scoped prompt tests prove omitted same-namespace source messages are included
  as context without duplicating messages already being translated.
- Every target-locale prompt carries shared native-authoring and faith-language
  rules; Chinese prompts carry additional Chinese-specific rules only.
- Existing translator validation and catalog integrity tests pass.
- Representative Chinese copy review shows a clear improvement before a PR is opened.
- The Chinese review records the product references and UI pattern used to
  justify each proposed wording change.
- All three Chinese catalogs retain exact key, ICU, rich-text, and formatting
  parity with English; `zh` and `zh-Hans` contain the same reviewed copy.
