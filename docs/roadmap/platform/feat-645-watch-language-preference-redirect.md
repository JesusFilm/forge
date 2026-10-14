---
id: "feat-645"
title: "Resolve Watch entry language from saved preference and browser locale"
owner: "vlad"
priority: "P1"
status: "complete"
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

Linear FGE-176: the public Watch entry and bare utility routes always use
English even when a visitor has a saved Watch language or sends a supported
`Accept-Language` value.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — public path classification, locale redirects, and rewrites.
2. `apps/web/src/lib/locale.ts` — language header parsing and public slug mapping.
3. `apps/web/src/lib/language-preference-constants.ts` — saved picker cookie name.
4. `apps/web/src/proxy.test.ts` — public redirect and internal rewrite coverage.

## Grep These

- `classifyRewrite`
- `parseAcceptLanguage`
- `forge_watch_lang`
- `LOCALE_RESOLVED_PARAM`
- `Accept-Language`

## What To Build

- Resolve saved public language cookie before a supported `Accept-Language` value.
- Redirect the bare homepage, `/languages`, `/history`, and `/whats-new` to
  the selected public language slug with a temporary 307.
- Preserve query state, including `_lr`, and vary personalized redirects on
  `Cookie` and `Accept-Language` with private caching.
- Keep unsupported or absent preferences on the current default English paths.

## Constraints

- Validate saved cookie values against the public language catalog.
- Do not add a network request or change localized video/episode routing.
- Do not change the visitor's saved preference cookie.

## Verification

- Focused proxy tests cover cookie precedence, Accept-Language redirects,
  query preservation, `Vary`, cache policy, and existing localized routes.
- Web typecheck, focused lint, and formatting checks pass.

## Production Routing Verification (2026-10-10)

- The exact `/watch` basePath root must have its own `/` proxy matcher; the
  generic exclusion matcher requires a slash and otherwise skips the root.
- `src/proxy-matcher.test.ts` exercises Next's compiled basePath matcher;
  removing the root matcher fails the regression. `e2e/watch-entry-language.spec.ts`
  checks actual Next HTTP redirects, cookie precedence, query preservation,
  private redirect caching, and explicit English controls.
- Production-build HTTP/browser checks confirmed Spanish and Arabic entry
  redirects, explicit English preference and deep-URL isolation. Default root
  rendering does not wait for the route manifest and retains the existing ISR
  page/cache policy.
- Next overwrites the proxy's `Vary` on default English ISR `200` responses.
  Preference redirects retain `Vary: Accept-Language, Cookie` and private
  caching. Current Cloudflare Watch HTML is `DYNAMIC`; any future shared HTML
  cache rule must preserve entry negotiation before serving cached responses.
