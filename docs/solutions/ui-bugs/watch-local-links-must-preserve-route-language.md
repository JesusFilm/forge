---
title: "Watch-local links must preserve the route language"
date: "2026-07-23"
category: "ui-bugs"
module: "apps/web Watch navigation"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "The compact header logo on a Hindi Watch video linked to bare /watch and returned the viewer to the default English experience"
  - "The page language modal linked to the unlocalized /watch/languages directory after the viewer had selected a custom language"
  - "Chapter links retained Hindi, so language continuity failed only on shared Watch-local navigation emitters"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/watch/LanguagePickerModal.tsx"
  - "apps/web/src/lib/routes.ts"
tags:
  - "watch"
  - "navigation"
  - "language-slug"
  - "routing"
  - "language-picker"
  - "nextjs"
---

# Watch-local links must preserve the route language

## Problem

Watch uses its public URL as the durable carrier for the viewer's selected
audio language. On
`/watch/jesus.html/women-disciples/hindi.html`, content links already retained
`hindi.html`, but the shared compact logo emitted bare `/watch` and the page
language modal emitted bare `/watch/languages`. Following either shared link
dropped the viewer's chosen language and made another selection necessary.

## Symptoms

- The reported Hindi episode rendered Hindi content and Hindi chapter links,
  while the compact header logo linked to the default Watch home.
- “All languages” in the content-specific language modal opened the
  unlocalized language directory.
- The failure was a valid navigation, not a 404 or runtime error, so ordinary
  link rendering and type checks did not reveal the lost language context.

## What Didn't Work

- Treating this as a persistence problem would add cookies or client state even
  though the selected language was already present in the route.
- Intercepting all clicks globally would hide malformed hrefs, weaken normal
  link semantics, and duplicate the route-builder contract.
- Changing content, canonical, share, download, footer, or outbound links would
  broaden the fix beyond the two emitters that actually dropped the language.

## Solution

Build each Watch-local destination with the applied public audio-language slug
at the component that owns the link.

The shared header already parses the current Watch path. Validate that parsed
language before constructing the compact logo destination:

```tsx
const currentLocaleSlug = tryAsLocaleSlug(currentLanguageSlug)
const logoHref = isWatchHome
  ? "https://www.jesusfilm.org/"
  : currentLocaleSlug && currentLocaleSlug !== "english"
    ? localizedHomePath(currentLocaleSlug)
    : "/"
```

This keeps the existing external ministry-logo behavior on Watch home, sends
non-English inner routes to their localized Watch home, and preserves the
default and malformed-route fallbacks.

The page language modal must use the currently applied language, not an
unsubmitted draft:

```tsx
const appliedLanguageSlug = tryAsLocaleSlug(currentLanguageSlug)
const allLanguagesPath =
  appliedLanguageSlug && appliedLanguageSlug !== "english"
    ? localizedLanguagesPath(appliedLanguageSlug)
    : languagesIndexPath()
```

Focused tests cover Hindi, English/default, and malformed inputs. Browser
verification starts on the reported contextual Hindi episode and checks the
actual hrefs and destinations:

- compact logo: `/watch/hindi.html`;
- chapter link: `/watch/jesus.html/{episode}/hindi.html`;
- all-languages link: `/watch/hindi.html/languages`.

## Why This Works

The route language is the authoritative public language identity, and the
existing route builders encode the supported Watch route families. Constructing
the href correctly at each emitter preserves ordinary browser navigation,
works without client-only persistence, and keeps the language visible and
shareable in every resulting URL.

Validating before calling a localized builder prevents malformed path segments
from becoming new public URLs. Treating English as the existing default alias
also avoids introducing unnecessary duplicate route shapes.

## Prevention

- Audit every user-visible link that remains inside Watch, including shared
  chrome and utility links, not only content cards.
- Use public audio-language slugs with the builders in
  `apps/web/src/lib/routes.ts`; never substitute a UI catalog key or BCP-47
  value.
- Derive modal utility links from applied state. Draft language selection should
  affect the destination only after the viewer applies it.
- Add exact href assertions for a non-English language and the default language
  whenever a shared Watch navigation emitter is introduced.
- Use a real-browser smoke from a contextual non-English episode because a
  syntactically valid default-language href will not fail type checking.

## Related Issues

- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`
  documents the public content-link shape and the lack of a redirect safety
  net.
- `docs/solutions/architecture-patterns/provider-owned-watch-language-fallback-and-page-overrides.md`
  separates public language identity, UI locale, playable media, and shared
  header ownership.
- `docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md`
  documents another silent loss of public slug-form language identity.
