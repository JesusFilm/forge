---
title: "Watch collection downloads rendered raw next-intl keys when client messages omitted the modal namespace"
date: "2026-07-22"
category: "ui-bugs"
module: "apps/web Watch i18n"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "The collection-download modal rendered raw next-intl message keys on Watch series pages."
  - "Three SeriesPage collection-download messages were absent from every shipped catalog."
  - "Catalog parity passed even though the route-scoped client provider could not resolve the modal namespace."
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/i18n/client-messages.ts"
  - "apps/web/messages"
  - "apps/web/scripts/translate-ui-catalogs.mjs"
  - "docs/i18n/watch-ui-provisional-catalogs.json"
tags:
  - "watch"
  - "next-intl"
  - "client-messages"
  - "route-scoped-catalogs"
  - "collection-download"
  - "machine-translation"
  - "provenance"
---

# Watch collection downloads rendered raw next-intl keys when client messages omitted the modal namespace

## Problem

The Watch collection-download flow crossed two independent localization
boundaries that were out of sync. The complete message catalogs contained a
`CollectionDownloadModal` namespace, but Watch content routes projected only a
namespace allowlist into `NextIntlClientProvider`, and that allowlist omitted
the modal. Separately, three client-side `SeriesPage` messages did not exist in
the English source catalog or any translated catalog.

Catalog parity could prove that every locale had the same keys as English. It
could not prove that a hydrated route received every namespace its client
components used. The result was syntactically complete catalogs and raw
`CollectionDownloadModal.*` and `SeriesPage.*` text in the UI.

## Symptoms

- The series download action displayed `SeriesPage.downloadCollection`.
- Opening the modal exposed `CollectionDownloadModal.dialogTitle`, labels,
  status text, and actions instead of human copy.
- The problem reproduced on the exact localized series route even though the
  relevant modal keys existed in locale JSON files.
- General catalog parity and ICU-formatting tests remained green.

## What Didn't Work

- Adding or translating catalog values alone did not expose their namespace to
  the route-scoped client provider.
- A first surgical `--keys` translation mode ran after the completed-progress
  resume check, so an explicitly requested correction could become a no-op.
- Advancing whole-catalog provenance after any scoped repair could certify
  unrelated stale source changes as translated.
- Sending the entire existing catalog as translation references made a small
  scoped repair unnecessarily expensive and increased irrelevant context.
- Structural, ICU, source-copy, and digest checks did not catch obvious
  wrong-writing-system fragments in low-resource machine output.

## Solution

Add every client-owned namespace to the route projection that can render it,
and test that projection directly:

```ts
export const WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES = [
  "CollectionDownloadModal",
  "SeriesPage",
  // other content-route client namespaces
] as const
```

Add the missing source messages first, then require exact key parity across
every shipped catalog. Translate the affected paths for machine-owned
catalogs, preserve explicitly provisional English fallbacks as provisional,
and refresh per-locale catalog/source provenance.

For safe scoped translation repairs:

1. Validate requested dotted keys before any API call or write.
2. Bypass the generic completed-progress fast path when `--keys` is present.
3. Translate and send reference copy only from the requested top-level
   namespaces.
4. Permit scoped promotion only when previous provenance is current or its
   source digest equals the current source with the requested additive keys
   removed. Otherwise fail with `SCOPED_PROMOTION_SOURCE_DRIFT`.
5. Isolate the default checkpoint by worktree and use process-specific atomic
   temporary paths so independent worktrees do not overwrite one another.

Translation prompts should honor an explicit BCP-47 script subtag. When a
locale does not specify a script, follow the writing system established by its
existing reference translations and use the likely default only when those
references do not establish one. This prevents an inferred likely-subtag from
overriding an established, legitimate catalog orthography.

## Why This Works

Route projection and catalog completeness are separate contracts. The
projection test proves that hydrated components receive the namespaces they
call through `useTranslations`; catalog parity proves that all locales contain
the source keys. Both must pass to prevent raw-key rendering.

The scoped translation guard makes partial repair auditable. Explicit keys
cannot be skipped, unrelated messages are neither rewritten nor certified,
and a source digest proves that the requested additive keys account for all
known drift before whole-catalog provenance advances.

## Prevention

- For every client-side `useTranslations("Namespace")`, verify that each route
  capable of rendering the component projects that namespace.
- Test source values as well as namespace membership; an allowlisted namespace
  can still lack a newly called key.
- Add source keys and all-catalog parity in the same change.
- Keep key-scoped repairs authoritative over generic resume state.
- Treat provenance as a certification boundary, not bookkeeping.
- Audit low-resource output for unrelated scripts separately from ICU and
  digest validation; those checks prove shape and history, not language
  identity.
- Keep unverifiable catalogs explicitly provisional instead of classifying
  English fallback or suspect output as translated.

## Verification

```bash
pnpm --filter @forge/web exec vitest run \
  src/i18n/client-messages.test.ts \
  src/i18n/__tests__/messages-parity.test.ts \
  src/lib/__tests__/watch-ui-provisional-catalogs.test.ts \
  scripts/translate-ui-catalogs.test.mjs
pnpm --filter @forge/web check:provisional-ui-catalogs
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

Browser-smoke the exact affected series route with the download modal open in
at least one left-to-right locale and one right-to-left locale. Confirm that
the DOM contains no namespace-shaped fallback text and that the RTL document
direction remains correct.

## Related Issues

- `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md`
- `docs/roadmap/topic-experiences/feat-266-watch-collection-download-localization.md`
