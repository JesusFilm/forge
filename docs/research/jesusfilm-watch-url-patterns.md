# jesusfilm.org/watch — URL Pattern Inventory & Migration Test Plan

Last verified live: 2026-05-27 against production `https://www.jesusfilm.org/watch/`.

This document catalogs every URL shape served under `/watch/` on the current production site (Strapi-era stack, served via Vercel `x-powered-by: Next.js`, fronted by Cloudflare) so that the apps/web rewrite can ship without breaking inbound links, share links, search-engine results, social embeds, or printed materials.

> Production currently routes internally as `/{locale}/watch/...` (visible in the `x-matched-path` response header), but the public-facing URL space is `/watch/...`. That public-facing space is what this document inventories and what the rewrite must preserve.

---

## TL;DR — Public URL Shapes That Must Resolve Post-Migration

| Public URL pattern                                         | Example                                                                                                                                 | Notes                                                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/watch`                                                   | `/watch`                                                                                                                                | Default English home. 308 from `/watch/`.                                                                                                     |
| `/watch/{language}.html`                                   | `/watch/russian.html`, `/watch/english.html`                                                                                            | Localized watch home. Language is a full slug (kebab-case English name), never a bcp47 code.                                                  |
| `/watch/{slug}.html`                                       | `/watch/easter.html`                                                                                                                    | One-segment collection landing for _some_ slugs (collections/Experiences with no language requirement). Single-video slugs 404 on this shape. |
| `/watch/{slug}.html/{language}.html`                       | `/watch/jesus.html/english.html`, `/watch/women-resources.html/russian.html`                                                            | **Canonical watch URL.** Works for single videos, series (with playable trailer), and curated collections.                                    |
| `/watch/{series-slug}.html/{episode-slug}/{language}.html` | `/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html`, `/watch/jesus.html/the-beginning/spanish-castilian.html`            | Series episode landing. Note: only the first segment carries `.html`; episode slug is bare.                                                   |
| `/watch/videos`                                            | `/watch/videos`                                                                                                                         | All-videos index. No `.html` suffix.                                                                                                          |
| `/watch/search` (deprecated)                               | Historical production: `/watch/search` → `/watch/search.html/search.html`; rewrite target: `/watch/search` → `/watch` or `/watch?q=...` | Search is now the global modal on every page. Do not preserve or emit the synthetic `.html` search page.                                      |
| `/watch/assets/...`                                        | `/watch/assets/favicon-180.png`, `/watch/assets/footer/facebook.svg`                                                                    | Static assets served from the watch sub-app.                                                                                                  |
| `/watch/_next/...`                                         | `/watch/_next/static/...`                                                                                                               | Next.js framework assets.                                                                                                                     |
| `/watch/api/...`                                           | `/watch/api/preview`, `/watch/api/revalidate`, `/watch/api/download`                                                                    | Server API routes.                                                                                                                            |

---

## 1. Canonical Patterns (Live, Verified)

### 1.1 Watch Home (Root)

- `GET /watch` → 200, English home
- `GET /watch/` → 308 → `/watch` (trailing-slash strip)

The home page links out to top collections in the user's language. Sample link shape from the rendered home: `/watch/jesus.html/english.html` (always two-segment with both `.html` suffixes).

### 1.2 Localized Watch Home

`/watch/{language}.html`

- `GET /watch/russian.html` → 200
- `GET /watch/english.html` → 200
- `GET /watch/portuguese-brazil.html` → 200

The language token is the **English-name slug** in kebab-case (e.g. `russian`, `portuguese-brazil`, `mandarin-china`, `arabic-modern-standard`, `spanish-castilian`), NOT a bcp47 code:

- `GET /watch/en.html` → 404
- `GET /watch/pt-br.html` → 404
- `GET /watch/ru.html` → 404

Internally the server maps these into a Next.js path like `/ru/watch/russian.html` (visible in `x-matched-path`).

### 1.3 Canonical Two-Segment Watch URL

`/watch/{content-slug}.html/{language-slug}.html`

This is the dominant pattern. It covers three distinct kinds of content that share the same URL shape:

1. **Single videos** — e.g. `/watch/jesus.html/english.html`
2. **Series with a playable trailer** — e.g. `/watch/lumo-the-gospel-of-john.html/english.html` (shows trailer + episode list)
3. **Curated Experiences / collections** — e.g. `/watch/women-resources.html/english.html`, `/watch/easter.html/english.html`

The server internally maps to `/{locale}/watch/[part1]/[part2]` (visible in `x-matched-path`), then disambiguates server-side by looking up the slug.

### 1.4 One-Segment Collection Landing (Partial)

Some collection slugs resolve as one-segment URLs (server falls back to a default language):

- `GET /watch/easter.html` → 200
- `GET /watch/women-resources.html` → 404 (this one only works two-segment)
- `GET /watch/discipleship.html` → 404
- `GET /watch/conversation-starters.html` → 404
- `GET /watch/jesus.html` → 404 (single-video slugs always 404 here)

There is no clean rule for which collections expose the one-segment shape — it appears to depend on whether the CMS has the entry flagged as "language-fallback OK". Treat any one-segment public link as best-effort; the canonical link is always two-segment.

### 1.5 Series Episodes (Three-Segment)

`/watch/{series-slug}.html/{episode-slug}/{language-slug}.html`

Verified:

- `GET /watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html` → 200
- `GET /watch/jesus.html/the-beginning/english.html` → 200
- `GET /watch/jesus.html/the-beginning/spanish-castilian.html` → 200

**Note the shape carefully**: only the first segment has `.html`. The episode segment is bare, and the language segment has `.html`. The "natural-looking" alternative shapes 307-redirect into this canonical:

- `/watch/lumo-the-gospel-of-john/wedding-in-cana.html/english.html` → 307 → `/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html`
- `/watch/lumo-the-gospel-of-john/jesus-walks-on-water.html/english.html` → 307 → `/watch/lumo-the-gospel-of-john.html/jesus-walks-on-water/english.html` (then 404 because the episode doesn't exist in Lumo John, but the redirect rule still fires)

### 1.6 Listing & Search

- `GET /watch/videos` → 200 (full video index, no `.html`)
- Historical production: `GET /watch/search` → 307 → `/watch/search.html/search.html` → 200. New rewrite behavior should redirect `/watch/search` to the modal-capable watch root (preserving `?q=`) and must not preserve the synthetic `search.html/search.html` page.

---

## 2. Server Normalization Rules (Redirects)

The current production server applies the following normalizations. The rewrite must apply at least the same set to avoid breaking inbound links.

| Input                                      | Status | Output                                                              |
| ------------------------------------------ | ------ | ------------------------------------------------------------------- |
| `/watch/`                                  | 308    | `/watch`                                                            |
| `/watch/jesus.html/`                       | 308    | `/watch/jesus.html`                                                 |
| `/watch/jesus.html/english.html/`          | 308    | `/watch/jesus.html/english.html`                                    |
| `/watch/jesus.HTML/english.html`           | 307    | `/watch/jesus.html/english.html` (lowercase `.html`)                |
| `/watch/jesus.html/english`                | 307    | `/watch/jesus.html/english.html` (append missing `.html`)           |
| `/watch/foo` (single-segment, no `.html`)  | 307    | `/watch/foo.html/foo.html` (duplicate-segment-and-add-`.html` rule) |
| `/watch/foo/bar` (two-segment, no `.html`) | 307    | `/watch/foo.html/bar.html` (per-segment `.html` append)             |
| `/watch/jesus.html/chinese-mandarin.html`  | 307    | `/watch/jesus.html/mandarin-china.html` (language-slug alias)       |

The single→duplicate rewrite (`/watch/foo` → `/watch/foo.html/foo.html`) is aggressive: it applies even to non-content URLs like `/watch/sitemap.xml`, `/watch/feed`, `/watch/about`, `/watch/api/preview`. Make sure the rewrite project ships its `_next`, `api`, `assets`, and any other reserved subtrees BEFORE catching the wildcard rule, otherwise framework asset URLs will break.

### 2.1 Language-Slug Aliases (Observed)

These slugs 307-redirect to canonical forms:

| Alias              | Canonical        |
| ------------------ | ---------------- |
| `chinese-mandarin` | `mandarin-china` |

The migration project must either preserve the canonical slugs OR ship explicit redirects for every alias the old site honored. We do not have a complete alias list — many will only surface from access logs or from the Arclight language metadata.

### 2.2 Language Slugs With Sub-Variants

Several languages exist as multiple regional slugs, each a valid URL:

- `portuguese-brazil`, `portuguese-portugal`
- `spanish-castilian`, `spanish-latin-american`
- `arabic-modern-standard`
- `mandarin-china`, `cantonese`
- `tagalog` (no `filipino` shape)

Slugs that look obvious but 404 on production (do NOT assume they work):

- `german` (404 on `/watch/jesus.html/german.html`)
- `farsi`, `persian`, `persian-iranian` (all 404)
- `bengali`, `bangla` (both 404)
- `indonesian`, `indonesia` (both 404)
- `pashto`, `pushto`, `pashto-afghan` (all 404)
- `tigrinya`, `mongolian`, `tibetan`, `filipino` (all 404)
- `chinese`, `chinese-simplified`, `chinese-traditional` (all 404)

The canonical list comes from the Arclight language API. The rewrite must consume the same source so that the resolved slug set is identical, or it must accept the legacy slug set as input and resolve to whatever the new system calls them via a redirect table.

### 2.3 Query Parameters That Carry Meaning

- `?t=<seconds>` — seek timestamp on the player. One-shot signal: must NOT replay across language-preference redirects. Apps/web's proxy explicitly strips this on the cookie-preference redirect (see `apps/web/src/proxy.ts` `ONE_SHOT_QUERY_PARAMS`).
- `?autoplay=1` — gesture-came-from-Apply marker. Same one-shot semantics — strip on cross-locale redirect.
- `?_lr=1` — internal sentinel set by the page when the requested locale has no matching variant and the resolver falls back. The proxy treats `?_lr=1` as "do not re-apply the language-preference cookie redirect." The client strips this from the URL post-hydration. (See `apps/web/src/lib/locale.ts::LOCALE_RESOLVED_PARAM`.)
- `?lang=` — accepted on the home; not part of routing logic.
- `?utm_*` and other tracking params — pass through unchanged.

### 2.4 Cookie-Driven Language Preference

`apps/web` reads a `LANGUAGE_PREFERENCE_COOKIE` (declared in `apps/web/src/lib/language-preference-constants.ts`) and 307-redirects two-segment watch URLs from the requested language to the cookie language, **unless** the URL carries `?_lr=1`. This means the same canonical URL can land on different language pages depending on the user's cookie state. SEO-canonical URLs should explicitly include the language segment.

---

## 3. Case Sensitivity, Encoding, and Edge Cases

- **Case-sensitive on the content slug**: `/watch/JESUS.html/english.html` → 404. Capitalized slugs do NOT redirect to lowercase.
- **Case-insensitive on `.html`**: `/watch/jesus.HTML/english.html` → 307 → lowercase.
- **Non-ASCII in slug**: `/watch/jesus.html/français.html` → 404. The slug system uses ASCII-only kebab-case.
- **Fragment identifiers**: `/watch/jesus.html/english.html#hero` → 200. Hashes are client-side only and unaffected by routing.
- **Trailing slash**: always stripped (308).
- **Empty `.html`**: `/watch/.html` → 404.

