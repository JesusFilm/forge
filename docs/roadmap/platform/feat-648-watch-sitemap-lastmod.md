---
id: feat-648
title: Emit source timestamps in Watch sitemaps
status: complete
priority: P1
created: 2026-10-08
updated: 2026-10-08
---

# Emit source timestamps in Watch sitemaps

**What landed.** The Admin Watch SEO manifest now carries a source-derived
`lastModified` value for each canonical video route group, taking the latest
real update timestamp among its public video, locale, and playable dub rows.
Web emits that value on each video URL and uses the greatest included URL
timestamp for each child sitemap's `<lastmod>` in the sitemap index. Homepage
entries and legacy manifest groups without timestamps omit `<lastmod>`; neither
uses manifest generation time as a substitute.

This timestamp describes the latest currently public source row. Removing a
locale/dub or changing a video relation can remove a row without leaving a
source timestamp in the current manifest, so those removals do not necessarily
advance `<lastmod>`. The source tables do not expose a retained deletion/update
timestamp for those changes.

## Scope

- `apps/admin/src/services/watch-seo-manifest.service.ts` — query public source
  timestamps and serialize a last-modified timestamp per route group.
- `apps/web/src/lib/watch-seo-manifest.ts` — accept optional timestamps for
  compatibility with persisted older manifest payloads.
- `apps/web/src/lib/watch-sitemap.ts` — retain timestamps across chunking and
  emit URL and index `<lastmod>` tags while accounting for their XML bytes.
- Corresponding Admin and Web tests.
- `apps/web/src/lib/watch-sitemap-audit.ts` — validate timestamp syntax in
  index and child sitemap documents.

## Verification

- Admin Watch SEO manifest unit tests.
- Web sitemap and SEO manifest unit tests.
- Admin and Web typecheck, lint, and formatting checks.
