---
id: feat-635
title: Watch search lexical locale follows query language
owner: vlad
priority: P1
status: in-progress
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags: [admin, watch-search, i18n, ranking]
---

## Problem

Watch Search used the display or route locale for lexical video-title
retrieval, even when the query language or selected target language identified
a different locale. This reduced title recall for explicitly selected Spanish
and French searches under English UI chrome.

Linear source: FGE-24.

## Scope

- `apps/admin/src/services/watch-search.service.ts` — derive lexical locale
  from query language, then selected target language, then display/route locale.
- `apps/admin/src/services/watch-search.service.test.ts` — cover query and
  target locale precedence for keyword, trigram, and exact-title retrieval.

## Constraints

- Keep UI/display locale separate from search lexical locale.
- Query language wins when known; only an explicitly selected target may
  override display locale when query language is unknown.
- Rank with the lexical locale while returning title and description text in
  the display locale when that translation exists.
- Do not add Latin-script language detection or change playback language
  interpretation in this ticket.

## Verification

- Focused WatchSearchService tests pass.
- Admin typecheck and scoped ESLint pass.
- No GraphQL schema changes are expected.
