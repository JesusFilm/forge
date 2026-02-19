---
name: strapi-experience-scripts
description: Run scripts to get the Strapi API token and to upsert Experience content via the Strapi REST API. Use when the user or agent needs to authenticate with Strapi, create/update experiences by slug, or seed CMS content.
---

# Strapi Experience Scripts

Use the scripts in `scripts/` to obtain the Strapi API token and to upsert experiences. Run all commands from the **workspace root**.

## Prerequisites

- **STRAPI_API_TOKEN**: Create in Strapi Admin → Settings → Global settings → API Tokens (Full access or custom with Experience create/update). Put the token in `.env` or `apps/cms/.env` as `STRAPI_API_TOKEN=your-token`.
- **STRAPI_URL** (optional): Base URL of Strapi (e.g. `http://localhost:1337`). Defaults to `http://localhost:1337` if unset.
- Strapi CMS running (e.g. `pnpm run dev:backend` or `pnpm run dev` with CMS).

## 1. Get Strapi API token

Use this to resolve the token for other tools or to check that it is set.

```bash
node scripts/get-strapi-token.js
```

- If set: prints the token (no newline if piped).
- If unset: prints `.` so callers can detect “no token” without failing.

## 2. Upsert an experience

Creates an experience when no document with the given slug exists for the locale; otherwise updates it.

```bash
node scripts/upsert-experience.js <slug> [locale] [payload.json]
```

- **slug** (required): URL slug (e.g. `home`, `watch`).
- **locale** (optional): I18n locale (default `en`).
- **payload.json** (optional): Path to a JSON file with `slug`, `isHomepage`, and/or `sections`. If omitted, only `slug` is sent (minimal create/update).

**Examples:**

```bash
# Create/update experience "home" in locale "en" with no sections
node scripts/upsert-experience.js home

# With locale
node scripts/upsert-experience.js home en

# With payload file (must include slug and any sections)
node scripts/upsert-experience.js home en payloads/home.json
```

**Payload shape:**

- Top-level: `slug`, `isHomepage` (boolean), `sections` (array).
- **sections**: Dynamic zone. Each item must have `__component` and the rest are component attributes.
  - `__component`: `sections.media-collection` | `sections.promo-banner` | `sections.info-blocks` | `sections.cta`
  - Example (promo-banner): `{ "__component": "sections.promo-banner", "heading": "Welcome", "description": "Text", "ctaLink": "/go", "intro": "" }`
  - Example (media-collection): `{ "__component": "sections.media-collection", "variant": "grid", "title": "Videos", "items": [] }`

Experience uses **draftAndPublish**. The script creates/updates the document; to make it live, publish it in Strapi Admin or via a separate publish API call.

## Agent workflow

1. **Need token for another command:** Run `node scripts/get-strapi-token.js` and use the output (if not `.`, token is set).
2. **Upsert an experience:** Ensure `STRAPI_API_TOKEN` is set, then run `node scripts/upsert-experience.js <slug> [locale] [payload.json]`. Use a JSON file for non-trivial sections.
3. **Missing token:** Remind the user to add `STRAPI_API_TOKEN` to `.env` or `apps/cms/.env` (create token in Strapi Admin → Settings → API Tokens).
