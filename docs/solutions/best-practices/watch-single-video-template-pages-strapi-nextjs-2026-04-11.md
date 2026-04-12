---
title: "Watch Single-Video Template Pages with Strapi Settings and Next.js Route Resolution"
problem_type: best_practice
component: tooling
root_cause: incomplete_setup
resolution_type: code_fix
severity: high
date: "2026-04-11"
features:
  - "feat-047"
  - "feat-048"
  - "feat-049"
tags:
  - watch
  - strapi
  - nextjs
  - templates
  - video-pages
  - route-resolution
  - revalidation
  - vitest
module: watch
key_files:
  - "apps/web/src/lib/content.ts"
  - "apps/web/src/lib/experience-metadata.ts"
  - "apps/web/src/app/api/revalidate/route.ts"
  - "apps/web/src/components/sections/Video.tsx"
  - "apps/web/src/components/sections/VideoHero.tsx"
  - "apps/web/src/components/sections/MediaCollection.tsx"
  - "apps/cms/src/api/watch-setting/content-types/watch-setting/schema.json"
  - "apps/cms/src/api/watch-setting/content-types/watch-setting/lifecycles.js"
  - "apps/cms/src/api/experience/content-types/experience/lifecycles.js"
related:
  - "docs/solutions/web/nextjs16-cachecomponents-isr.md"
  - "docs/solutions/database-issues/strapi-boolean-defaults-not-backfilled-on-existing-rows.md"
---

## Problem

The watch app could only render `/watch/[slug]` when the slug matched an explicit `Experience`. That made reusable single-video pages impossible because editors had to create one `Experience` per video, and there was no safe CMS model for selecting a homepage or a default watch template.

The first pass at fixing that also revealed two operational gaps: template pages needed route-bound block behavior rather than hardcoded CMS video data, and the CMS needed validation so editors could not save broken template settings or malformed authored video blocks.

## What Didn't Work

### 1. Treating every video page as a normal `Experience`

This preserved the existing rendering model, but it does not scale. Every new video slug would require a separate page entry even if the desired layout is identical.

### 2. Reusing a normal `Experience` without runtime awareness

Marking an `Experience` as a template is not enough by itself. Plain blocks still point to authored `streamingUrl`, `video`, or collection items, so the page would render the wrong content unless the renderer knows how to bind the current route video at runtime.

### 3. Keeping homepage selection on `Experience.isHomepage`

That model allows multiple homepages and makes resolution depend on whichever row happens to come back first. It also does not provide a place to store the default single-video template.

### 4. Making route-bound blocks looser without adding validation

Allowing `streamingUrl` to be optional for template mode fixed one use case, but it also let normal authored pages save broken `Video` and `VideoHero` blocks unless CMS validation was restored elsewhere.

## Solution

### 1. Add a localized `Watch Setting` singleton

Use one CMS singleton to define:

- `homepageExperience`
- `defaultTemplateExperience`

This moves watch app configuration out of per-entry toggles and gives the web app one canonical source of truth for homepage and generic single-video fallback.

```json
{
  "kind": "singleType",
  "info": { "displayName": "Watch Settings" },
  "pluginOptions": { "i18n": { "localized": true } },
  "attributes": {
    "homepageExperience": {
      "type": "relation",
      "relation": "oneToOne",
      "target": "api::experience.experience"
    },
    "defaultTemplateExperience": {
      "type": "relation",
      "relation": "oneToOne",
      "target": "api::experience.experience"
    }
  }
}
```

### 2. Mark reusable page entries with `Experience.isTemplate`

Keep templates as normal `Experience` rows so editors still use the existing dynamic-zone/block workflow. The boolean marker is enough to distinguish public pages from internal layout templates.

### 3. Resolve watch routes in one shared server path

The watch app now uses a shared resolver for both page rendering and metadata:

1. If the slug matches a non-template `Experience`, render it directly.
2. Otherwise, if the slug matches a `Video`, load the default template from `Watch Setting`.
3. Normalize the matched route video into one shared runtime shape.
4. Render the template with that `routeVideo` injected into route-aware blocks.

This keeps page HTML, metadata, and fallback behavior aligned because everything runs through the same `resolveWatchPage(...)` flow.

