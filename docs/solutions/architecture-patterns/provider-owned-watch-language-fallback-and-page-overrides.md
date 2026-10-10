---
title: "Provider-owned Watch language fallback with tokenized page overrides"
date: "2026-07-15"
category: "architecture-patterns"
module: "apps/web watch"
problem_type: "architecture_pattern"
component: "frontend_stimulus"
severity: "high"
applies_when:
  - "A shared header control must exist on every route while a mounted page can replace it with a content-specific implementation"
  - "Multiple React owners publish and clean up shared UI state across StrictMode remounts or client navigation"
  - "An expensive modal or option catalog must stay off the initial client path and a deferred load can be superseded before it resolves"
related_components:
  - "apps/web/src/components/FloatingSearchProvider.tsx"
  - "apps/web/src/components/watch/GlobalLanguagePickerModal.tsx"
  - "apps/web/src/components/watch/HeroPlayer.tsx"
  - "apps/web/src/components/watch/SeriesPageClient.tsx"
  - "apps/web/src/lib/watch-player-chrome-events.ts"
  - "apps/web/src/lib/watch-interaction-loader.ts"
  - "apps/web/src/lib/watch-language-switcher.ts"
tags:
  - "watch"
  - "language-switcher"
  - "provider-ownership"
  - "ownership-token"
  - "intent-generation"
  - "lazy-loading"
  - "react-strict-mode"
  - "nextjs-app-router"
---

# Provider-owned Watch language fallback with tokenized page overrides

## Context

Watch has two language-switching contracts that share one header control. Video and series pages can identify playable languages for their current content, so their existing pickers are authoritative when alternatives exist. Home, authored collections, utility routes, unknown routes, and content without alternatives still need a switcher, but the global catalog cannot promise that the current video exists in every selected language.

The stable design is a provider-owned fallback. `FloatingSearchProvider` always renders exactly one language affordance. A visible page registration temporarily replaces its action with a content-specific picker; otherwise the provider opens the global picker and navigates to a route whose selected-language content is known to exist.

UI locale, public content-language identity, and playable media availability remain separate:

- Public Watch URLs use exact public slugs such as `spanish-latin-american`.
- The locale resolver derives the available translated UI catalog and `<html lang>` from that slug, falling back to English UI when necessary.
- Content-specific pickers switch only among verified playable variants.
- The global fallback uses the public catalog and sends unsupported content contexts to the selected localized home.

## Guidance

### Keep one permanent provider fallback

Render the header language button from `apps/web/src/components/FloatingSearchProvider.tsx` on every public route. Use a page-specific registration only when it is visible, has an `onClick` callback, and was published for the current pathname. Otherwise invoke the global picker.

Page publishers must attach a stable per-mount `ownerToken`. `HeroPlayer` and `SeriesPageClient` create a token once and include it in registration and cleanup events. The provider clears an override only when the cleanup token still matches the active owner. This prevents an older effect cleanup, including React StrictMode cycles, from erasing a newer registration.

A hidden page publisher yields to the global fallback; it does not remove the header button. This distinction keeps language switching available when the current content has fewer than two playable languages.

### Invalidate superseded deferred intent

Loading the global modal dynamically creates a race. A viewer can click the globe and then navigate, open search, unmount the provider, or receive a page-specific owner before the chunk resolves. Promise completion alone is not permission to open the modal.

The provider uses three guards:

- A monotonically increasing intent generation identifies the latest valid request.
- A pending pathname deduplicates repeated activation while the same request loads.
- A current-pathname ref confirms that navigation has not superseded the click.

Search intent, pathname changes, visible page-owner registration, and provider unmount invalidate the generation. Deferred success checks both its captured generation and pathname; failure and cleanup check the generation, with pathname-keyed state and route changes invalidating that generation. Owner tokens protect synchronous publication and cleanup ordering; intent generations protect asynchronous completion. They solve different stale-work problems and both are required.

### Stage the modal and catalog separately