---

## 4. Things The Migration Should NOT Try to Preserve

These shapes exist as 307-targets of the normalization rules but should not be linked externally:

- `/watch/{slug}/` (missing `.html`) — only exists as a redirect input.
- `/watch/{slug}/{lang}` (both missing `.html`) — same.
- `/watch/search.html/search.html` — historical synthetic search page. New code should 404 this shape; external links should not target search routes because search lives in the global modal.
- `/watch/{slug}/{episode}.html/{lang}.html` (legacy episode shape) — 307s into the three-segment canonical. New code should emit the canonical form.

---

## 5. Migration Test Checklist (Concrete URL List)

Run an automated probe against the rewrite, comparing HTTP status against production. The lists below are the **minimum** set — every regression bucket the production site exposes should have ≥1 representative URL here.

### 5.1 Roots & Indexes

```
/watch
/watch/
/watch/videos
/watch/search   # deprecated redirect to /watch (or /watch?q=...), not a page
/watch/english.html
/watch/russian.html
/watch/portuguese-brazil.html
/watch/portuguese-portugal.html
/watch/spanish-castilian.html
/watch/spanish-latin-american.html
/watch/mandarin-china.html
/watch/arabic-modern-standard.html
/watch/french.html
/watch/german.html
/watch/japanese.html
/watch/korean.html
/watch/hindi.html
/watch/tamil.html
/watch/turkish.html
/watch/swahili.html
```

