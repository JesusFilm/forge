# CMS Agent Guide

Scope: `apps/cms`.

## Alignment

`apps/cms/CLAUDE.md` is canonical detail for stack-level CMS guidance.

## Do

- Model canonical entities and workflow states explicitly.
- Keep AI outputs in variant/revision records.
- Keep transitions auditable and role-gated.
- Keep GraphQL plugin as primary contract surface for consuming apps.
- Communicate schema changes that impact `packages/graphql`, `apps/web`, and `apps/mobile`.

## Do not

- Allow AI path to `published`.
- Move schema out of `apps/cms` (schema.graphql is canonical, Strapi-generated).
- Merge schema changes without validating downstream codegen compatibility.

## Typing note (Strapi internals)

- Prefer `Core.Strapi` at function boundaries.
- For Strapi admin internals (`admin.services["api-token"]`, `admin::api-token` query, `db.connection.raw`), use local narrow casts at the exact callsites.
- Do not add broad/global fake Strapi types for these internals; they drift and break easily across Strapi updates.

## Strapi schema architecture

### Component schema structure

- Location: `apps/cms/src/components/sections/<kebab-name>.json`
- Collection name convention: `components_sections_<snake_case>`
- Component reference format: `sections.<kebab-name>`
- All components live under the `sections` category

### Schema file format

```json
{
  "collectionName": "components_sections_<snake_case_plural>",
  "info": {
    "displayName": "Human Name",
    "icon": "icon-name",
    "description": "What this component does"
  },
  "options": {},
  "attributes": {
    "sectionKey": { "type": "string", "required": false },
    "title": { "type": "string", "required": false },
    "items": {
      "type": "component",
      "repeatable": true,
      "component": "sections.child-component",
      "required": false
    }
  }
}
```

### Attribute types used

- `string`, `text` (short/long text)
- `enumeration` with `enum` array
- `boolean`, `float` (with optional `min`/`max`)
- `media` (with `allowedTypes`, `multiple`)
- `relation` (e.g. `"manyToOne"` to `"api::video.video"`)
- `component` (nested, with `repeatable: true/false`)
- `dynamiczone` (polymorphic content blocks with `components` array)

### Content types vs components

- Content types: `apps/cms/src/api/<name>/content-types/<name>/schema.json` — standalone entities with their own API endpoints (e.g. `Video`, `Experience`)
- Components: `apps/cms/src/components/sections/<name>.json` — reusable blocks embedded in content types, no own API endpoint

### Dynamic zones

- The `Experience` content type has a `blocks` dynamic zone listing all top-level components
- The `Section` component has a `content` dynamic zone for nested components
- Adding a new component requires registering it in the appropriate dynamic zone's `components` array

### Section wrapper pattern

- The `Section` component (`sections.section`) wraps other components to provide background styling
- It has `backgroundColor` (enum), `backgroundOpacity` (float), `dynamicBackgroundImage` (boolean), `staticOverlay` (boolean), `blurHash` (string)
- `dynamicBackgroundImage: true` enables blurred background images + overlay via `DynamicBackground.tsx`
- `staticOverlay: true` renders the overlay texture without the dynamic background machinery (use when `dynamicBackgroundImage: false`)
- Components that need background styling are nested inside Section's `content` DZ, not placed at the top-level `blocks` DZ directly
- Frontend: `Section.tsx` reads `backgroundColor` and maps it to CSS classes; overlay texture is applied via either `DynamicBackground` or `staticOverlay`

### Schema-to-frontend pipeline

| Layer                       | Location                                       | Purpose                                                       |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Strapi component schema     | `apps/cms/src/components/sections/<name>.json` | Defines fields and types                                      |
| Experience DZ or Section DZ | `experience/schema.json` or `section.json`     | Registers component in dynamic zone                           |
| GraphQL fragment            | `apps/web/src/lib/fragments/<name>.ts`         | Defines which fields the frontend queries                     |
| Fragments index             | `apps/web/src/lib/fragments/index.ts`          | Re-exports all fragments                                      |
| Content query               | `apps/web/src/lib/content.ts`                  | Includes fragment spread in `GET_WATCH_EXPERIENCE`            |
| Section fragment            | `apps/web/src/lib/fragments/section.ts`        | Includes fragment spread for Section-nested components        |
| Section renderer            | `apps/web/src/components/sections/index.tsx`   | Maps `__typename` to React component (top-level blocks)       |
| SectionContentRenderer      | `apps/web/src/components/sections/Section.tsx` | Maps `__typename` to React component (Section-nested content) |
| React component             | `apps/web/src/components/sections/<Name>.tsx`  | Renders the component using `FragmentOf<typeof fragment>`     |

### Existing components reference

| Component               | Schema file                  | Has items                     | Used in            |
| ----------------------- | ---------------------------- | ----------------------------- | ------------------ |
| `video`                 | `video.json`                 | No                            | blocks, Section DZ |
| `video-hero`            | `video-hero.json`            | No                            | blocks             |
| `video-carousel`        | `video-carousel.json`        | Yes (`video-carousel-item`)   | blocks, Section DZ |
| `media-collection`      | `media-collection.json`      | Yes (`media-collection-item`) | blocks, Section DZ |
| `bible-quotes-carousel` | `bible-quotes-carousel.json` | Yes (`bible-quote-item`)      | Section DZ         |
| `section`               | `section.json`               | Dynamic zone (`content`)      | blocks             |
| `container`             | `container.json`             | Dynamic zone (`slots`)        | Section DZ         |
| `text`                  | `text.json`                  | No                            | blocks, Section DZ |
| `cta`                   | `cta.json`                   | No                            | blocks, Section DZ |
| `easter-dates`          | `easter-dates.json`          | No                            | blocks             |
| `related-questions`     | `related-questions.json`     | Yes (`related-question-item`) | blocks, Section DZ |

---

## Local Testing: Gateway Sync

Full runbook: [`docs/solutions/cms/gateway-sync-local-testing.md`](../../docs/solutions/cms/gateway-sync-local-testing.md)

Covers: env setup, admin creation, API token generation (not admin JWT — see the auth gotcha), dry-run, live import, status polling, and guard verification.

---

### Seed script conventions (`scripts/seed-easter.mjs`)

- Top-level blocks use `__typename: "ComponentSections<PascalName>"` (GraphQL format)
- Nested content inside Section/Container uses `__component: "sections.<kebab-name>"` (Strapi REST format)
- The script has a `typenameToComponent` map that converts between the two formats
- Video references use `vid(slug)` helper to resolve `documentId` from `videoMap`
- Image references use `img(name)` helper to resolve numeric file ID from `fileMap`