The global control must not place the full language catalog on every route's initial client path. `apps/web/src/lib/watch-interaction-loader.ts` keeps separate cached layers:

1. `loadWatchInteraction("global-language")` loads and deduplicates the modal module. A rejected promise is evicted so the next click can retry.
2. `loadGlobalWatchLanguageOptions()` loads the compact catalog only after the modal mounts. Concurrent requests share one promise, successful results are cached, and a rejected pending promise is cleared for retry.

Post-load idle warmup may fetch the modal chunk, but it must not fetch catalog options. Keep server-only Admin metadata behind `apps/web/src/lib/watch-language-actions.ts`, and send the client only `{ slug, englishName, nativeName }`. The always-present provider should derive only a lightweight pathname candidate; the lazy modal validates that candidate against the loaded catalog.

### Preserve exact public slugs and truthful route targets

Validate the selected value with `isPublicWatchLanguageSlug` before persisting or navigating. Do not replace the public slug with a BCP-47 tag, message-catalog key, display name, or normalized family key. Regional slugs may share a language family while owning different content.

Use `languageSwitcherTarget` for the global routing matrix:

- Root, localized home, authored collection, content, and unknown routes go to the selected localized home.
- Localized video inventory stays in the `/videos` family.
- Language indexes stay in the `/languages` family.
- History stays in the `/history` family.

The content-specific picker may build a video, episode, or series destination because its options prove playability. The global catalog must not synthesize such a content URL.

Pass the raw public slug into localized-home resolution as well as the resolved UI locale. That lets the URL select language-scoped content while `next-intl` independently selects the supported UI catalog.

Localized utility routes need special alias handling because their language is segment zero, unlike content routes whose language is normally the final segment. Canonicalization must select the locale-bearing segment according to the route family.

### Keep loading and failure states localizable and retryable

Mark the trigger busy while the modal chunk loads and disable duplicate activation. If the chunk fails, expose a localized connection hint in the trigger label and a polite screen-reader status. The next activation must retry.

The modal separately handles catalog loading, empty data, catalog failure, invalid selection, and pending navigation using established translated messages. On apply, validate again, persist `forge_watch_lang`, then perform exactly one router push. Closing without navigation restores focus to the globe.

## Verification

Protect the distributed contract at its seams:

- Provider tests cover fallback routes, page-owner precedence, matching and stale cleanup, StrictMode ownership, chunk retry, duplicate clicks, and deferred-load invalidation on search, navigation, takeover, and unmount.
- Modal tests cover catalog normalization, exact-slug validation, route-family targets, localized states, preference-before-push ordering, duplicate submission, close paths, and focus restoration.
- Interaction-loader tests cover module and catalog deduplication, rejected-promise eviction, cache reuse, and no catalog request before interaction.
- Route, proxy, canonicalization, and page-routing tests cover admitted utility shapes, aliases, raw-slug preservation, and localized-home content resolution.
- Hero and series tests cover the visible/hidden publication gates that choose between page ownership and the provider fallback.

For performance verification, assert both halves of staging: no global modal or catalog request on the initial client path; idle may load only the modal module; catalog options begin only after the modal opens. Supplement source and unit evidence with browser resource timing when the local application can run.

## When to apply

Apply this pattern when a shared Watch control must exist across heterogeneous routes, a mounted page can supply a more precise action, effect owners may overlap or remount, and a deferred global interaction can be superseded before it resolves.

Do not use the global fallback to claim content availability. Prefer the content picker when the page can prove playable alternatives; otherwise navigate only to a route family whose selected-language content is known to exist.

## Related

- `docs/plans/2026-07-15-002-feat-watch-global-language-switcher-plan.md`
- `docs/roadmap/platform/feat-260-watch-global-language-switcher.md`
- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
- `docs/solutions/best-practices/suspense-gated-bus-lifecycle-and-ownership-tokens-20260422.md`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/solutions/performance-issues/watch-staged-client-loading-20260611.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
