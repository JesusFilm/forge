---
id: "feat-360"
title: "Native-review low-resource Watch search translations"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-08-13"
duration: 2
depends_on:
  - "feat-359"
blocks: []
tags:
  - "watch"
  - "search"
  - "i18n"
  - "web"
---

## Problem

Contextual machine translation improved the Watch search messages, but it is
not authoritative for endangered and low-resource languages. In particular,
the `xin` model output remains Spanish rather than Xinca. Shipping that as a
successful Xinca translation would misrepresent the catalog quality. The
Tuvaluan output also retains obvious English code-switching in the search
suggestions and results labels, and several other low-resource catalogs contain
possible bridge-language loans that structural validation cannot resolve.

## Entry Points - Read These First

1. `apps/web/messages/xin.json`
2. `apps/web/messages/snf.json`
3. `apps/web/messages/tvl.json`
4. `apps/web/messages/usp.json`
5. `apps/web/scripts/ui-translation-policy.json`
6. `docs/i18n/watch-ui-provisional-catalogs.json`

## What To Build

1. Obtain native-speaker or qualified-language-reviewer approval for the seven
   Watch search messages introduced by `feat-359`.
2. Replace bridge-language copy, especially Spanish in `xin`, with reviewed
   target-language copy or an explicit fallback that does not claim to be a
   completed translation.
3. Record reviewer and source provenance without marking unreviewed machine
   output as human-reviewed.
4. Add a regression gate preventing known bridge-language catalogs from being
   copied unchanged into these target locales.

## Reference

- Comparative Xinkan Dictionary (Rogers, Kaufman, Campbell et al., 2023):
  `https://languageconservation.org/images/Language_Resources/Complete_Comparative_Dictionary.pdf`
- The dictionary documents Xinkan search roots such as `parʼa`, but does not
  provide enough contemporary UI terminology or sentence-level evidence to
  manufacture the complete interface copy without language review.

## Verification

- A qualified reviewer signs off each affected message and its UI context.
- No reviewed target message is identical to the Spanish, French, or English
  bridge-language equivalent unless the reviewer explicitly documents a loan.
- Placeholder, script, catalog parity, and browser smoke checks pass.
