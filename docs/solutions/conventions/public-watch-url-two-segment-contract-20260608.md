---
title: "Public Watch URL contract: use .html route shapes and explicit languages when needed"
date: "2026-06-08"
last_updated: "2026-07-24"
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

# Public Watch URL contract: use .html route shapes and explicit languages when needed

## Context

The roadmap Experiments page ("View Demo" buttons) linked to watch content with
bare collection slugs:

- `https://watch.jesusfilm.org/watch/easter`
- `https://watch.jesusfilm.org/watch/christmas`

Both **404 in production**. A bare slug looks like the obvious link and passes
code review, but it is not a valid public watch URL — and nothing redirects it to
the valid one.

## Guidance

The public Watch route always uses an `.html` content segment. A second
`.html` language segment is required for a specific language and remains the
canonical way to link non-English content.

```
https://watch.jesusfilm.org/watch/{collection-or-video-slug}.html/{language-slug}.html
```

Valid examples:

- `/watch/jesus.html` (language omitted, so the Video renders in English)
- `/watch/easter.html/english.html`
- `/watch/christmas.html/english.html`
- `/watch/jesus.html/english.html`
- `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`

A language-less `/watch/{video-slug}.html` is a supported English-default
route. It renders through the same English Video path without redirecting, so
the visible URL and query string remain unchanged. The proxy admits this form
only when the route manifest confirms that the Video has an English route.

A truly bare `/watch/{slug}` without `.html` does **not** 301 to the canonical
form. The watch route
expands the single segment by **duplicating it** into `{slug}.html/{slug}.html`,
which 404s because the second segment (`easter.html`) is not a language. Observed
with `curl -L`:

```
/watch/easter    → 404  (lands on /watch/easter.html/easter.html)
/watch/christmas → 404  (lands on /watch/christmas.html/christmas.html)

/watch/easter.html/english.html    → 200 (no redirect)
/watch/christmas.html/english.html → 200 (no redirect)
```

When the destination language matters, include it explicitly. When an inbound
or durable Video URL intentionally omits the language, `.html` alone means
English and should remain visible rather than redirecting to
`/english.html`.

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
+    href: "https://watch.jesusfilm.org/watch/easter.html/english.html",
```

```diff
-    href: "https://watch.jesusfilm.org/watch/christmas",
+    href: "https://watch.jesusfilm.org/watch/christmas.html/english.html",
```

Verify any new watch link before shipping:

```bash
curl -sS -o /dev/null -w "%{http_code} -> %{url_effective}\n" -L "<the href>"
# expect: 200 -> <the same href>
# a redirect to {slug}.html/{slug}.html means the required .html shape was omitted
```

## Related

- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md` — the route-internal side of the same two-segment shape: static-route admission via the admin manifest, one-segment language homes (`/watch/german.html`), and locale rewrites. This doc is the consumer/link-construction side of that contract.
