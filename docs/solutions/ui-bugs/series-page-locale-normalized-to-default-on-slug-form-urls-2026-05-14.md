---
title: "Series page silently normalized slug-form locale to DEFAULT_LOCALE, displayed 'English' instead of the URL's language"
date: 2026-05-14
category: docs/solutions/ui-bugs
module: web/watch
problem_type: ui_bug
component: service_object
severity: high
symptoms:
  - "Visiting /watch/storyclubs/spanish-castilian (or any non-bcp47 slug-form locale) rendered the series page with 'English' selected in the inline LanguageCombobox"
  - "Same URL also opened the LanguagePickerModal (top-right globe) pre-selected to English, contradicting the URL segment"
  - "URL bar correctly showed the slug-form locale; UI state didn't match it"
  - "No console error or 404 — failure was silent because isLocale() returned false and code fell back to DEFAULT_LOCALE"
  - "Bug only affected the series page; the video page was already passing languageSlug separately and rendered the correct language"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - apps/web/src/app/[slug]/[locale]/page.tsx
  - apps/web/src/components/watch/SeriesPageClient.tsx
  - apps/web/src/components/watch/WatchPageClient.tsx
  - apps/web/src/lib/locale.ts
tags:
  - watch
  - series-page
  - locale
  - bcp47
  - slug-form
  - language-picker
  - next-app-router
  - dynamic-route
---

# Series page silently normalized slug-form locale to DEFAULT_LOCALE, displayed "English" instead of the URL's language

## Problem

The Next.js series page route at `apps/web/src/app/[slug]/[locale]/page.tsx` normalized the URL's `locale` segment through `isLocale()` (a bcp47-only validator) before passing it to `SeriesPageClient`. Because the app's URL convention is slug-form language identifiers (`english`, `spanish-castilian`) rather than bcp47 codes (`en`, `fr-CA`), every non-`en` slug failed validation and silently fell back to `DEFAULT_LOCALE`, breaking the language UI on the series page.

