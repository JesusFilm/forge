---
id: "feat-666"
title: "Separate LUMO description text and source links"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "content"
---

## Problem

Current LUMO series and episode descriptions append raw source and social URLs to editorial prose. Production examples are `https://www.jesusfilm.org/watch/lumo-the-gospel-of-john.html/english.html` and `/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34/english.html`. The suffix is read as part of the body and reused for metadata. Preserve the source text in Admin/Core; separate its known LUMO attribution suffix in Web presentation.

## Entry Points — Read These First

- `apps/web/src/lib/content.ts` — `WatchVideoRecord` and resolved series/video shapes.
- `apps/web/src/lib/experience-metadata.ts` — video and series preview metadata.
- `apps/web/src/components/watch/WatchBody.tsx` — episode description.
- `apps/web/src/components/watch/SeriesPageClient.tsx` — series description and share modal.
- `apps/web/src/components/watch/ShareModal.tsx` — description preview.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`.

## Grep These

`For more information please visit|Follow us on Facebook|video\.description|series\.description|structuredDataDescription`

## What To Build

Parse only the known LUMO website/Facebook/X/Instagram suffix from description strings into structured attribution links. Render the remaining editorial copy with a readable preview for long text and an accessible native expansion. Use editorial copy only for page, Open Graph, Twitter, and structured-data descriptions; cap generated metadata at 160 characters at a word boundary. Add regression coverage for the exact LUMO series and episode examples and for non-LUMO text that must remain unchanged.

## Constraints

Do not edit authored Admin/Core descriptions or remove source destinations. Do not infer social URLs from arbitrary prose or strip unrelated URLs. Keep the parser conservative and preserve a no-match description byte-for-byte. Do not add a new service, schema field, or dependency.

## Verification

Run focused description/metadata and Watch component tests, targeted Web typecheck, lint and format. Verify current representative English series/episode pages and a localized route; confirm rendered attribution links, bounded social metadata, full editorial text on expansion, and no raw LUMO URLs in preview descriptions. Check that unrelated non-LUMO descriptions remain unchanged.

## Status

FGE-36 is being advanced through a Web presentation/metadata change only. Authored source descriptions stay untouched.
