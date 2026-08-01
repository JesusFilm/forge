---
title: "Public Watch URL contract: language-less English and explicit international routes"
date: "2026-06-08"
last_updated: "2026-08-01"
category: "conventions"
module: "Public watch URLs (apps/web /watch) consumed cross-app"
problem_type: "convention"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "Hardcoding or constructing a link to watch.jesusfilm.org/watch content from any app"
  - "Adding demo / experience links in apps/roadmap"
  - "Referencing a watch collection (easter, christmas) or video slug from admin, email, or marketing surfaces"
tags: [watch, url-contract, deep-link, roadmap, cross-app, 404, canonical, seo]
related_components: [apps/roadmap, apps/web]
---

# Public Watch URL contract: language-less English and explicit international routes

## Context

The roadmap Experiments page ("View Demo" buttons) linked to watch content with
bare collection slugs:

- `https://watch.jesusfilm.org/watch/easter`
- `https://watch.jesusfilm.org/watch/christmas`

Both **404 in production**. A bare slug looks like the obvious link and passes
code review, but it is not a valid public watch URL — and nothing redirects it to
the valid one.

## Guidance

The public Watch route always uses an `.html` content segment. Eligible English
content canonically omits the language segment. A second `.html` language
segment is required for non-English content.

```
https://watch.jesusfilm.org/watch/{video-slug}.html
https://watch.jesusfilm.org/watch/{video-slug}.html/{non-english-language-slug}.html
```

Valid examples:

- `/watch/jesus.html` (language omitted, so the Video renders in English)
- `/watch/easter.html`
- `/watch/christmas.html`
- `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`

A language-less `/watch/{video-slug}.html` is the canonical English route when
the slug does not collide with a public language home. It renders through the
same explicit-English internal path without redirecting, so the visible URL
and query string remain unchanged. The proxy admits this form only when the
route manifest confirms that the Video has an English route.

`/watch/{video-slug}.html/english.html` remains a direct `200` compatibility
URL, but its canonical, Open Graph, structured-data, sharing, and sitemap
identity is language-less. A Video whose slug is itself a public language home
(for example `russian`) stays explicit-English because `/watch/russian.html`
belongs to the language home.

A truly bare `/watch/{slug}` without `.html` does **not** 301 to the canonical
form. The watch route
expands the single segment by **duplicating it** into `{slug}.html/{slug}.html`,
which 404s because the second segment (`easter.html`) is not a language. Observed
with `curl -L`:

```
/watch/easter    → 404  (lands on /watch/easter.html/easter.html)
/watch/christmas → 404  (lands on /watch/christmas.html/christmas.html)

/watch/easter.html                 → 200 (canonical English)
/watch/easter.html/english.html    → 200 (compatibility alias)
/watch/christmas.html              → 200 (canonical English)
```

When the destination is non-English, include its public language slug
explicitly. For eligible English, `.html` alone is canonical.

Contextual episode links preserve the parent while following the same English
default:

```text
/watch/{parent}.html/{episode}.html
/watch/{parent}.html/{episode}/{non-english-language}.html
```

The short English contextual form is served directly only after the route
manifest proves the exact parent-child-English relationship. It rewrites
internally to the established explicit renderer without changing the browser
URL or query. The explicit
`/watch/{parent}.html/{episode}/english.html` form remains a direct
compatibility URL. Both English contextual forms publish the language-less
standalone child as canonical, Open Graph, structured-data, and share identity;
contextual routes remain excluded from sitemap output.

If an episode slug collides with a current public language slug or legacy
language alias, generate explicit English so the second segment keeps its
language-route meaning.

### Contextual navigation versus standalone identity

Contextual and standalone URLs are two public addresses for the same playable
Video, but they have different jobs. Collection cards, episode rails, sibling
navigation, and player progression use the contextual route so the viewer keeps
the parent collection. Search, social, sharing, and sitemap discovery use the
standalone route so one Video/Language pair has one public identity.

| Incoming page                                    | Browser result                            | Canonical, `og:url`, `VideoObject.url`, and Share identity       |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| `/watch/{parent}.html/{episode}.html`            | Direct `200`; URL unchanged               | `https://www.jesusfilm.org/watch/{episode}.html`                 |
| `/watch/{parent}.html/{episode}/english.html`    | Direct compatibility `200`; URL unchanged | `https://www.jesusfilm.org/watch/{episode}.html`                 |
| `/watch/{episode}.html`                          | Direct `200`                              | Self-canonical English URL                                       |
| `/watch/{parent}.html/{episode}/{language}.html` | Direct `200`; URL unchanged               | `https://www.jesusfilm.org/watch/{episode}.html/{language}.html` |
| `/watch/{episode}.html/{language}.html`          | Direct `200`                              | Self-canonical URL for that Language                             |

Each server-rendered page must contain exactly one absolute canonical. A
contextual/standalone pair must select the same primary Video and Dub, proven by
exactly one `VideoObject` on each page with matching `name` and `contentUrl`.
The contextual page changes only navigation context; it must not change the
selected media.

Watch sitemap `<loc>` and `hreflang` output contains standalone routes only.
General discovery links should also use the standalone route. Contextual links
are deliberate only where preserving collection navigation is part of the user
experience; eligible English contextual links omit `/english.html`.

## Why This Matters

The failure is **invisible until a human clicks**. Typecheck, lint, and CI all
pass — the href is just a `string`. The link only 404s at runtime, in
production, often in front of the exact stakeholders a demo link is meant to
impress. There is no redirect safety net for routes missing the required
`.html` shape, so "close enough" slugs do not self-heal.

## When to Apply

- Constructing any link to `watch.jesusfilm.org/watch` content from outside `apps/web`
- Adding or editing `EXPERIMENTS` demo links in `apps/roadmap/lib/experiments.ts`
- Cross-app references (admin previews, email CTAs, marketing pages) to a watch collection or video
- Preserving existing language-less Video links whose default language is
  English

## Examples

`apps/roadmap/lib/experiments.ts` — before (404) vs after (200):

```diff
-    href: "https://watch.jesusfilm.org/watch/easter",
+    href: "https://watch.jesusfilm.org/watch/easter.html",
```

```diff
-    href: "https://watch.jesusfilm.org/watch/christmas",
+    href: "https://watch.jesusfilm.org/watch/christmas.html",
```

Verify any new watch link before shipping:

```bash
curl -sS -o /dev/null -w "%{http_code} -> %{url_effective}\n" -L "<the href>"
# expect: 200 -> <the same href>
# a redirect to {slug}.html/{slug}.html means the required .html shape was omitted
```

For routing or metadata changes, also run the repository Watch URL probe and
sitemap audit. The probe is a release gate: it rejects missing, relative, or
duplicate canonicals; disagreement among canonical, Open Graph, and page-level
JSON-LD identity; a contextual/standalone primary-video mismatch; and drift in
the explicit international fixtures.

```bash
pnpm --filter @forge/web probe:watch-urls --production https://www.jesusfilm.org --preview <preview-origin>
pnpm --filter @forge/web audit:watch-sitemap --origin <preview-origin>
```

## Related

- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md` — the route-internal side of the same two-segment shape: static-route admission via the admin manifest, one-segment language homes (`/watch/german.html`), and locale rewrites. This doc is the consumer/link-construction side of that contract.