### 5.2 Canonical Two-Segment Content URLs

Single-video flagship titles (every one of these has been historically marketed and printed on physical media — they MUST resolve):

```
/watch/jesus.html/english.html
/watch/jesus.html/spanish-castilian.html
/watch/jesus.html/spanish-latin-american.html
/watch/jesus.html/portuguese-brazil.html
/watch/jesus.html/portuguese-portugal.html
/watch/jesus.html/arabic-modern-standard.html
/watch/jesus.html/french.html
/watch/jesus.html/mandarin-china.html
/watch/jesus.html/cantonese.html
/watch/jesus.html/japanese.html
/watch/jesus.html/korean.html
/watch/jesus.html/hindi.html
/watch/jesus.html/tamil.html
/watch/jesus.html/zulu.html
/watch/jesus.html/swahili.html
/watch/magdalena-2.html/english.html
/watch/magdalena.html/russian.html
/watch/chosen-witness.html/english.html
/watch/fallingplates.html/english.html
/watch/the-savior.html/russian.html
/watch/birth-of-jesus.html/english.html
/watch/wedding-in-cana.html/english.html
/watch/jesus-calms-the-storm.html/english.html
/watch/paul-and-silas-in-prison.html/english.html
/watch/peter-miraculous-escape-from-prison.html/english.html
/watch/the-woman-with-the-issue-of-blood.html/english.html
/watch/day-6-jesus-died-for-me.html/english.html
/watch/8-days-with-jesus-who-is-jesus.html/english.html
/watch/storyclubs-jesus-and-zacchaeus.html/english.html
```