This is the **second occurrence** of the same bug shape. The video page (`WatchPageClient`) had already been fixed on 2026-05-13 on `feat/web-video-language-switcher` (PR #936, commit `fb4fe515`) by passing `rawLocale` directly to its resolver. The series page was added later without inheriting that pattern, and the bug came back on a different surface.

## Symptoms

- Navigating to `/watch/storyclubs/spanish-castilian` displayed "English" in both the inline `LanguageCombobox` and the `LanguagePickerModal` globe label.
- URL bar correctly showed `spanish-castilian` (the upstream language-preference proxy had redirected correctly based on the cookie).
- The bug surfaced specifically _after_ changing language on a video page and navigating to the series — proving the cookie + URL plumbing was correct, but the series page's locale prop wasn't honoring it.
- No console error, no failed network request — pure silent fallback.

## What Didn't Work

1. **Looked inside `SeriesPageClient` first.** Traced the `currentLanguageSlug` resolver:

   ```ts
   const currentLanguageSlug =
     languageOptions.find(
       (opt) =>
         opt.slug === locale || opt.slug.toLowerCase() === locale.toLowerCase(),
     )?.slug ??
     slugByBcp47.get(locale.toLowerCase()) ??
     languageOptions[0]?.slug ??
     ""
   ```

   The resolver was _correct_ — given `locale === "spanish-castilian"` it would have matched on the first `find`. Time was lost auditing the bcp47 fallback chain (`slugByBcp47.get(...)`) and the `languageOptions[0]` default, both red herrings. The bug was upstream: `locale` was never `"spanish-castilian"` by the time it reached this resolver.

2. **Suspected the modal and combobox were reading from different sources.** Cross-checked both — they both consumed `currentLanguageSlug` from the same hook. Wasted check; the resolver was getting `"en"`, not diverging consumers.

3. **Suspected stale React state from the language-change navigation.** Hard-reloaded the page; bug persisted. Ruled out client-state leak.

The breakthrough came from grepping for `<SeriesPageClient` invocations and finding `apps/web/src/app/[slug]/[locale]/page.tsx` normalized `rawLocale → locale` via `isLocale()` _before_ passing it down. Investigation should have started at the route's `page.tsx` and walked downward, not started at the client component and walked upward.

## Solution

In `apps/web/src/app/[slug]/[locale]/page.tsx`, both series-page render branches (trailer-bearing and trailerless) now pass `rawLocale` instead of the bcp47-normalized `locale`:

```diff
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  // locale is still used for i18n internals that genuinely need bcp47

  // Trailer-bearing branch:
- <SeriesPageClient series={watchVideo.video} selectedVariant={watchVideo.selectedVariant} locale={locale} />
+ <SeriesPageClient series={watchVideo.video} selectedVariant={watchVideo.selectedVariant} locale={rawLocale} />

  // Trailerless branch:
- <SeriesPageClient series={watchVideo.video} locale={locale} />
+ <SeriesPageClient series={watchVideo.video} locale={rawLocale} />
```

`isLocale()` normalization is retained for any internal bcp47-requiring consumers; only the user-facing language identifier passed to `SeriesPageClient` is now the unmodified URL segment.

Regression tests added to `apps/web/src/app/[slug]/[locale]/__tests__/page-routing.test.tsx`:

```ts
it("passes raw slug-form locale to SeriesPageClient (trailer-bearing branch)", async () => {
  // params: { slug: "storyclubs", locale: "spanish-castilian" }
  expect(SeriesPageClient).toHaveBeenCalledWith(
    expect.objectContaining({ locale: "spanish-castilian" }),
    undefined,
  )
})

it("passes raw slug-form locale to SeriesPageClient (trailerless branch)", async () => {
  // same params, mocked GraphQL response without trailer
  expect(SeriesPageClient).toHaveBeenCalledWith(
    expect.objectContaining({ locale: "spanish-castilian" }),
    undefined,
  )
})
```

Both tests use a slug-form locale (`"spanish-castilian"`) that would have been normalized to `"en"` under the old code. The assertion that the unchanged value reaches the client is what locks the fix in.

## Why This Works

Two app-wide conventions were colliding silently:

1. **`isLocale()` is bcp47-only by design.** Its predicate accepts `en`, `fr-CA`, `pt-BR` — not `english`, `spanish-castilian`. This is correct for code paths that genuinely need a bcp47 code (e.g., `Intl.*` APIs, `Accept-Language` headers).
2. **The URL convention is slug-form.** Routes like `/watch/storyclubs/spanish-castilian` are intentional; slugs are human-readable, stable across bcp47 reshuffles, and what the language picker writes.

The gap: a bcp47 validator was being used as a generic "is this a valid language identifier" guard, with `DEFAULT_LOCALE` as the silent fallback. Every non-`en` URL segment failed the predicate and snapped to `"en"` without any warning. Because `SeriesPageClient`'s language UI is downstream of this normalization, it had no way to recover the real URL value.

`WatchPageClient` already encoded the right pattern at the same `page.tsx` — its invocation reads `languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}`, separating the bcp47 locale (for i18n internals) from the slug-form identifier (for language UI). Series rendering wasn't updated to match this pattern when it was added, so the bug recurred on a new surface.

## Prevention

1. **Default to `rawLocale` for any user-facing language identifier.** When adding a new client component under `[slug]/[locale]/page.tsx`, pass the URL segment unchanged. Only normalize via `isLocale()` for code paths that genuinely require bcp47 (e.g., `Intl.DateTimeFormat`, `Accept-Language` negotiation). Prefer a per-record `languageSlug` (e.g., `watchVideo.selectedVariant.language?.slug ?? rawLocale`) when the GraphQL payload provides one — it survives URL drift.

2. **Mirror the `WatchPageClient` pattern when adding a new page-route consumer.** That route already separates the bcp47 locale from the slug-form language identifier. Any new branch in `[slug]/[locale]/page.tsx` should follow the same split. This is the load-bearing recurrence-prevention rule — the bug has come back twice now precisely because the pattern wasn't carried forward.

3. **Regression-test every page-route render branch with a slug-form locale.** Every `<XPageClient locale={...} />` render branch in `apps/web/src/app/[slug]/[locale]/page.tsx` needs a sibling test that passes `"spanish-castilian"` (or another non-`en` slug-form value) and asserts the raw value reaches the client. This is the smallest possible test that pins down the contract and would have caught the bug in CI.

4. **Audit `isWatchRoute` and other proxy-layer helpers for the same bcp47/slug-form gap.** The first fix round on the video switcher (2026-05-13) also caught `proxy.ts:isWatchRoute()` matching bcp47-only — slug-form URLs fell through to the Accept-Language redirect and produced 404s. That helper has been fixed, but any new proxy-layer helper that classifies the `/[slug]/[locale]` URL shape should recognize both forms. (session history)

5. **Consider renaming `isLocale()` to `isBcp47Locale()`.** The current name is ambiguous — at the call site `isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE` reads like a generic "is this a valid language identifier" check. Renaming makes the contract unambiguous and forces callers to reconsider whether they actually want bcp47 semantics or slug-form pass-through. One-shot rename across `apps/web/`, compiler-driven; do it the next time the helper is touched.

6. **Grep before refactoring locale helpers.** When changing a language-identifier helper or its consumers, run `rg 'isLocale\(' apps/web/src` to enumerate every call site and audit whether each one wants bcp47 normalization or raw pass-through. The series-page fix needed both render branches updated — single-branch fixes would leave the other path broken.

## Related Issues

- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` — high overlap. Treats `isLocale` parity between proxy and page as the contract; this bug shows that parity is necessary but not sufficient when downstream consumers display the locale identifier. A short refresh note on that doc is warranted.
- `docs/solutions/web/nextjs-headers-defeats-route-cache.md` — defines the `isLocale` + `DEFAULT_LOCALE` + `parseAcceptLanguage` triple and originates the proxy-vs-page locale split. Moderate overlap.
- `docs/solutions/web/nextjs16-cachecomponents-isr.md` — same proxy/page locale split, same `DEFAULT_LOCALE` fallback architecture. Moderate overlap.
- `docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md` — different root cause (Strapi pagination cap) but same "watch page silently renders wrong language" symptom class. Cross-link as a sibling symptom.
- PR #936 on `feat/web-video-language-switcher` (commit `fb4fe515`, 2026-05-13) — the first occurrence of this bug, fixed by passing `rawLocale` to `resolveWatchVideoBySlug`. Same root cause, same fix shape, different page-route consumer. (session history)
