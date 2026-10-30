# Watch website audit, round 01: templates and page-load baseline

Date: 2026-10-20 (UTC). Scope: the public Watch site (`apps/web`), audited
read-only against production `https://www.jesusfilm.org/watch` and a local
`next build` + `next start` of the same commit. This round covered the
template inventory, a performance baseline, and one measured repair
(feat-779). Later rounds cover personas, accessibility, design and mobile.

Roadmap ID note (2026-10-21): this repair was first filed as `feat-755`. `main`
later assigned `feat-755` to a TV ticket, so this ticket is now `feat-779`.

The root marketing site (`https://www.jesusfilm.org/` outside `/watch`) is not
built from this repository and was not audited.

## October 29, 2026 update

This is a dated audit, not current production or merge qualification. Main
retired the client recommendation controls in PR #2957, removing the original
feat-779 import edge and feat-758 retry loop. PR #2821 now retains only the
crypto regression guard and these historical records; it does not restore
those controls. feat-758 is cancelled under the owner's retirement decision.
The 404 repair is being qualified separately in PR #2848 / feat-790.

## Template inventory

Every route below returned HTTP 200 on 2026-10-20 and was captured at
1280x800 (desktop). Rows marked "M" were also captured at 390x844 (mobile).

| Template                  | Representative URL                                    | Code owner                                          | M   |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------- | --- |
| Home (English)            | `/watch`                                              | `[locale]/[htmlLang]/page.tsx`, `components/home/*` | yes |
| Language home             | `/watch/spanish-latin-american.html`                  | `[...rest]/page.tsx`                                |     |
| Feature film              | `/watch/jesus.html`                                   | `[...rest]/page.tsx`, `components/watch/*`          | yes |
| Video in another language | `/watch/jesus.html/arabic-modern-standard.html` (RTL) | `[...rest]/page.tsx`                                | yes |
| Series / collection       | `/watch/lumo-the-gospel-of-john.html`                 | `SeriesPageClient`                                  | yes |
| Episode / segment         | `/watch/lumo-john-6-1-60.html`                        | `WatchPageClient`                                   |     |
| Topic experience          | `/watch/family.html`                                  | `ExperienceSectionRenderer`                         |     |
| Language inventory        | `/watch/english.html/videos`                          | `videos/[languageSlug]/page.tsx`                    | yes |
| Language directory        | `/watch/languages`                                    | `languages/page.tsx`                                | yes |
| Watch history (account)   | `/watch/history`                                      | `history/page.tsx`                                  |     |
| Product update            | `/watch/whats-new`                                    | `whats-new/page.tsx`                                |     |
| Not found                 | `/watch/no-such-page-r01.html`                        | `404/page.tsx`, `not-found.tsx`                     |     |
| Search modal (state)      | open from the header on `/watch`                      | `FloatingSearch*`, `lib/watch-search-client.ts`     | yes |

Loading (`loading.tsx`) and error (`error.tsx`) boundaries exist for the
locale tree and the catch-all, but were not forced in this round.

## Baseline (production, one desktop session, unthrottled)

Lab observations from one browser session, not field Core Web Vitals.

| Page                | TTFB   | FCP    | LCP                   | CLS   | JS scripts    | HTML (decoded) |
| ------------------- | ------ | ------ | --------------------- | ----- | ------------- | -------------- |
| `/watch` (cold)     | 254 ms | 808 ms | 1,164 ms (hero image) | 0.024 | 31, 845 KB br | 886 KB         |
| `/watch/jesus.html` | 432 ms | 596 ms | 9,436 ms (`VIDEO`)    | 0.028 | 39            | 910 KB         |

The late `VIDEO` LCP candidate on the film page is the poster-mount behaviour
already characterised in feat-515; it is not a blank page.

## Findings, ranked

1. **Node crypto polyfill on every Watch route (fixed, feat-779).** A
   461,268-byte chunk (`crypto-browserify`, `stream`, `buffer`, `pbkdf2`,
   `secp256k1`; 91 KB brotli locally, 135 KB as served) loaded on home, film,
   series, inventory, languages, history, what's-new and 404. Cause: three
   client components imported event-name constants from
   `lib/recommendation-consent.ts`, which imports `node:crypto`.
2. **Home hero "Watch Now" re-prefetches about once per second while the
   preview plays.** Production showed 17 `?t=N&autoplay=1&_rsc=` requests in
   18 seconds on desktop. Already tracked by FGE-139 and open PR #2383; not
   duplicated here.
3. **Signed-out `/watch/history` lands on the not-found page.** The page
   redirects to `watchPath("/api/auth/login")`, and Next's `redirect()` adds
   the `/watch` base path again, producing `/watch/watch/api/auth/login`.
   Tracked by feat-756.
4. **Unknown Watch URLs return HTTP 200** with the "Page not found" body
   (soft 404), although feat-250 required a final 404 status. Tracked by
   feat-757.
5. **Consent auto-grant retries when the profile reports a pending erasure.**
   For one browser profile whose server-side erasure stayed `pending`, each
   page view sent `status` + `grant` three times (the grant returns
   `erasureState: "pending"`, which the client treats as a failure, then
   retries at 500 ms and 1 s). A clean profile sends one pair. Tracked by
   feat-758.
6. **Large documents.** Home and film HTML decode to 886-910 KB (98 KB
   brotli), with about 72 `<img>` tags and 116-136 KB of `srcset` text on the
   home page. Not attributed to a regression; candidate for a later round.
7. **zod and markdown runtimes in initial client chunks.** A 285 KB-decoded
   zod chunk is reached from the floating search client and the surface
   manifest; a 113 KB micromark chunk ships on home. Needs attribution before
   any change.

## feat-779 measurement

Method: `next build` of the same commit before and after the change, served
by `next start` on loopback with `.env.ci` (no Admin data, so content routes
render their degraded state; the layout under test renders on every route).
Headless Chromium from the repo's Playwright, a fresh context per run, 390x844
mobile touch profile, 4x CPU throttle, 150 ms RTT and 1.6 Mbps download,
3 s settle after `load`, 7 runs per URL. Medians:

| URL                | Script KB (wire) | Script time (ms) | Task time (ms) | `load` (ms)   | FCP (ms)      |
| ------------------ | ---------------- | ---------------- | -------------- | ------------- | ------------- |
| `/watch`           | 884 → 748        | 3,314 → 2,686    | 4,092 → 3,362  | 6,108 → 5,444 | 1,532 → 1,524 |
| `/watch/whats-new` | 598 → 462        | 2,290 → 1,000    | 4,304 → 2,789  | 5,366 → 4,582 | 1,692 → 1,684 |
| 404 template       | 561 → 425        | 2,228 → 1,326    | 2,977 → 1,967  | 276 → 266     | 476 → 464     |

CLS was unchanged. LCP on `/watch/whats-new` is bimodal (about 2.6 s or
3.0-3.4 s per run, depending on which image wins); its mean moved from 2,969
to 2,805 ms. After the change, no file in `.next/static/chunks` contains
`pbkdf2`, `ripemd160` or `writableHighWaterMark`.

## Limits

- Local runs have no Admin data; route-specific rendering cost was measured
  only on production, and only as single-session observations.
- Production timings came from one desktop session in Halifax and include
  Cloudflare and Railway variance.
- No field data (RUM) was read in this round.
