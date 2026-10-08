---
id: "feat-660"
title: "Improve Watch language video hub metadata and structured data"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
---

## Problem

The per-language video inventory page has no Open Graph image or collection structured data. The audit also reported a large response body and apparent repeated Flight data; reducing that payload remains open until a before/after measurement proves a concrete implementation reduces it.

## Entry Points — Read These First

- `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx`
- `apps/web/src/lib/watch-structured-data.ts`
- `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`

## Grep These

- `generateMetadata`
- `WatchStructuredData`
- `watchLanguageInventoryStructuredDataJson`
- `WATCH_DEFAULT_OG_IMAGE`

## What To Build

- Give Open Graph and Twitter a valid social image, using authored inventory art where available and the shared Watch default otherwise.
- Emit bounded `CollectionPage` + `ItemList` JSON-LD from the inventory's public Watch links.
- Keep sitemap registration out of this change: FGE-184 draft PR #2659 already adds the `/watch/languages` and language inventory URL family.

## Constraints

- Preserve the full server-rendered inventory, public routes, filters, and the page's current card order.
- Keep structured-data URLs on the canonical public Watch origin and follow the existing bounded ItemList policy.
- Do not add page-head hreflang for Watch content; sitemap XML owns localized alternate links.

## Verification

- Run focused route metadata and structured-data tests, along with the inventory filter and page regression suites.
- Run Web typecheck, ESLint, Prettier, and PR-focused checks.
- Review with Claude Code using the verified US Team profile and resolve findings.

## Open Payload Criterion

The audit measured the English inventory route at 9,485,550 bytes and attributed about 3.6 MB to repeated `self.__next_f` data. A proposed change that only moved the server-rendered catalog from client `children` to a sibling was rejected because no before/after measurement demonstrated a reduction. Do not claim this criterion is complete without comparing representative production HTML/Flight bytes or implementing and validating pagination.

## Completion Evidence

Open Graph/Twitter images and bounded CollectionPage/ItemList are implemented in the linked PR. Sitemap coverage is supplied by FGE-184 draft PR #2659. The payload criterion remains open pending measurement or pagination.
