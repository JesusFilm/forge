---
title: Migrate apps/web to next-intl for full i18n + retire static SUPPORTED_LOCALES
type: feat
status: active
date: 2026-05-28
---

# Migrate apps/web to next-intl for full i18n

## Overview

Apps/web ships English-only today. UI strings are hardcoded inline literals across ~100 sites; there is no translation runtime. The static `SUPPORTED_LOCALES = ["en","es","fr","pt","de"]` array in `lib/locale.ts` is a bcp47 allowlist for URL discrimination, NOT a translation gate — widening it changes nothing user-visible because no translated copy exists.

This plan migrates apps/web to [`next-intl`](https://next-intl.dev/) (Next.js 16 App Router-native), retires the static `SUPPORTED_LOCALES` constant in favor of filesystem-discovery of message catalogs, and establishes the infrastructure for an international ministry to translate UI chrome into any of the 2300+ languages admin already serves audio content for. Day-one ship matches today (5 UI locales); the path to N locales becomes "drop a JSON file, rebuild" — no code change required.

**Critical URL design constraint (revised 2026-05-28):** locale is NOT a new URL segment. The existing production URL structure `/watch/{slug}.html/{audio-language-slug}.html` (e.g. https://www.jesusfilm.org/watch/jesus.html/spanish-latin-american.html) IS the locale carrier. The audio-language slug already encodes the user's language intent — UI chrome locale derives from it via the family-fallback chain shipped in Phase 2 (`spanish-latin-american` → `es-419` → `es`). **No `/es/watch/...` subpath. No new cookie.** next-intl is configured in "locale supplied from request" mode where the route handler extracts locale from the URL via the existing `resolveUiLocale()` helper and feeds it to next-intl via `setRequestLocale()`. Single source of truth: URL.

JesusFilm/core's apps/watch uses `next-i18next` on Pages Router. That stack is legacy. Apps/web is Next 16 App Router, so `next-intl` is the modern equivalent that matches our framework. Setup philosophy mirrors core (per-locale JSON files, namespaced by component, shared message format) but uses the App Router-native library.

## Problem Statement

### Current state

- **Zero translation runtime.** `package.json` has no i18n library (no `next-intl`, `next-i18next`, `react-intl`, `@formatjs`, `lingui`). Strings ship as English literals inline.
- **`SUPPORTED_LOCALES` is fictional UI scope.** Used at 3 sites:
  1. [`lib/locale.ts`](apps/web/src/lib/locale.ts) — declaration + `isLocale()` bcp47 discriminator.
  2. [`app/api/revalidate/route.ts`](apps/web/src/app/api/revalidate/route.ts) — loops over to revalidate per-locale paths.
  3. [`app/demo-recommendations/[slug]/[locale]/page.tsx`](apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx) — filter.
     None of these consume translated strings — only the routing-discriminator role is real. The "5 locales" limit comes from this allowlist and nothing else.
- **`<html lang="en">` hardcoded** in [`app/layout.tsx:78`](apps/web/src/app/layout.tsx). hreflang `alternates.languages` never emitted in [`lib/experience-metadata.ts`](apps/web/src/lib/experience-metadata.ts) (line 99/151/223 emit only `canonical`).
- **Two separate locale concerns conflated under "locale"**:
  1. **Audio/content language** — admin's `Language.slug` + `bcp47` (`russian`, `portuguese-brazil`, `spanish-castilian`) drives variant selection, language picker UI, OG locale, share metadata. Phase 2 of the /watch URL restructure threads this end-to-end via the catch-all route + `forge_watch_lang` cookie + `resolveUiLocale` family fallback. Works today.
  2. **UI chrome language** — buttons, aria-labels, headings, modals. Hardcoded English. No infrastructure to translate.
- **~100 hardcoded user-facing strings** across ~30 component files. Concentration:
  - Watch player chrome: ~25 strings (`HeroPlayer`, `HeroPlayerControls`, `DownloadButton`, `WatchModalViewportCloseButton`, `SiblingCarousel`)
  - Modals: ~20 strings (`DownloadModal`, `ShareModal`, `LanguagePickerModal`, `LanguageCombobox`)
  - Section blocks: ~25 strings (`CarouselVideo`, `Video`, `VideoHero`, `QuizButton`, `RelatedQuestions`, `MediaCollection`, `NavigationCarousel`)
  - Search overlay: ~12 strings (`FloatingSearchField`, `FloatingSearchBar`, `SearchOverlay`, `FloatingSearchProvider`, `SearchInput`, `SearchResults`, `VideoCard`)
  - Study questions + Bible quotes + series page + error/empty states: ~15 strings
  - Metadata copy: ~5 strings (`experience-metadata.ts` site name, descriptions)

### Why the gap matters

- **Mission alignment**: JesusFilm Project's mission is to deliver gospel media in every language. Serving Spanish AUDIO with English BUTTONS undermines the experience for non-English speakers. Today every user outside the 5 UI families sees an English shell.
- **SEO**: Without hreflang alternates + `<html lang>`, search engines can't differentiate localized pages. Google de-indexes near-duplicates.
- **Operational scale**: Adding a UI language today requires touching `SUPPORTED_LOCALES`, every route that branches on it, hardcoded `<html lang>`, and re-deploying. Should be drop-in.
- **Co-located locale concerns conflate**: bug surface every time. Today's `LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"` cookie is named after watch-audio-language even though the URL segment ALSO encodes UI chrome. Split them.

### Production URL contract

The `/watch` URL structure is in flux (parallel to [the /watch URL restructure plan](docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md), Phase 2 in flight). This i18n migration **does NOT change URL shape**. UI chrome locale derives from the existing audio-language segment.

URL contract (unchanged from production today):

- `/watch` → English default home
- `/watch/jesus.html/english.html` → English audio + English UI
- `/watch/jesus.html/spanish-castilian.html` → Spanish-Castilian audio + Spanish UI (resolved via Phase 2 `resolveUiLocale`)
- `/watch/jesus.html/spanish-latin-american.html` → Spanish (LatAm) audio + Spanish UI
- `/watch/jesus.html/portuguese-brazil.html` → Brazilian Portuguese audio + Portuguese UI
- `/watch/jesus.html/mandarin-china.html` → Mandarin audio + UI falls back to English (Mandarin UI catalog ships post-day-one)
- `/watch/lumo.html/wedding-in-cana/spanish-castilian.html` → 3-seg episode, Spanish UI

**One source of truth**: the audio-language slug in the URL. UI chrome locale = `resolveUiLocale(audioSlug) ?? "en"` (already implemented in Phase 2). No new subpath, no new cookie, no Accept-Language fallback at the page layer (proxy.ts still does Accept-Language for the bare `/watch` → `/watch/{slug}/{locale}` redirect — unchanged).

When the audio language has a UI translation catalog available (e.g. `messages/es.json` exists), the rendered page is translated. When the audio language doesn't (e.g. `mandarin-china` → `zh` → no `messages/zh.json`), the page falls back to English chrome but still serves the requested audio dub. Day-one ship: en/es/fr/pt/de catalogs; growth = drop more JSON files.

## Proposed Solution

### Architecture

```
URL → proxy.ts (existing middleware, UNCHANGED at the i18n layer)
        ├─ canonicalize watch path (Phase 3 of /watch restructure)
        ├─ existing cookie-driven audio-language redirect (forge_watch_lang)
        ├─ existing Accept-Language fallback (for bare /watch redirects)
        │  (no next-intl middleware — URL is already the locale carrier)
        └─ next()
              │
              ▼
        Next.js App Router → app/[slug]/[...rest]/page.tsx (Phase 2 catch-all, UNCHANGED structure)
              │
              ▼
        page.tsx server component
        ├─ classify(rawSlug, rest) → { rawLocale, locale }   ← already does this (Phase 2)
        ├─ setRequestLocale(locale)                          ← NEW: feed next-intl
        ├─ getTranslations('Namespace')                      ← NEW: server-side t()
        └─ render with translated copy
              │
              ▼
        Client components
        ├─ useTranslations('Namespace')   ← reads from NextIntlClientProvider in layout
        ├─ existing audio language picker (separate concern, unchanged)
              │
              ▼
        generateMetadata
        ├─ alternates.languages: map each available UI locale → matching audio-slug URL
        └─ <link rel="canonical"> + hreflang
```

next-intl is configured in **"locale supplied from request" mode** — no `[locale]` segment in the file tree, no `localePrefix`, no `createMiddleware(routing)`. Instead, the existing Phase 2 catch-all extracts locale from URL segments via `resolveUiLocale()` and feeds it to next-intl via `setRequestLocale()`. The library then provides translation lookup, ICU formatting, and message loading.

### Library choice: next-intl

Why next-intl over alternatives:

- **Native Next.js 16 App Router support**. `app/[locale]/*` segment, async `params: Promise<{locale}>`, server + client components, ISR-compatible.
- **Composable middleware**: `createMiddleware(routing)` returns a function; we wrap it in our existing `proxy.ts` after the canonicalize step.
- **Per-locale JSON catalogs** with namespacing (e.g. `WatchPage`, `HeroPlayer`, `ShareModal`). Familiar shape; integrates with Crowdin / Phrase / Lokalise / OpenAI batch.
- **Build-time message ICU precompilation** — runtime parse cost effectively zero.
- **`localePrefix: 'as-needed'`** keeps `/watch` (English) prefix-free and adds `/es/watch`, `/de/watch` etc only for non-default. Preserves all existing English URLs.
- **Type-safe Route helpers + `<Link>`** integration via `defineRouting`.

Why NOT `next-i18next` (what JesusFilm/core uses):

- Pages Router-first; App Router support is a community shim, not first-party.
- Doesn't compose with Next 16's RSC + streaming.

### Locale list: drop `SUPPORTED_LOCALES`, derive from filesystem

The static constant is replaced by filesystem discovery at build time:

```ts
// src/i18n/routing.ts
import { readdirSync } from "fs"
import { join } from "path"

// Discover available UI translation catalogs by scanning the messages dir.
// Adding a new UI locale = drop messages/{locale}.json + rebuild. Zero code.
const messagesDir = join(process.cwd(), "messages")

export const AVAILABLE_UI_LOCALES = readdirSync(messagesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort() as readonly string[]

export const DEFAULT_LOCALE = "en"

export function hasUiLocale(candidate: string): boolean {
  return (AVAILABLE_UI_LOCALES as readonly string[]).includes(candidate)
}
```

**No `defineRouting`. No `localePrefix`. No `localeCookie`.** Those are next-intl features for sites that use a URL segment OR cookie as the locale carrier. We don't — the URL's existing audio-language slug already carries it.

**The 2300 admin languages still flow through.** They drive audio variant selection, language picker UI, and OG `og:locale` — Phase 2's `resolveUiLocale` chain handles that. The `AVAILABLE_UI_LOCALES` list is the subset of admin languages that ALSO have UI translation catalogs (drop a JSON file = the locale gets translated chrome). Day 1 ships the same 5 as today; growth is a translation-team activity, not engineering.

### No new cookie

The existing `forge_watch_lang` cookie continues to drive the cookie-based audio-language redirect at the proxy (e.g., a German missionary picks "Russian" in the language picker → cookie stored → next bare-shape visit redirects them to the Russian audio URL). UI chrome locale is purely a FUNCTION of the URL — no cookie, no header, no negotiation. URL IS the locale.

The user-facing implication: a Spanish-speaking missionary watching a Russian video at `/watch/jesus.html/russian.html` sees English UI chrome (because `russian → ru → no messages/ru.json → default en`). When `messages/ru.json` ships, the same URL renders Russian chrome automatically. The user's "preferred UI language" is whatever the URL says.

This is intentional and matches the production user expectation: the URL is the deep-link contract. Shareable. Crawlable. No invisible state.

### Translation organization

```
apps/web/messages/
├── en.json      (source of truth, English; checked in)
├── es.json      (Spanish — current SUPPORTED_LOCALES set)
├── fr.json
├── pt.json
├── de.json
└── README.md    (translation contributor guide)
```

JSON shape: namespaced by component to enable code-splitting:

```json
{
  "WatchPage": {
    "loading": "Loading…",
    "error": "Something went wrong loading this page."
  },
  "HeroPlayer": {
    "tapToUnmute": "Tap to Unmute",
    "playWithSound": "Play with Sound",
    "pause": "Pause",
    "play": "Play"
  },
  "ShareModal": {
    "title": "Share video",
    "copyLink": "Copy Link",
    "copied": "Copied"
  },
  "LanguagePickerModal": {
    "translateWithAI": "Translate with AI",
    "requestSent": "Request sent",
    "noSubtitles": "No subtitles"
  }
}
```

ICU plural / select / number / date formatting baked in (e.g. `"clipNofM": "{n, plural, one {Clip # of #} other {Clip # of #}}"`).

### Component consumption

Server component:

```tsx
import { getTranslations } from "next-intl/server"

export default async function Page() {
  const t = await getTranslations("WatchPage")
  return <h1>{t("title")}</h1>
}
```

Client component:

```tsx
"use client"
import { useTranslations } from "next-intl"

export function ShareButton() {
  const t = useTranslations("ShareModal")
  return <button aria-label={t("title")}>{t("copyLink")}</button>
}
```

### Coexistence with Phase 1-6 of /watch URL restructure

The /watch URL restructure plan ([docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md](docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md)) and this i18n plan touch the SAME surface but in NON-conflicting ways. The /watch plan owns the URL contract; this plan owns translation runtime. No URL shape change here.

| /watch phase                                                | i18n migration  | Coordination                                                                                    |
| ----------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| Phase 1 (foundation modules — merged)                       | —               | None                                                                                            |
| Phase 2 (catch-all + family fallback — merged via PR #1051) | Prerequisite    | `resolveUiLocale()` from Phase 2 is consumed by this plan's `setRequestLocale()` wiring         |
| Phase 3 (proxy normalization)                               | —               | Independent; proxy.ts changes for canonicalize don't touch translation runtime                  |
| Phase 4 (href emission migration)                           | Phase 5 of i18n | URL builders stay shape-stable; this plan doesn't need to wait for them                         |
| Phase 5 (SEO + sitemap + hreflang)                          | Phase 6 of i18n | hreflang alternates emit per audio-language URL; this plan provides `AVAILABLE_UI_LOCALES` data |
| Phase 6 (probe harness)                                     | Phase 7 of i18n | Probe harness runs against the same URL space (unchanged shape)                                 |

This plan can ship in parallel with /watch Phase 3+. No hard blocker beyond Phase 2 (already merged).

## Technical Approach

### Architecture decisions

**1. URL contract UNCHANGED.** No `[locale]` segment added. No `/es/watch/...` subpath. The existing audio-language slug (last segment of the canonical 2-seg / 3-seg shape) IS the locale carrier. Single source of truth: the URL the user sees.

**2. Drop the static `SUPPORTED_LOCALES` constant.** Replace with filesystem discovery from `messages/*.json`. The 3 sites that consume it migrate to:

- `AVAILABLE_UI_LOCALES` (readonly string[]) for runtime loops
- `hasUiLocale(x)` for membership checks

**3. Audio routing untouched.** Phase 2's catch-all `app/[slug]/[...rest]/page.tsx` and its `resolveUiLocale` family fallback continue to handle the audio-language slug + UI locale resolution. This plan extends that resolver chain to ALSO call `setRequestLocale()` so next-intl knows which catalog to load.

**4. next-intl in "locale supplied from request" mode.** No `defineRouting`. No middleware. `getRequestConfig` reads the locale from a request-scoped store populated by `setRequestLocale(locale)` in the page handler. This is documented next-intl usage for sites with custom locale negotiation.

**5. `<html lang>` becomes dynamic.** Root `app/layout.tsx` reads the resolved locale via `getLocale()` and sets `<html lang={locale}>`.

**6. hreflang alternates emit per audio-language URL.** For `/watch/jesus.html/english.html`, alternates list each available dub of the same video at its corresponding URL (`spanish-castilian → /watch/jesus.html/spanish-castilian.html`, etc.). This matches the production model: alternates are "other dubs", not "this URL in other UI shells". Phase 6 owns the emission.

**7. Translation pipeline: LLM-batch (day-one) → Crowdin (ongoing).** next-intl documents first-class Crowdin integration. Start with English baseline + LLM-translated 4 others for day-one ship matching today; transition to Crowdin once translation volume justifies the subscription.

### Implementation Phases

#### Phase 1 — Library install + scaffold

Pure additions; no behavior change. Ship behind `main`.

**Files to add:**

- `apps/web/package.json` — add `next-intl@^4.0.0` dep.
- `apps/web/messages/en.json` — empty `{}` initially; populated in Phase 3.
- `apps/web/src/i18n/locales.ts` — filesystem discovery + helper:

```ts
// apps/web/src/i18n/locales.ts
import { readdirSync } from "fs"
import { join } from "path"

const messagesDir = join(process.cwd(), "messages")

export const AVAILABLE_UI_LOCALES = readdirSync(messagesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort() as readonly string[]

export const DEFAULT_LOCALE = "en" as const

export function hasUiLocale(candidate: string): boolean {
  return (AVAILABLE_UI_LOCALES as readonly string[]).includes(candidate)
}
```

- `apps/web/src/i18n/request.ts` — server-side message loader per request. Uses `requestLocale` populated by `setRequestLocale()` in the page handler:

```ts
import { getRequestConfig } from "next-intl/server"
import { AVAILABLE_UI_LOCALES, DEFAULT_LOCALE, hasUiLocale } from "./locales"

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale =
    requested && hasUiLocale(requested) ? requested : DEFAULT_LOCALE
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
```

- `apps/web/next.config.mjs` — wire next-intl plugin:

```js
import createNextIntlPlugin from "next-intl/plugin"
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")
const nextConfig = {
  /* existing */
}
export default withNextIntl(nextConfig)
```

**Done criteria:** typecheck + lint + build clean. App renders English-only at unchanged URLs. No `[locale]` segment. No middleware change.

#### Phase 2 — Wire `setRequestLocale` into existing route handlers

NO file moves. NO `[locale]` segment. NO middleware change. Existing Phase 2 catch-all already extracts locale from URL — extend it to feed next-intl.

**Files to modify:**

- `apps/web/src/app/[slug]/[...rest]/page.tsx` — top of both `generateMetadata` AND `SlugRestPage` (and the two `render*` helpers) call `setRequestLocale(shape.locale)` immediately after `classify()`:

```tsx
import { setRequestLocale } from "next-intl/server"
import { hasUiLocale } from "@/i18n/locales"

export default async function SlugRestPage({ params }: PageProps) {
  const { slug: rawSlug, rest } = await params
  const shape = classify(rawSlug, rest)
  if (shape.kind === "unknown") notFound()
  // Feed next-intl. shape.locale is the result of resolveUiLocale()
  // from Phase 2 → falls back to DEFAULT_LOCALE='en' when audio language
  // isn't in AVAILABLE_UI_LOCALES.
  setRequestLocale(hasUiLocale(shape.locale) ? shape.locale : "en")
  // existing dispatch …
}
```

Same in `app/[slug]/page.tsx`, `app/page.tsx`, `app/search/page.tsx`, `app/videos/page.tsx`. Default locale `'en'` for routes without a URL locale segment.

- `apps/web/src/app/layout.tsx` — replace hardcoded `<html lang="en">` with dynamic, wrap children in `NextIntlClientProvider`:

```tsx
import { getLocale } from "next-intl/server"
import { NextIntlClientProvider } from "next-intl"
// existing imports

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  return (
    <html lang={locale} dir="ltr" className="…">
      <body>
        <NextIntlClientProvider>
          {/* existing layout content: fonts, FloatingSearchProvider, etc. */}
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
```

- `apps/web/src/lib/locale.ts` — `resolveUiLocale` already correct; no change. Drop `SUPPORTED_LOCALES` export + replace internal uses with `AVAILABLE_UI_LOCALES` from `@/i18n/locales`. `isLocale()` stays for the bcp47-only discriminator role used by proxy.ts (Accept-Language detection).

**No proxy.ts change in this phase.** URL contract unchanged; no middleware composition needed.

**Done criteria:** `getTranslations()` / `useTranslations()` work in any server / client component. Locale flows URL → `classify` → `setRequestLocale` → next-intl. `<html lang>` reflects URL locale. Existing tests pass (translations are no-ops while catalogs are empty — see Phase 3).

#### Phase 3 — String extraction

Replace ~100 hardcoded English literals with `t(...)` calls. Per-component pass.

**Files to modify** (grouped by namespace; full inventory in §"Audit"):

- `messages/en.json` — populate with all extracted strings, namespaced:

```json
{
  "WatchPlayer": {
    "tapToUnmute": "Tap to Unmute",
    "playWithSound": "Play with Sound",
    "pause": "Pause",
    "play": "Play",
    "seek": "Seek",
    "volume": "Volume",
    "unmute": "Unmute",
    "mute": "Mute",
    "changeAudioLanguage": "Change audio language",
    "enterFullscreen": "Enter fullscreen",
    "exitFullscreen": "Exit fullscreen",
    "close": "Close",
    "download": "Download"
  },
  "ShareModal": { ... },
  "DownloadModal": { ... },
  "LanguagePickerModal": { ... },
  "SearchOverlay": { ... },
  "VideoCard": { ... },
  "WatchStudyQuestions": { ... },
  "BibleQuotes": { ... },
  "ExperienceError": { ... },
  "Metadata": { ... }
}
```

- Each component: replace inline literal with `t('keyname')`. Example:

```tsx
// BEFORE
<button aria-label="Pause">{...}</button>

// AFTER
const t = useTranslations('WatchPlayer')
<button aria-label={t('pause')}>{...}</button>
```

- Codemod approach: dispatch a subagent per component group with a focused task to convert literals → `t()` calls and add `messages/en.json` entries. ~6-8 subagents total covering the audit groups.

**Done criteria:** every user-facing literal in `src/components/**` is wrapped. CI grep gate: `rg 'aria-label="[A-Z]' apps/web/src/components` returns empty (manual review for edge cases). Type-check still passes (next-intl provides typed `t` keys).

#### Phase 4 — Translate to 4 other locales

Day-one ship: en + es + fr + pt + de (matching today's `SUPPORTED_LOCALES`).

- LLM-batch translate `messages/en.json` → `messages/{es,fr,pt,de}.json`. ~1 hour. ~$2 for 4 locale × ~100 keys.
- Native-speaker QA review optional (recommend deferring until Crowdin pipeline lands).
- Commit all 5 files.

**Done criteria:** All 5 message catalogs present + match schema (every key in `en.json` exists in the other 4). CI test asserts structural parity.

#### Phase 5 — URL builders + audio-language emission

Confirm `lib/routes.ts` builders stay as-is. URL contract is shape-stable; locale rides in the audio-language slug. No `next-intl/navigation` migration needed (no `[locale]` segment, so the typed-router add-on adds no value).

- Keep `next/link` direct imports throughout. The audio-language slug captures locale; client-side nav is already locale-aware via the URL builder.
- `lib/routes.ts` `BuildOptions.reason` literal union: stays as-is. Phase 2 already emits canonical `.html` shape via `watchVideoPath`/`watchEpisodePath`.

**Done criteria:** sanity-grep — no internal `<Link>` import drift. Skip.

#### Phase 6 — hreflang + sitemap + canonical alternates

SEO surface. Coordinates with /watch Phase 5 (sitemap + canonical) and Phase 4 (href emission).

- `experience-metadata.ts` — emit `alternates.languages` per page. The mapping per video page is "this video's other dubs", not "this URL in other UI languages":

```ts
// pseudo
alternates: {
  canonical: watchVideoAbsolute(slug, lang),
  languages: video.availableDubs.reduce((acc, dub) => {
    acc[dub.bcp47] = watchVideoAbsolute(slug, asLocaleSlug(dub.slug))
    return acc
  }, {} as Record<string, string>),
}
```

- `app/sitemap.ts` — emit one entry per (slug, dub) tuple. Each entry includes hreflang alternates so crawlers see the full locale matrix.
- `getOgLocale(locale)` in `experience-metadata.ts` — extend to derive OG locale for any `AVAILABLE_UI_LOCALES` entry (not the hardcoded 5).

**Done criteria:** Google Rich Results Test on `/watch/jesus.html/english.html` shows hreflang entries for every available dub. Search Console URL Inspection API verifies indexability per locale.

#### Phase 7 — Probe harness + monitoring

Extend `apps/web/scripts/probe-watch-urls.ts` (from /watch Phase 6) to assert UI-chrome locale rendering per audio-language URL.

- Probe matrix: every URL × every available UI locale. URL shape unchanged from /watch Phase 6; this phase adds CONTENT assertions:
  - `/watch/jesus.html/spanish-castilian.html` → response body contains Spanish UI strings (assert `og:locale="es_ES"` + a known translated string like "Compartir video").
  - `/watch/jesus.html/mandarin-china.html` → falls back to English UI (`og:locale="en_US"`, "Share video"). Pass.
- Monitoring: Cloudflare Analytics cache-status per audio-language slug; Search Console impressions per locale.

**Done criteria:** probe harness passes for full audio-language matrix. Spot-check screenshots from a few locale URLs confirm UI chrome translates. Cutover sign-off.

### Phase ordering rationale

Hard prereqs:

1. /watch Phase 2 (catch-all + family fallback + `resolveUiLocale`) MUST be merged. ✓ shipped in PR #1051.

All this plan's phases can ship independently — no `[locale]` segment migration means no proxy/middleware composition, no URL contract change, no /watch Phase 3 dependency.

Recommended sequencing:

1. Phase 1 — scaffold (now-mergeable)
2. Phase 2 — wire `setRequestLocale` (now-mergeable; pure additive)
3. Phase 3 — string extraction (can fan out per-component-namespace via subagents)
4. Phase 4 — LLM-batch translate
5. Phase 5 — confirm URL builders (no-op)
6. Phase 6 — hreflang + sitemap (parallel with /watch Phase 5)
7. Phase 7 — probe harness (parallel with /watch Phase 6)

## Alternative Approaches Considered

### A: `next-i18next` (matches JesusFilm/core)

Same library as core's `apps/watch`. Rejected:

- Pages Router-first; App Router support is a community shim.
- Doesn't compose with Next 16's RSC + streaming.
- Setup overhead higher (config split between `next-i18next.config.js`, `_app.tsx` wrapping, `getStaticProps` data fetching).

### B: `react-i18next` directly (no Next bridge)

Reject: re-implements Next-specific concerns (route locale, SSR, ISR cache key) that next-intl provides out of the box.

### C: Hand-roll on top of existing `lib/locale.ts`

The current locale plumbing (`forge_watch_lang` cookie, `_lr=1` sentinel, `resolveUiLocale`) is solid for AUDIO routing. Extending it to do UI string translation means re-implementing message loading, ICU formatting, namespacing, locale negotiation — all of which next-intl ships as one library.

Reject: rebuild-from-scratch tax.

### D: `[locale]` URL subpath with `localePrefix: 'as-needed'` (REJECTED 2026-05-28)

Earlier draft of this plan added `app/[locale]/*` subpath segment + `NEXT_LOCALE` cookie + middleware composition. **Rejected:** changes the URL contract that production already serves and that this entire /watch URL restructure is preserving. The user-facing rule is "URL is the deep-link, no hidden state" — adding a subpath that's sometimes-present is contradictory.

### E (chosen): `next-intl` reading locale from existing URL extraction

This document. URL contract unchanged. `setRequestLocale()` called by the existing Phase 2 catch-all from `resolveUiLocale(audioSlug)`. next-intl just provides the translation runtime.

### F: Dynamic locale list from admin GraphQL at runtime

Considered: query admin's `Language` table at request time to populate the locale list dynamically. Rejected:

- Adds runtime DB hit.
- Filesystem discovery achieves the same "drop a JSON, locale becomes available" UX with zero runtime cost.
- Day-1 catalog list is small (5) and grows in human-scale steps — filesystem is the right tool.

## System-Wide Impact

### Interaction Graph

```
Request → Cloudflare → Railway → Next.js
   │
   ▼
proxy.ts (UNCHANGED at i18n layer)
   ├─ canonicalize watch URL (Phase 3 of /watch restructure)
   ├─ existing forge_watch_lang cookie-driven audio redirect
   ├─ existing Accept-Language fallback for /watch root
   └─ next()
        │
        ▼
Next.js routing → app/[slug]/[...rest]/page.tsx (Phase 2 catch-all, UNCHANGED file location)
   │
   ▼
page.tsx server handler
   ├─ classify(rawSlug, rest) → { rawLocale, locale }
   │  └─ locale = resolveUiLocale(rawLocale) ?? 'en'   (Phase 2)
   ├─ setRequestLocale(hasUiLocale(locale) ? locale : 'en')   ← NEW
   ├─ getTranslations('Namespace')                            ← NEW
   ├─ existing data fetching (admin GraphQL)
   └─ renders WatchPageClient with locale prop unchanged
        │
        ▼
app/layout.tsx (root, UNCHANGED location)
   ├─ getLocale() → reads value set by setRequestLocale
   ├─ <html lang={locale}>                              ← NEW (was hardcoded "en")
   ├─ NextIntlClientProvider                            ← NEW (wraps existing children)
   └─ existing layout content (fonts, FloatingSearchProvider, etc.)
        │
        ▼
Client component
   ├─ useTranslations('Namespace')                      ← NEW (reads from provider)
   ├─ existing useLocale() / locale prop unchanged
   └─ existing audio language picker (separate concern)
        │
        ▼
generateMetadata
   ├─ getOgLocale(locale)                              ← extended for AVAILABLE_UI_LOCALES
   ├─ alternates.languages map per-dub-of-this-video    ← NEW
   └─ <link rel="canonical"> + hreflang                ← NEW
```

### Error & Failure Propagation

- **Missing message key**: next-intl emits a warning + falls back to the namespace.key path (or to `defaultLocale` message). Configure `onMissingKey` for telemetry.
- **Malformed message catalog**: build-time JSON parse failure → `next build` fails. Caught in CI.
- **Locale segment in URL doesn't match `routing.locales`**: `hasLocale` check in layout → `notFound()` → 404. Test fixture.
- **Cookie tampering**: `NEXT_LOCALE=evil`-shaped value never reaches `hasLocale` (next-intl validates), so falls back to `defaultLocale`. No injection surface.
- **ICU format mismatch**: build-time precompile catches it.

### State Lifecycle Risks

- **Cookie conflict during transition**: `forge_watch_lang` cookie value might equal a UI-locale-eligible value (e.g. user sets `forge_watch_lang=es`). Without explicit separation, the UI middleware might consume it. Mitigation: `NEXT_LOCALE` and `forge_watch_lang` are distinct cookie names; next-intl reads only `NEXT_LOCALE`.
- **Stale ISR cache after locale message update**: changing `messages/es.json` invalidates the build, not ISR per-page cache. `revalidatePath('/(es)', 'layout')` from `/api/revalidate` clears it.
- **Locale split brain across replicas**: filesystem discovery happens at build time; all replicas in a deploy share the same `routing.locales`. No multi-replica drift.

### API Surface Parity

- **apps/admin** doesn't need changes. Admin GraphQL stays English-only at the schema level (field descriptions). User-facing content from admin (Experience titles, Video titles) localizes via per-locale rows in `ExperienceLocale` / `VideoLocale` — already wired.
- **apps/mobile + apps/tv** would need their own i18n migration (separate plan; not part of this one).

### Integration Test Scenarios

Cannot be caught by unit tests; need Playwright integration:

1. **Default English at `/watch/jesus.html/english.html`**: page renders, `<html lang="en">`, hreflang lists all available dubs.
2. **Spanish UI at `/watch/jesus.html/spanish-castilian.html`**: page renders, `<html lang="es">`, "Compartir video" instead of "Share video" — UI translated automatically by URL extraction.
3. **Spanish LatAm UI at `/watch/jesus.html/spanish-latin-american.html`**: page renders, `<html lang="es">`, same Spanish UI catalog (family fallback collapses both Spanish variants to `es`).
4. **Unsupported UI falls to English at `/watch/jesus.html/mandarin-china.html`**: page renders, `<html lang="en">`, English UI; Mandarin audio still loads.
5. **`/watch` root with no audio slug**: `<html lang="en">`, English UI.
6. **3-seg episode at `/watch/lumo.html/wedding-in-cana/spanish-castilian.html`**: Spanish UI, episode resolves correctly.
7. **hreflang alternates emit per video**: `/watch/jesus.html/english.html` carries `<link rel="alternate" hreflang="es" href="/watch/jesus.html/spanish-castilian.html">` etc.
8. **`/api/revalidate` fans out across `AVAILABLE_UI_LOCALES` × dubs**: webhook receives `{slug, locale}`, revalidates all dub URLs of that slug.

## Acceptance Criteria

### Functional Requirements

- [ ] `next-intl@^4.0.0` installed; `next.config.mjs` wired with `createNextIntlPlugin`.
- [ ] `messages/{en,es,fr,pt,de}.json` exist and pass structural-parity CI test.
- [ ] URL contract UNCHANGED — `git diff` shows no `app/[locale]/*` segment added.
- [ ] `app/layout.tsx` reads dynamic locale via `getLocale()` + provides `NextIntlClientProvider`.
- [ ] `app/[slug]/[...rest]/page.tsx` + other page routes call `setRequestLocale()` early in the handler.
- [ ] `proxy.ts` UNCHANGED for i18n purposes (no `createMiddleware(routing)` composition).
- [ ] Every user-facing string in `src/components/**` flows through `t()`.
- [ ] `lib/locale.ts` static `SUPPORTED_LOCALES` retired in favor of `AVAILABLE_UI_LOCALES` from `@/i18n/locales`.
- [ ] `/api/revalidate` route loops over `AVAILABLE_UI_LOCALES`, not `SUPPORTED_LOCALES`.
- [ ] `experience-metadata.ts` emits `alternates.languages` mapping per available dub of the video.
- [ ] `next/link` imports remain (no `@/i18n/navigation` migration — URL contract is locale-stable).

### Non-Functional Requirements

- [ ] Build time increases <30% (per-locale message dynamic-import keeps catalogs out of the build graph except for active locale).
- [ ] Per-locale message bundle <50KB gzipped (current English catalog target).
- [ ] ISR cache hit rate maintained at parity (locale becomes part of cache key but routing.locales is bounded).
- [ ] First Contentful Paint <100ms regression vs pre-i18n baseline (next-intl ICU is precompiled, not parsed at runtime).

### Quality Gates

- [ ] Vitest: every component test that asserts user-visible text uses `t()` lookup (not inline literal).
- [ ] Playwright: audio-language URL × UI locale matrix green per §"Integration Test Scenarios".
- [ ] CI grep gates:
  - `rg 'aria-label="[A-Z]' apps/web/src/components` → empty (all matches must be technical IDs not user-facing copy).
  - `rg "SUPPORTED_LOCALES" apps/web/src` → empty after retirement.
- [ ] Message-catalog structural parity test: every key in `en.json` exists in every other locale.
- [ ] `SUPPORTED_LOCALES` constant removed; only `AVAILABLE_UI_LOCALES` remains.
- [ ] Tier-2 `/ce-code-review` mandatory before merge.

## Success Metrics

- **Coverage**: % of user-facing UI strings flowing through `t()`. Target: 100% of `src/components/**` + `src/app/**` page-level copy.
- **Bundle delta**: per-locale catalog size + total app bundle delta vs baseline.
- **Translation pipeline**: time-to-add a new locale = drop file + redeploy.
- **User-visible**: Spanish-speaking ministry leaders on `/watch/es/...` see Spanish chrome. Tested with translation reviewers from each locale.
- **SEO**: Search Console impressions per locale within 14 days of cutover (no >5% drop).

## Dependencies & Prerequisites

- **HARD BLOCKER**: /watch URL restructure Phase 3 (proxy normalization) must ship BEFORE this plan's Phase 2 (middleware composition).
- **SOFT BLOCKER**: /watch Phase 5 (SEO + hreflang) and this plan's Phase 6 deliver overlapping work; coordinate to land together.
- **Translation source**: confirm LLM-batch vs Crowdin for ongoing maintenance.
- **Native speaker QA**: identify reviewers for Spanish, French, Portuguese, German. JFP ministry network should have access.

## Risk Analysis & Mitigation

| Risk                                                                                               | Likelihood | Impact | Mitigation                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| String extraction misses an aria-label or alt text                                                 | M          | M      | CI grep gate; manual review per file in Phase 3                                                                                                                          |
| LLM-translated messages are awkward / wrong                                                        | H          | M      | Native-speaker QA gate before each locale's day-one ship                                                                                                                 |
| Translation drift from `messages/en.json` source                                                   | M          | L      | Structural-parity CI test                                                                                                                                                |
| ISR cache key explosion across slug × dub                                                          | L          | M      | Already bounded by today's URL contract — no new dimension added by this plan                                                                                            |
| `setRequestLocale` forgotten in a route handler → falls back to default                            | M          | M      | CI grep gate: every page server component must call `setRequestLocale` before any `getTranslations`                                                                      |
| `<html lang>` renders wrong locale on race between layout + page                                   | L          | M      | next-intl docs: layout reads via `getLocale()` AFTER page calls `setRequestLocale` (in the rendering pipeline, layout resolves after page handler). Test via Playwright. |
| Bundle size from message catalogs                                                                  | L          | M      | Per-locale dynamic-import; precompiled ICU AST is small                                                                                                                  |
| SEO drop from hreflang change                                                                      | M          | H      | Phase 6 ships hreflang + canonical alternates in same commit; validate via Search Console URL Inspection API                                                             |
| `messages/{xx}.json` is dropped without translation pipeline → partial English fallback at runtime | L          | L      | Per-key fallback to `en.json` is next-intl default; structural-parity CI test prevents merge                                                                             |
| Static rendering breaks on `setRequestLocale` placement                                            | L          | H      | Place `setRequestLocale` at TOP of every page route handler before any data fetch (next-intl requirement for SSG)                                                        |

## Resource Requirements

- **People**: 1 engineer for Phases 1-5 (~3-4 weeks of focused work). Translation review: 1 native speaker per locale × 1-2 hour reviews × N locales.
- **Timeline**: 5-6 weeks engineering + 1-2 weeks SEO observation post-cutover. Gated on /watch Phase 3 merge.
- **Infrastructure**: zero new services. Crowdin subscription if adopted.

## Future Considerations

- **Crowdin / Phrase / Lokalise integration**: post-cutover; replaces LLM-batch for ongoing maintenance.
- **RTL languages**: Arabic, Hebrew, Urdu, etc. require `dir="rtl"` on `<html>` per locale. Add a `RTL_LOCALES` set to `routing.ts` and conditional rendering in layout.
- **Pluralization**: ICU handles plurals; expand to use `t('clipNofM', {n})` instead of string templates.
- **Date/number formatting**: replace `Intl.DateTimeFormat` direct calls (currently only `EasterDates.tsx`) with `useFormatter()` from next-intl for locale-aware formatting.
- **Apps/mobile + apps/tv i18n**: separate plans; can mirror this architecture via React Native equivalents.
- **Translation crowd-sourcing**: contribution guide in `messages/README.md` + a `/contribute/translations/{locale}` route for community submission.

## Documentation Plan

- Update [apps/web/CLAUDE.md](apps/web/CLAUDE.md) with:
  - i18n architecture (next-intl + locale subpath + cookie split)
  - How to add a new UI locale (drop a `messages/{locale}.json` + native QA + redeploy)
  - Common pitfalls (no `next/link` direct import; use `@/i18n/navigation` Link)
- Add `apps/web/messages/README.md` — translation contributor guide.
- Update root [CLAUDE.md](CLAUDE.md) "Known Patterns":
  - "Audio language vs UI chrome language — two cookies, two concerns" with `forge_watch_lang` vs `NEXT_LOCALE` split.
- Create `docs/solutions/architecture-patterns/next-intl-on-app-router-pattern-2026-MM-DD.md` post-cutover with what worked + drift risks.

## Sources & References

### Research artifacts (this plan)

- next-intl Next 16 deep-dive: confirmed `localePrefix: 'as-needed'` + composable middleware; runtime locales via `createNavigation` escape hatch but standard pattern is filesystem-discovered build-time list.
- JesusFilm/core comparison: uses `next-i18next` on Pages Router (25 UI locales in `libs/locales/{lang}/{ns}.json`); not directly portable to Next 16 App Router but structural patterns mirror.
- Repo audit: ~100 hardcoded strings concentrated in ~30 components; `<html lang="en">` hardcoded; hreflang not emitted; 3 sites consume `SUPPORTED_LOCALES`.
- Prior learnings:
  - [docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md](docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md) — `pickLocalizedName` with deterministic fallback order applies to translation key resolution.
  - [docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md](docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md) — passes `rawLocale` to user-facing components; informed the cookie split.
  - [docs/solutions/web/nextjs-headers-defeats-route-cache.md](docs/solutions/web/nextjs-headers-defeats-route-cache.md) — Accept-Language detection must stay in middleware/proxy, never in page components.
  - [docs/solutions/web/nextjs16-cachecomponents-isr.md](docs/solutions/web/nextjs16-cachecomponents-isr.md) — locale is a first-class route segment; cache-key explosion bounded.
  - [docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md](docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) — locale subpath addition is a fan-out refactor; coordinate with /watch Phase 5 hreflang.
  - [docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md](docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md) — `routing.locales` is the data-derived source of truth, not a hardcoded constant.

### Internal references

- [apps/web/src/lib/locale.ts](apps/web/src/lib/locale.ts) — existing locale plumbing; `SUPPORTED_LOCALES`, `resolveUiLocale`, `slugToBcp47Primary`.
- [apps/web/src/lib/language-bcp47-map.ts](apps/web/src/lib/language-bcp47-map.ts) — 2263 admin slug → bcp47 mappings (recently added for Phase 2 family fallback).
- [apps/web/src/proxy.ts](apps/web/src/proxy.ts) — current middleware; composition target.
- [apps/web/src/app/[slug]/[...rest]/page.tsx](apps/web/src/app/[slug]/[...rest]/page.tsx) — Phase 2 catch-all; preserved end-to-end.
- [apps/web/src/lib/experience-metadata.ts](apps/web/src/lib/experience-metadata.ts) — OG/canonical metadata; hreflang target.
- [docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md](docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md) — parallel /watch URL plan; Phase 3 coordination point.

### External references

- [next-intl docs](https://next-intl.dev/docs/getting-started/app-router)
- [next-intl + Next 16 boilerplate](https://github.com/amuradesign/next.js-16-next-intl-boilerplate)
- [Crowdin + next-intl integration](https://next-intl.dev/docs/workflows/localization-management)
- [JesusFilm/core apps/watch i18n](https://github.com/JesusFilm/core/tree/main/apps/watch) — comparable monorepo's Pages Router setup
- [BCP 47 RFC 5646](https://www.rfc-editor.org/rfc/rfc5646) — locale tag standard.

### Related work

- /watch URL restructure plan: [docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md](docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md)
- Phase 1 foundation modules: [forge#1049](https://github.com/JesusFilm/forge/pull/1049) (merged)
- Phase 2 catch-all + family fallback: [forge#1051](https://github.com/JesusFilm/forge/pull/1051) (in flight)