```ts
const explicitExperience = await getExperienceByFilters(locale, {
  slug: { eq: slug },
})
if (explicitExperience && explicitExperience.isTemplate !== true) {
  return { kind: "experience", experience: explicitExperience }
}

const routeVideoRecord = await getVideoBySlug(locale, slug)
const settings = await getWatchSettings(locale)
const templateExperience = settings?.defaultTemplateExperience

if (templateExperience?.isTemplate === true && routeVideoRecord) {
  return {
    kind: "video-template",
    template: templateExperience,
    routeVideo: normalizeRouteVideo(routeVideoRecord),
  }
}
```

### 4. Make existing sections route-aware instead of inventing template-only blocks

`Video` and `VideoHero` gain `useRouteVideo`, which tells the renderer to ignore hardcoded playback fields and bind to the current route video instead.

`MediaCollection` gains `itemsSource` with:

- `manual`
- `routeVideoChildren`

When route-driven, it uses normalized `Video.children` data from the matched route video rather than authored collection items.

This keeps one block system while allowing template entries to behave dynamically.

### 5. Add CMS validation and payload normalization

Two lifecycle guardrails make the template system safe to operate:

- `Watch Setting` validation rejects homepage entries marked as templates and rejects default-template entries that are not marked as templates.
- `Experience` validation rejects authored `Video` and `VideoHero` blocks that have neither `streamingUrl` nor `useRouteVideo=true`.

The branch also adds text-block normalization so plain textarea content is converted into the paragraph-array shape expected by the web app before Strapi persists it.

### 6. Revalidate all dependent watch routes when settings/templates change

Generic video pages depend on more than their own slug. A change to the default template or watch settings can affect many routes at once, so the revalidation endpoint must invalidate the watch app layout plus homepage aliases rather than only a single path.

## Why This Works

1. **The CMS model matches the product concept.** Homepage selection and default-template selection are app-level settings, so they belong in a singleton rather than on every `Experience`.
2. **Templates reuse existing editorial workflow.** Editors still build layouts with standard `Experience` entries and existing block types instead of learning a second content model.
3. **Runtime data injection happens explicitly.** `useRouteVideo` and `routeVideoChildren` make template behavior intentional and visible in the schema instead of relying on empty fields or implicit fallback.
4. **One resolver prevents drift.** Rendering and metadata both use the same route resolution logic, so the page body and SEO data cannot disagree about whether a slug is an explicit page or a templated video route.
5. **Validation restores safety after schema loosening.** Optional playback fields are only safe when the CMS explicitly validates the authored vs route-bound modes.
6. **Route cache invalidation matches dependency shape.** Generic watch pages depend on template and settings records, not just the leaf video slug, so layout-level invalidation is the correct reliability tradeoff.

## Prevention

- Use a localized singleton any time the watch app needs one canonical selector, not booleans scattered across content entries.
- If a CMS block can operate in both authored and route-bound modes, add an explicit mode field and lifecycle validation for the authored path.
- Keep all watch route precedence in one server-side resolver shared by page rendering and metadata.
- When adding runtime-derived section data, normalize it into the same rendering shape the component already expects instead of adding parallel rendering pipelines.
- For Next.js ISR on derived pages, invalidate the highest route level affected by the dependency graph, not only the direct content slug.
- Add tests around resolver precedence, metadata behavior, and revalidation paths whenever watch routing changes.

## Verification

This pattern was verified with:

```bash
pnpm install
pnpm --filter @forge/graphql generate
pnpm --filter @forge/cms typecheck
pnpm --filter @forge/cms build
pnpm --filter @forge/web test
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web build
```

Manual smoke checks also confirmed:

- generic `/watch/[video-slug]` pages render through the template fallback
- route-driven related media differs between video slugs
- explicit experience pages such as `/watch/christmas` preserve manual authored behavior

## Related Issues

- See also: [Route-Level ISR with Apollo GraphQL and On-Demand Revalidation](../web/nextjs16-cachecomponents-isr.md)
- See also: [Strapi Boolean Defaults Are Not Backfilled on Existing Rows](../database-issues/strapi-boolean-defaults-not-backfilled-on-existing-rows.md)
