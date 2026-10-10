# FGE-170 / W-082 — Restore the content BCP-47 tag instead of collapsing `<html lang>` to `en`

- **Scope:** `web`
- **Linear:** [FGE-170](https://linear.app/jesus-film-project/issue/FGE-170/w-082-restore-the-content-bcp-47-tag-instead-of-collapsing-html-lang) (Urgent)
- **Audit:** `docs/audits/2026-09-13-watch-listing-page-audit.md` § W-082
- **Branch:** `vladmitkovsky/fge-170-w-082-restore-the-content-bcp-47-tag`

## Problem

`resolveWatchLocaleIdentity` (`apps/web/src/lib/locale.ts:343-355`) computes the
internal `[htmlLang]` route segment as:

```ts
const locale = resolveUiLocale(localeSegment) ?? DEFAULT_LOCALE
const tag = slugToBcp47Tag(localeSegment)
const htmlLang = tag && resolveUiLocale(tag) === locale ? tag : locale
```

`resolveUiLocale(tag)` returns a value only when a `messages/*.json` catalog
exists. Only 224 of 2,329 public language slugs have one. For every other slug
the tag is known but discarded, and `htmlLang` collapses to `locale`, which is
itself `DEFAULT_LOCALE` (`en`).

Reproduced on this branch's base commit by calling the real function (probe run
2026-09-14, removed after measurement):

| slug              | `slugToBcp47Tag` | `resolveUiLocale(tag)` | today `locale` / `htmlLang` / `dir` |
| ----------------- | ---------------- | ---------------------- | ----------------------------------- |
| `arabic-najdi`    | `ars`            | `null`                 | `en` / `en` / **`ltr`**             |
| `pashto-southern` | `pbt`            | `null`                 | `en` / `en` / **`ltr`**             |
| `dari`            | `prs`            | `null`                 | `en` / `en` / **`ltr`**             |
| `sindhi`          | `sd`             | `sd`                   | `sd` / `sd` / `rtl`                 |
| `uyghur`          | `ug`             | `ug`                   | `ug` / `ug` / `rtl`                 |

So a page whose entire content is Najdi Arabic declares itself English and
left-to-right. Search engines and screen readers get the wrong language for the
large majority of language slugs, and RTL text renders in an LTR box.

`textDirectionForLocale` is not at fault. Measured against this repo's Node
(v24.19.0) ICU rather than assumed:

```
ars rtl   pbt rtl   prs rtl   sd rtl   ug rtl   ar rtl
en  ltr   mey-Latn ltr   es-419 ltr   en-GB ltr
```

Direction corrects itself the moment `htmlLang` carries the real tag.

## Exact semantic change

The guard only ever fails in one situation. `resolveUiLocale(slug)` and
`resolveUiLocale(tag)` both funnel through `resolveUiLocaleForCatalog`, which
derives the tag from the slug — so they agree whenever a catalog exists. They
diverge only when **no** catalog exists: `resolveUiLocale(tag)` is `null` while
`locale` has already defaulted to `en`.

The change is therefore precisely:

> When the slug has no UI message catalog, keep `locale` at `en` (English
> chrome) but emit the content's own BCP-47 tag as `htmlLang`.

Slugs that already work keep working unchanged, including the two cases that
made the old guard look load-bearing:

- `english-british` → `en-GB` (passes today because `resolveUiLocale("en-GB") === "en"`)
- `spanish-latin-american` → `es-419` (same family-match reason)
- `arabic-hassaniya` / `ar-mey` → `mey-Latn` (returns early from `WATCH_LOCALE_IDENTITY_OVERRIDES`, never reaches the guard)

## Blast radius — `[htmlLang]` is a route segment, not just an attribute

`resolveWatchLocaleIdentity` has 12 production call sites. Each was read before
editing:

