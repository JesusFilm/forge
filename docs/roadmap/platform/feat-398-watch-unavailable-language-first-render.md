---
id: "feat-398"
title: "Render Watch unavailable-language recovery on the server"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-08-18"
duration: 1
depends_on:
  - "feat-361"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "i18n"
  - "performance"
---

## Problem

The known-content/missing-language recovery page first renders a generic slug,
gradient, and no audio options. After hydration it reads search context from
browser storage, calls a server action, and replaces the title, artwork, and
available audio controls. On slower connections the two visibly different
states flash in sequence.

The recovery resolver also exposed a shared content-identity mismatch:
Admin required both the exact `languageSlug` and its broad BCP-47 `locale` to
match before admitting exact metadata. A request for `chinese-simplified`
therefore missed the correct row when Web sent canonical `zh-Hans` and the row
stored equivalent `zh-hans`, then fell back to English. The same mismatch
affected normal Watch playback pages reached from localized cards.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchUnavailableLanguage.tsx` — server
   boundary for the localized recovery experience.
2. `apps/web/src/components/watch/WatchUnavailableLanguageClient.tsx` — current
   client-side recovery lookup and rendered UI.
3. `apps/web/src/lib/watch-unavailable-recovery-actions.ts` — manifest proof,
   playable audio options, and artwork validation.
4. `apps/web/src/proxy.ts` — fixed `/unavailable/404` rewrite and admission
   marker carrying the verified public path.
5. `docs/roadmap/content-discovery/feat-361-watch-search-unavailable-language-recovery.md`
   — existing recovery-page contract.

## What To Build

1. Read the Proxy-verified public path in the server recovery boundary and pass
   only that validated identity to the client.
2. Resolve localized title, artwork, and exact playable audio options before
   rendering.
3. Pass complete initial data to the client so hydration does not replace the
   visible page.
4. Preserve the fixed internal sentinel, final HTTP 404, `noindex`, original
   public URL, language selector, and safe fallback state.
5. Make Admin's Watch route snapshot select exact metadata by
   `languageSlug`; keep BCP-47 `locale` only for broad fallback and English as
   the final fallback.

## Constraints

- Do not add the rejected public path to the internal route or cache identity.
- Do not trust an unverified browser value as content or playback identity.
- Do not change search ranking, availability classification, valid playback
  routes, message catalogs, or the ordinary unknown-content 404.
- Do not change canonical URL or HTML language formatting, and do not force all
  content locale values to lower case; stored tags may legitimately contain
  mixed-case script or region subtags.
- Keep Admin credentials and data resolution server-only.
- Do not add a route-local loading screen that replaces the recovery UI before
  the server result arrives; avoiding that intermediate visible state is the
  purpose of this change. Unexpected errors continue to use the parent Watch
  locale error boundary.

## Verification

- Focused server/client recovery tests prove the first render contains the
  final title, artwork, and audio options without a hydration action.
- Production-mode local HTTP and throttled browser checks cover Chinese and a
  non-Chinese language, final 404/noindex behavior, and stable first paint.
- A BCP-47 representation regression test proves a localized card and its
  playback page resolve the same title and description through their exact
  language slug.
- Focused Admin service tests prove canonical input such as `zh-Hans` does not
  block a stored `zh-hans` row whose exact language slug matches.
- Full Web/Admin tests, typecheck, lint, formatting, and production build pass.
