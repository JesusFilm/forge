---
id: "feat-665"
title: "Correct the Turkmen subtitle label"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "localization"
---

## Problem

FGE-282 finding N25 reports Azerbaijani `ə` in Turkmen subtitle labels (`Subtitrlər`). The production `/watch/turkmen.html/videos` page displayed this spelling in the subtitle-count label during review. Current Turkmen examples use `Subtitrler` (plain `e`) in [Turkmenistan's government information portal](https://turkmenistaninfo.gov.tm/tk/horse-breeding-order) and [the Ministry of Culture](https://medeniyet.gov.tm/app/tk/sigle-news/3996). Correct only these directly supported Turkmen labels. N16 Portuguese regional wording and N19 Lingala/Wolof strings remain for separate source verification.

## Entry Points — Read These First

- `apps/web/messages/tk.json` — `LanguagePickerModal.subtitlesHeading`, `HeroPlayer.subtitleCount`, and `LanguageInventory.subtitles`.
- `apps/web/src/i18n/__tests__/messages-parity.test.ts` — catalog flattening and locale validation.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — Web package rules.

## Grep These

`Subtitrlər|subtitleCount|subtitlesHeading|LanguageInventory.*subtitles`

## What To Build

Set only the three reproduced Turkmen subtitle labels to `Subtitrler`. Preserve the existing ICU `count` plural structure. Add a focused regression for the exact message values and ensure no `ə` remains in the flattened Turkmen catalog.

## Constraints

Do not modify Portuguese, Lingala, or Wolof strings without locale-specific authoritative evidence. Do not regenerate or edit derived locale/type outputs by hand. Do not claim the whole FGE-282 audit is complete based on this subset.

## Verification

Run the focused locale test, Web typecheck, targeted lint/format, and generated locale-catalog drift check. After deployment, verify the Turkmen language-inventory route and an English control.

## Status

FGE-282 is partially advanced. N25 has a source-backed code correction; N16 and N19 require separate locale-specific source verification before edits. `feat-665` was allocated after coordination for the concurrently active roadmap IDs.