| Surface                                                                                                          | Effect of the change                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/[locale]/[htmlLang]/layout.tsx:50-53`                                                                       | The fix's target. Its own guard `htmlLangIdentity.locale === locale` still passes (`{locale:"en", htmlLang:"ars"}` vs param `en`), so `lang="ars" dir="rtl"` renders. **No edit needed.** |
| `proxy.ts` rewrite decisions (5 sites)                                                                           | Rewrite targets move from `/en/en/...` to `/en/<tag>/...` for catalog-less languages. **Public URLs are unchanged** — `[htmlLang]` is internal only.                                      |
| `proxy.ts:207-212` internal-prefix de-prefixing                                                                  | Behaviour for a directly-typed `/en/ars/...` must be proven unchanged, not assumed. See "Risks" below.                                                                                    |
| `proxy.ts:73-78` `WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS`                                                       | Set is built from the same function, so it re-keys in lockstep. Grows from ~225 to ~2,330 distinct entries. Self-consistent.                                                              |
| `app/api/revalidate/route.ts:194-198` `pushInternal`                                                             | Builds `/${locale}/${htmlLang}${suffix}` from the same function, so ISR revalidation paths re-key in lockstep. Self-consistent.                                                           |
| `lib/watch-sitemap.ts:34` `ENGLISH_BRITISH_HREFLANG`                                                             | `english-british` → `en-GB` today and after. **Unaffected.** Sitemap hreflang otherwise comes from admin's manifest, not this function.                                                   |
| `lib/search-language.ts:216`                                                                                     | Reads `identity.locale` only, never `htmlLang`. **Unaffected.**                                                                                                                           |
| `components/WatchChromeShell.tsx:21`                                                                             | Destructures `locale` only. **Unaffected.**                                                                                                                                               |
| Page/metadata call sites (`page.tsx`, `languages`, `history`, `videos/[languageSlug]`, `whats-new`, `[...rest]`) | All destructure `locale` only. **Unaffected.**                                                                                                                                            |

Two properties keep this much smaller than it first looks:

1. **Public URLs do not change.** `/watch/arabic-najdi.html/videos` stays exactly
   that. Only the internal rewrite target moves. No canonical, redirect, or
   sitemap URL changes, so there is no SEO migration.
2. **`generateStaticParams` returns `[]` on every route in the tree** (home,
   `languages`, `whats-new`, `videos/[languageSlug]`, `[...rest]`) with
   `dynamicParams = true`. Nothing is prerendered against the old keys at build
   time, so there is no stale prerendered set to invalidate.

## Risks

- **R1 — ISR cache re-key.** Existing `/en/en/...` ISR entries for catalog-less
  languages are orphaned; the first request per new key re-renders. One-time
  cache-warm cost on deploy, not a correctness bug. Call it out in the PR body.
- **R2 — internal-prefix de-prefixing.** `proxy.ts:210` gates on
  `resolveUiLocale(htmlLang) !== locale`, which the new semantics make false for
  every catalog-less tag. A directly-typed `/en/ars/videos` therefore takes a
  different branch than it does today. Today it exits at
  `identity.htmlLang !== htmlLang` → `{kind:"none"}` and falls through to the
  legacy canonicalizer. **The claim that both paths end in the same outcome must
  be proven with a test at the proxy layer, not reasoned about** — if the
  outcomes differ, the guard is in scope and gets fixed here.
- **R3 — permissive tag passthrough.** `slugToBcp47Tag` accepts any
  `BCP47_TAG_PATTERN`-shaped string, so `/en/xyz/...` could in principle render
  `lang="xyz"`. Must confirm the proxy rejects it before the layout ever renders.

### R2 / R3 — resolved by measurement

Characterized against the base commit through the real `proxy()` before
`locale.ts` was touched:

```
/en/ars/videos   307 → https://www.jesusfilm.org/en.html/ars/videos.html
/en/xyz/videos   307 → https://www.jesusfilm.org/en.html/xyz/videos.html
/en/en/videos    308 → https://www.jesusfilm.org/languages
```

Both R2 and R3 paths already 307'd into a `.html`-suffixed URL that itself
404s. After the change they take the `not-found` branch and serve a clean 404
instead, which is the better of the two outcomes, so the existing
`resolveUiLocale(htmlLang) !== locale` guard is left alone rather than widened.
Neither path reaches the layout, so R3 cannot render `lang="xyz"`.

Both are now pinned in `proxy.test.ts`, and both were falsified once by
restoring the old expression — they go red without the fix.

## Acceptance criteria

1. `resolveWatchLocaleIdentity("arabic-najdi")` → `{ locale: "en", htmlLang: "ars" }`; same shape for `pashto-southern` → `pbt` and `dari` → `prs`.
2. `textDirectionForLocale` of each of those returns `rtl`.
3. Every identity that works today is byte-identical after the change: `english`, `english-british`, `spanish-latin-american`, `arabic-hassaniya`, `ar-mey`, `bangla-2`, `russian`, `mandarin-china`, `sindhi`, `uyghur`, `german` (no tag → still `en`), `null`.
4. The layout renders `<html lang="ars" dir="rtl">` for the Najdi route params — asserted at the layout layer, not inferred from the resolver.
5. Proxy rewrite targets for catalog-less languages move to `/en/<tag>/...`; existing `aari` pins updated to `/en/aiw/...` with rationale.
6. `/en/ars/videos` typed directly produces the same observable outcome as it does on the base commit (R2), pinned by a test.
7. `/en/xyz/...` does not reach the layout (R3), pinned by a test.
8. `pnpm --filter @forge/web test`, `typecheck`, `lint`, and `build` pass.
9. `prettier --check` passes on every new/edited file, markdown included.

## Approach

Test-driven, in this order:

1. **Red first at the resolver layer** — add the three RTL cases to
   `locale.test.ts` and watch them fail.
2. **Red at the layout layer** — a render test asserting `lang`/`dir` on the
   `<html>` element, so acceptance #4 is proven where the claim actually lives
   rather than being inferred from the resolver's return value.
3. **Characterize R2/R3 at the proxy layer before touching `locale.ts`**, so the
   base-commit behaviour is recorded rather than remembered.
4. Make the one-line-shaped change in `resolveWatchLocaleIdentity`, with a
   comment naming why the old family check existed and what replaced it.
5. Update the existing pins that legitimately change (`aari`,
   `german-pennsylvania`, the two proxy rewrite targets), each with a comment
   explaining that the new value is the corrected one.
6. Full `@forge/web` suite, typecheck, lint, build.

## Verification evidence (2026-09-14)

Real `next build` + `next start` on port 3222 against production admin
(`admin.jesusfilm.org`, stg consumer bearer, read-only), compared against live
production on the same URLs at the same time:

| URL                                         | production today | this branch          |
| ------------------------------------------- | ---------------- | -------------------- |
| `/watch/arabic-najdi.html/videos`           | `lang="en" ltr`  | **`lang="ars" rtl`** |
| `/watch/pashto-southern.html/videos`        | `lang="en" ltr`  | **`lang="pbt" rtl`** |
| `/watch/dari.html/videos`                   | `lang="en" ltr`  | **`lang="prs" rtl`** |
| `/watch/hausa.html/videos`                  | `lang="en" ltr`  | **`lang="ha" ltr`**  |
| `/watch/sindhi.html/videos`                 | `lang="sd" rtl`  | `lang="sd" rtl`      |
| `/watch/english.html/videos`                | —                | `lang="en" ltr`      |
| `/watch/english-british.html`               | —                | `lang="en-GB" ltr`   |
| `/watch/spanish-latin-american.html/videos` | —                | `lang="es-419" ltr`  |

`hausa` is the deliberate LTR member of the set: direction is unchanged there,
which shows the fix is about declaring the language, not only about direction.

**R1 measured, not computed.** Cold vs warm render of a re-keyed route on the
local production build:

```
COLD /watch/hausa.html/videos   200 ttfb=4.555s bytes=2924430
WARM /watch/hausa.html/videos   200 ttfb=0.032s bytes=2924430
```

So the ISR re-key costs one ordinary cold render (~4.6 s TTFB here) per
affected language route, once, after deploy — then it is cached as before.
Production keeps ISR in Redis across deploys (`apps/web/CLAUDE.md`, cache
handler), so unlike a normal deploy this one really does pay that cost for the
catalog-less languages. It is a warm-up cost, not a per-request regression.

No page-load regression is claimed beyond that, and none is possible by
construction: the diff touches one server-side expression and three test files.
No client component, bundle chunk, request count, or payload byte changes —
the served HTML differs only in the `lang`/`dir` attribute values.

## Out of scope

- `apps/web/src/components/home/WatchHomeTvCarousel.tsx` and
  `useWatchHomeTvCarousel.ts` — owned by open PR #2287 (FGE-237).
- Sitemap language coverage — that is FGE-183 / W-065.
- Translating the catalog-less languages' chrome — chrome stays English by
  design here; this ticket is about declaring the _content_ language correctly.

## Code review outcomes (2026-09-14)

Seven local reviewers plus an independent cross-model adversarial pass (Codex,
`gpt-5.6-sol`, `independence_verified: true`). Three findings were applied; each
was verified against real data before the fix, and each guard was falsified once.

**1. Invalid BCP-47 tags reached `<html lang>`** (cross-model, confidence 100;
independently reached by the correctness and project-standards reviewers).
`tag ?? locale` trusted every value in the generated map, but the map really
carries `hainanese: "nan-CN-46"`, `javanese-banten: "jv-ID-BT"`,
`huasteco-san-luis-potosi: "hus-MX-SLP"` and
`romani-kalderash-western: "rmy-kal"` — `new Intl.Locale()` throws `RangeError`
on all four. `textDirectionForLocale` catches the throw and still returns a
direction, so the invalid string would have been served as the document
language. The permissive third branch of `slugToBcp47Tag` was the second half of
the same hole: a stale corpus would read the public slug `bel` as a tag, which
canonicalizes to Belarusian, while its real tag is `gdd`.

Fixed with `isDeclarableHtmlLangTag`: a tag is declared only when it is one this
app knows (override/map value or UI catalog key) **and** parses as BCP-47.
Verified in a real server — `/watch/hainanese.html/videos` and
`/watch/javanese-banten.html/videos` now serve `lang="en"` rather than an
unparseable tag, while `ars`/`pbt`/`prs`/`ha` are unaffected.

**2. Error sentinels inherited the content tag** (cross-model, confidence 100).
`buildNotFound` spread the requested identity, so `/unknown.html/aari.html`
rewrote to `/en/aiw/404` — English recovery copy declared as Aari, the same
mis-declaration this ticket removes, pointed the other way. Fixed with
`chromeDocumentLang`, which keeps a same-language regional refinement (`es-419`
on Spanish copy — two pre-existing tests correctly hold that line) and drops a
different language. `WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS` now mirrors it.

_Scope correction to the reviewer's claim:_ the mechanism is real and pinned at
the proxy layer, but the user-visible impact is smaller than reported. Both
production and the local build currently serve Next's `__next_error__` document
for this URL shape, so no `<html lang>` is observable on it today. The fix still
matters for the `not-found.tsx` boundary, which does render inside the layout.

**3. Prototype members resolved as identity overrides** (security, pre-existing).
`WATCH_LOCALE_IDENTITY_OVERRIDES[localeSegment]` was a bare bracket read, so
`resolveWatchLocaleIdentity("constructor")` returned the Object constructor and
handed callers `{ locale: undefined, htmlLang: undefined }`. Now guarded with
`Object.hasOwn`, matching `slugToBcp47Tag`.

### Reviewed and deliberately not changed

- **`/languages` and `/history` ISR fan-out** (performance, confidence 75).
  Initially not applied on the reasoning that "the split is the fix". That was
  wrong, and the ticket owner's call (2026-09-14) was to fix it in this PR.
  Reading the routes settles it: neither page body reads `htmlLang` at all, and
  both render every string from the `locale` catalog, so declaring the requested
  audio language labelled English words as Najdi Arabic — the same
  mis-declaration as the 404 sentinel. `chromeDocumentLang` now gates that
  branch, with `/videos/[languageSlug]` as the discriminating sibling that keeps
  its content tag because it really does render in-language inventory titles and
  `languageNativeName`. The cache split disappears as a side effect rather than
  as the goal. (`/history` is `force-dynamic` and has no ISR entries at all, so
  half the original cache concern never existed.)
- **English chrome inside an RTL document** (correctness, confidence 50). A
  catalog-less RTL page is `dir="rtl"` with English chrome. Ticket owner's call
  (2026-09-14): ship as-is. `dir` matches the page's primary content language,
  which is what the ticket asked for; English chrome still reads left-to-right
  under the bidi algorithm, only block alignment flips. Narrowed further by the
  chrome-page fix above, since chrome-only routes no longer go RTL at all.
- **`textDirectionForLocale` ICU coverage** across ~2,085 tags is measured for
  the tags this change actually surfaces, not exhaustively.

### Cleared by review

Attribute injection and XSS into `lang`/`dir` (values are alnum+hyphen, React
escapes, `dir` is a literal union), ReDoS on `BCP47_TAG_PATTERN` (measured:
5,000-char input in 0.13 ms; `MAX_PATH_LEN` caps input anyway), unbounded ISR
key minting (the proxy admits only corpus/manifest-known slugs), internal-URL
leakage into canonicals/redirects/sitemaps, and every "unaffected" call site in
the table above — `watch-sitemap.ts`, `search-language.ts`, `WatchChromeShell`,
and the page/metadata sites all read `.locale` only, confirmed by reading each.
