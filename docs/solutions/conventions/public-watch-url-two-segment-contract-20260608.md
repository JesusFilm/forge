---
title: "Public Watch URL contract: language-less English and explicit international routes"
date: "2026-06-08"
last_updated: "2026-07-25"
category: "conventions"
module: "Public watch URLs (apps/web /watch) consumed cross-app"
problem_type: "convention"
component: "frontend_stimulus"
severity: "medium"
applies_when:
  - "Hardcoding or constructing a link to watch.jesusfilm.org/watch content from any app"
  - "Adding demo / experience links in apps/roadmap"
  - "Referencing a watch collection (easter, christmas) or video slug from admin, email, or marketing surfaces"
tags: [watch, url-contract, deep-link, roadmap, cross-app, 404]
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

## Related

- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md` — the route-internal side of the same two-segment shape: static-route admission via the admin manifest, one-segment language homes (`/watch/german.html`), and locale rewrites. This doc is the consumer/link-construction side of that contract.
