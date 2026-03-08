# Metadata scaling: 2000+ languages, per-route

Recommendations for keeping route metadata (SEO/social) scalable when you have many locales and many routes.

---

## 1. **Locale JSON per route (good for 10–100s of locales)**

**Structure**

- One JSON file per locale, **per route**, so each route owns its translations.
- `app/watch/easter/locales/en.json`, `es.json`, … (or `easter/metadata/locales/*.json`).

**Shape (e.g. `en.json`)**

```json
{
  "pathSegment": "",
  "defaultTitle": "Easter 2025 videos & resources... | Jesus Film Project",
  "description": "Explore the other side of Easter...",
  "ogTitle": "What If Everything You Thought About Easter...",
  "ogDescription": "Explore the other side of Easter..."
}
```

**Loader**

- `getEasterMetadata(locale)` does a **dynamic import** or `fetch` of `./locales/${locale}.json` (or a built manifest).
- Route-level code stays small: one small `metadata.ts` that composes shared constants (OG image, site name, base URL) + locale JSON. No giant in-memory `LOCALE_METADATA` object.

**Scaling**

- **Per route:** Add a `locales/` folder and a thin loader; no change to other routes.
- **Per language:** Add one JSON file per route. With 2000 locales × N routes you get many files; use **option 2 or 3** instead.

---

## 2. **Shared locale namespace (best for 2000+ languages)**

**Idea**

- One **file per locale** for the whole app (or per “area”), with **route namespaces** inside.
- No single file with 2000 keys; each locale file has one key per route (or per page).

**Structure**

```
apps/web/src/locales/
  en.json
  es.json
  ...
  (2000 files, one per locale)
```

**Shape (e.g. `en.json`)**

```json
{
  "easter": {
    "pathSegment": "",
    "defaultTitle": "Easter 2025 videos & resources... | Jesus Film Project",
    "description": "Explore the other side of Easter...",
    "ogTitle": "What If Everything You Thought About Easter...",
    "ogDescription": "Explore the other side of Easter..."
  },
  "otherRoute": {
    "pathSegment": "other",
    "defaultTitle": "...",
    "description": "...",
    "ogTitle": "...",
    "ogDescription": "..."
  }
}
```

**Loader**

- Lazy-load only the requested locale (e.g. `import(\`@/locales/${locale}.json\`)` or a server-side read).
- Route metadata helper: `getEasterMetadata(locale)` → load `locales/${locale}.json` (or from cache), then read `data.easter` and merge with shared constants (OG image, `SITE_BASE`, `EASTER_BASE_PATH`, etc.).

**Scaling**

- **Per route:** Add one key (e.g. `easter`) to every locale JSON. Can be scripted or generated from a translation pipeline.
- **Per language:** Add one new JSON file; route code is unchanged. No giant objects in code.

---

## 3. **CMS / Strapi as source of truth (best long-term for 2000+ languages)** ✅ Implemented for Easter

**Idea**

- Store metadata (title, description, ogTitle, ogDescription, pathSegment, ogImage?) in Strapi (or another CMS) **per experience/page and per locale**.
- `generateMetadata()` (or a shared `getMetadata(route, locale)`) calls GraphQL/REST and maps the response to Next.js `Metadata`.

**Current implementation**

- **Strapi:** The `Experience` content type has i18n-localized fields: `title`, `metaDescription`, `ogTitle`, `ogDescription`, `pathSegment`, `ogImage` (single image). Filling these in the CMS for the "easter" experience (and any locale) drives metadata for `/watch/easter`.
- **Web:** One GraphQL query (`GetWatchExperience`) fetches both sections and metadata. `getWatchExperience(locale, { slug })` is wrapped in React `cache()` so `generateMetadata()` and the page share the same request. `experienceToMetadata(exp)` maps the result to metadata; `getEasterMetadata(locale)` uses that and falls back to static strings when the CMS returns no data. Other watch routes can call `getWatchExperience` + `experienceToMetadata` with route-specific fallback and URL building.

**Scaling**

- 2000 languages = 2000 locale entries for a given page in the CMS; no file explosion in the repo.
- Per route: add a content type or extend “Experience” (or “Page”) with metadata fields and i18n.
- Non-engineers can add languages and copy without code deploys.

**Caching**

- Use Next.js `revalidate` or a short TTL so metadata isn’t fetched on every request. Optionally build-time or on-demand ISR.

---

## 4. **Hybrid: shared constants in code, strings from JSON or CMS**

- **In code (per route):** Only things that rarely change: `SITE_BASE`, `EASTER_BASE_PATH`, `OG_IMAGE`, `TITLE_SUFFIX`, Twitter/FB handles, and the **mapping from locale → pathSegment** if it’s rule-based (e.g. `en` → `""`, `es` → `spanish-latin-american`).
- **In JSON or CMS:** All translatable strings (defaultTitle, description, ogTitle, ogDescription) keyed by route and locale.

That keeps the TS/JS file small and puts the growing part (strings × locales) in data.

---

## Recommended path

| Phase                     | Approach                                                                                                                                                                                              | Why                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Now**                   | Split current `metadata.ts`: move locale strings into **route-local** `easter/metadata/locales/*.json` (or one `locales.json` with locale keys) and load them in a small `getEasterMetadata(locale)`. | Stops the single file from growing; same pattern works for other routes.         |
| **100+ locales**          | Move to **shared locale files** (one JSON per locale, route namespaces). Route helpers load `@/locales/${locale}.json` and read `data[routeId]`.                                                      | One file per language; no 2000-key objects; per-route logic stays small.         |
| **2000+ / content-owned** | Add **metadata in Strapi** (or CMS) per page and locale; `generateMetadata()` fetches and caches.                                                                                                     | No repo file explosion; scales per route and per language; editable by non-devs. |

---

## Minimal code sketch (option 2: shared locale JSON)

**`apps/web/src/locales/en.json`** (excerpt)

```json
{
  "easter": {
    "pathSegment": "",
    "defaultTitle": "Easter 2025 videos & resources about Lent, Holy Week, Resurrection | Jesus Film Project",
    "description": "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world.",
    "ogTitle": "What If Everything You Thought About Easter Is Only Half the Story?",
    "ogDescription": "Explore the other side of Easter — one filled with betrayal, hope, and a claim that changed the world."
  }
}
```

**Route helper** `app/watch/easter/metadata.ts`

- Shared constants: `SITE_BASE`, `EASTER_BASE_PATH`, `OG_IMAGE`, `getEasterUrl(locale)` (using pathSegment from locale data or a small fallback map for legacy locales).
- `getEasterMetadata(locale)`: load `locales/${locale}.json` (or cached), read `data.easter`, build Next.js `Metadata` (title, description, openGraph, twitter, alternates). If a locale file is missing, fall back to `en` or a default.

This keeps **per-route** and **per-locale** scaling under control and sets you up to move to CMS later without a big redesign.