Series landings (with playable trailer):

```
/watch/lumo-the-gospel-of-john.html/english.html
/watch/lumo-the-gospel-of-luke.html/english.html
/watch/lumo-the-gospel-of-mark.html/english.html
/watch/lumo-the-gospel-of-matthew.html/english.html
/watch/lumo-the-gospel-of-john.html/russian.html
/watch/lumo-the-gospel-of-luke.html/russian.html
/watch/lumo-the-gospel-of-mark.html/russian.html
/watch/lumo-the-gospel-of-matthew.html/russian.html
/watch/life-of-jesus-gospel-of-john.html/english.html
/watch/life-of-jesus-gospel-of-john.html/russian.html
/watch/book-of-acts.html/english.html
/watch/book-of-acts.html/russian.html
/watch/reflections-of-hope.html/english.html
/watch/new-believer-course.html/english.html
/watch/pilgrims-progress.html/russian.html
```

Curated collections / Experiences:

```
/watch/women-resources.html/english.html
/watch/women-resources.html/russian.html
/watch/discipleship.html/english.html
/watch/discipleship.html/russian.html
/watch/conversation-starters.html/english.html
/watch/conversation-starters.html/russian.html
/watch/easter.html/english.html
/watch/easter.html/russian.html
/watch/evangelism.html/russian.html
/watch/family.html/russian.html
/watch/relationships.html/russian.html
/watch/love-your-neighbor.html/russian.html
/watch/student-resources.html/russian.html
/watch/storyclubs.html/russian.html
/watch/jfm-collection.html/russian.html
/watch/world-youth-day.html/russian.html
/watch/anticipate-the-resurrection.html/russian.html
```

### 5.3 Series Episodes (Three-Segment)

```
/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html
/watch/lumo-the-gospel-of-luke.html/birth-of-jesus/english.html
/watch/lumo-the-gospel-of-luke.html/birth-of-jesus/spanish-castilian.html
/watch/lumo-the-gospel-of-mark.html/jesus-baptism/english.html
/watch/jesus.html/the-beginning/english.html
/watch/jesus.html/the-beginning/spanish-castilian.html
/watch/jesus.html/the-beginning/russian.html
```

The rewrite must also accept and 307-redirect the legacy 4-segment shape:

```
/watch/lumo-the-gospel-of-john/wedding-in-cana.html/english.html
   → 307 → /watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html
/watch/jesus/the-beginning.html/english.html
   → 307 → /watch/jesus.html/the-beginning/english.html
```

### 5.4 Normalization Redirects (Must Continue To Redirect, Not 404)

```
/watch/                              → 308 → /watch
/watch/jesus.html/                   → 308 → /watch/jesus.html (then content-specific behavior)
/watch/jesus.html/english.html/      → 308 → /watch/jesus.html/english.html
/watch/jesus.HTML/english.html       → 307 → /watch/jesus.html/english.html
/watch/jesus.html/english            → 307 → /watch/jesus.html/english.html
/watch/jesus.html/chinese-mandarin.html → 307 → /watch/jesus.html/mandarin-china.html
```

### 5.5 Query Param Pass-Through (Must 200)

```
/watch/jesus.html/english.html?t=120
/watch/jesus.html/english.html?autoplay=1
/watch/jesus.html/english.html?utm_source=campaign&utm_medium=email
/watch/jesus.html/english.html#hero
```

### 5.6 Expected 404s (Must NOT Become 200 or 301)

```
/watch/jesus.html                       # single-video, missing locale
/watch/JESUS.html/english.html          # uppercase slug
/watch/jesus.html/français.html         # non-ASCII locale
/watch/.html                            # empty slug
/watch/jesus.html/en.html               # bcp47 locale (only English-name slugs accepted)
/watch/jesus.html/pt-br.html
/watch/easter.html/non-existent.html    # bad locale on existing collection
```

