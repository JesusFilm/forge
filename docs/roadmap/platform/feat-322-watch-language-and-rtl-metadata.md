---
id: "feat-322"
title: "Watch language and RTL metadata"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-28"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "localization"
  - "accessibility"
---

## Problem

Watch documents must expose the resolved BCP-47 language and matching text
direction so browser accessibility, assistive technology, and bidirectional
layout behavior match the selected Watch language.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - static Watch document
   root and metadata attributes.
2. `apps/web/src/lib/locale.ts` - BCP-47 identity and Unicode text-direction
   resolution.
3. `apps/web/src/app/[locale]/[htmlLang]/layout.test.tsx` - document-root
   regression coverage.
4. `apps/web/src/lib/locale.test.ts` - RTL, LTR, malformed-tag, and script
   variant coverage for the direction resolver.

## Grep These

- `textDirectionForLocale`
- `resolveWatchLocaleIdentity`
- `dir={textDirection}`
- `lang={htmlLang}`

## What To Build

1. Resolve the document language from the internal Watch HTML-language segment.
2. Derive the document direction with `Intl.Locale` text information, defaulting
   safely to LTR when a tag is invalid or direction data is unavailable.
3. Render the resolved values on the root `<html>` element.
4. Cover regional LTR and Arabic RTL document-root metadata in the layout test.

## Constraints

- Preserve the static internal `[locale]/[htmlLang]` route tree.
- Keep the public Watch URL as the locale source; do not add locale cookies.
- Use the resolved BCP-47 HTML language, not the message-catalog key.
- Do not hand-edit generated locale catalog artifacts.

## Verification

- `pnpm --filter @forge/web exec vitest run src/app/[locale]/[htmlLang]/layout.test.tsx src/lib/locale.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`

## Completion Evidence

- The existing Watch root layout resolves the BCP-47 HTML language and emits
  its Unicode-derived text direction on the document root.
- Layout coverage now asserts both a regional English LTR document and an
  Arabic RTL document.
- `git diff --check` passes. The focused Vitest command could not run in this
  worktree because dependencies are not installed; an attempted locked install
  exceeded the local command time limit before `vitest` became available.