### 5.7 Asset & Framework Subtrees (Must Resolve Normally — NO Wildcard Catch)

```
/watch/assets/favicon-180.png
/watch/assets/favicon-32.png
/watch/assets/footer/facebook.svg
/watch/_next/static/...   (any framework chunk URL emitted by Next.js)
/watch/api/preview
/watch/api/revalidate
/watch/api/download/...
```

The single-segment-rewrite rule (`/watch/foo` → `/watch/foo.html/foo.html`) is broad enough that **the wildcard must be ordered LAST**. The new project must explicitly exclude `assets`, `_next`, `api`, and any other reserved subtrees from the rewrite.

---

## 6. Recommended Test Harness

Drive a script that:

1. Loads the URL lists from §5 (split by expected outcome: 200, 307/308, 404).
2. Hits the live production site, captures `(status, final-url-after-redirects)`.
3. Hits the rewrite preview, captures the same tuple.
4. Diffs the two against the desired cutover contract, not only the legacy production behavior. Distinguish:
   - **Hard regression**: production 200 → rewrite 4xx (broken link, user-visible).
   - **Soft regression**: production 200 → rewrite 200 but different final URL after redirect (SEO drift; canonical may change).
   - **Acceptable**: production 307 → rewrite 200 direct (the rewrite skips a redundant redirect — usually fine, but check that any one-shot query params are handled).
   - **Intentional cutover divergence**: `/watch/search` may redirect or resolve to `/watch` because search is modal-only now, and passthrough subtrees are judged by whether the preview preserves the requested asset/API path even if legacy production redirects them to fake `.html` paths.
   - **Redirect loop**: preview responses that still return a 3xx after the maximum redirect-hop budget are hard regressions, even when production also redirects.

The harness lives at `apps/web/scripts/probe-watch-urls.ts`, with fixtures and classification in `apps/web/src/lib/watch-url-probe.ts`. Keep those fixtures in lockstep with §5, and record any remaining hard failures as either route bugs or data/admin snapshot mismatches rather than folding them into generic routing regressions.

---

## 7. Open Questions / Unknowns

These warrant follow-up before launch:

1. **Complete language-slug list.** We only probed ~50 slugs. The full canonical list comes from Arclight. Confirm we have parity by comparing the new system's `Language.slug` field set against production's working slug set (200-bucket from a brute-force probe).
2. **Language-slug aliases beyond `chinese-mandarin` → `mandarin-china`.** Production likely has more. Pull `chrome-devtools` or production access logs to find any redirect with status 307 from a slug-form URL — those are alias hits.
3. **One-segment collection slugs.** We confirmed `easter.html` works one-segment, `women-resources.html` does not. The rule for which slugs expose the one-segment shape is unclear. Either preserve every one-segment URL that production currently 200s for, or accept that some short-link shapes will 404 after migration (and audit any printed material / partner integrations for those shapes first).
4. **The `?lang=` query param.** Verified that it returns 200 on `/watch?lang=en`, but unclear whether it carries semantic meaning (changes rendered language) or is just ignored. Tests should assert behavior parity, not just status.
5. **Trailing `/watch/api/preview` and other Strapi-era surfaces.** apps/web's CLAUDE.md notes that `STRAPI_PREVIEW_SECRET` is still required for the `/api/preview` route. Confirm whether the production site still serves any `/watch/api/preview/...` shapes externally — they may show up in editor-share links.

---

## 8. Provenance

- All URLs probed via `curl -A "Mozilla/5.0"` against `https://www.jesusfilm.org/...` on 2026-05-27.
- The production `x-matched-path` response header reveals the internal Next.js route shape (e.g. `/en/watch/[part1]/[part2]`), confirming the routing model.
- Source-of-truth for the **new** routing lives in [apps/web/src/app/[slug]/page.tsx](apps/web/src/app/[slug]/page.tsx), [apps/web/src/app/[slug]/[locale]/page.tsx](apps/web/src/app/[slug]/[locale]/page.tsx), [apps/web/src/proxy.ts](apps/web/src/proxy.ts), and [apps/web/src/lib/locale.ts](apps/web/src/lib/locale.ts).
- The current apps/web supports `/watch/{slug}` and `/watch/{slug}/{locale}` — it does **not** ship `.html`-suffix support, language-slug aliasing, or the legacy 4-segment episode redirect. Closing those three gaps is the migration's URL-compat scope.
