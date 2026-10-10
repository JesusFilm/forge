---
id: "feat-397"
title: "Experience Draft Staging and Public Preview"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-08-20"
duration: 5
depends_on: []
blocks: []
tags:
  - "admin"
  - "experiences"
  - "publishing"
  - "web"
  - "seo"
---

## Problem

Saving edits to a published `ExperienceLocale` currently updates its canonical row and can refresh public Experience or Homepage output before a publisher deliberately publishes the changes.
The schema and Admin conventions already define `ContentRevision` drafts as the safe editing boundary, but Experience editing does not yet follow that lifecycle.

## Entry Points - Read These First

1. `docs/plans/2026-08-20-1607-feat-experience-draft-staging-plan.md` - product contract and accepted behavior.
2. `apps/admin/prisma/schema.prisma` - `ContentRevision`, `Experience`, and `ExperienceLocale` lifecycle contracts.
3. `apps/admin/src/services/experience.service.ts` - current create, update, publish, restore, and revalidation behavior.
4. `apps/admin/src/services/video-search-social.service.ts` - adjacent shared-draft save, publish, and discard pattern.
5. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` - editor actions, revision loading, and publish wiring.
6. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` - save/publish/preview controls and locale state.
7. `apps/admin/src/graphql/types/experience.ts` and `apps/admin/src/graphql/mutations/experience.ts` - editor and public GraphQL contracts.
8. `apps/web/src/app/api/preview/route.ts` and the Watch Experience route - legacy preview entry and public rendering boundary.

## Grep These

- `snapshotExperienceLocale`
- `updateLocale`
- `publishLocale`
- `RevisionStatus`
- `content_revision_one_draft_per_entity`
- `isHomepage`
- `STRAPI_PREVIEW_SECRET`
- `experienceBySlug`

## What To Build

1. Route every save of a published language-specific Experience into its single shared `ContentRevision` draft while leaving canonical public content untouched.
2. Keep drafts independent per `ExperienceLocale`; use last-save-wins behavior for multiple editors.
3. Add explicit draft discard and atomic draft publish flows with revision history and existing public cache/manifest refresh behavior.
4. Make the editor load and edit active draft state, clearly distinguish live versus staged content, and expose publish, discard, and preview actions.
5. Add an unguessable public preview link that resolves the latest active draft until publish or discard.
6. Keep previews out of sitemap, hreflang, structured-data, canonical discovery, and indexing surfaces with `noindex, nofollow`.
7. Preserve the existing public GraphQL rule that ordinary consumers see only canonical `PUBLISHED` content.

## Constraints

- One shared active draft per language-specific Experience; no personal or branched drafts.
- Last save wins; no locks, merge UI, stale-save rejection, or overwrite warning.
- English and Russian drafts for the same parent Experience must coexist without collision.
- Preview links have no fixed expiry and become invalid only when their draft is published or discarded.
- Preview access is public through possession of the unguessable URL; it does not require Admin login.
- No production deployment outside the normal PR-to-main flow.
- If the Pothos schema changes, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts` in the same change.

## Verification

- Admin service tests prove published saves leave canonical rows unchanged, language drafts coexist, last save wins, publish promotes atomically, and discard preserves live content.
- GraphQL and editor tests cover active draft reads and the publish/discard/preview actions.
- Web tests prove valid preview rendering, invalidation after publish/discard, `noindex, nofollow`, and absence from discovery metadata.
- Ordinary Experience and Homepage routes continue to return only published canonical content while drafts exist.
- Focused Admin and Web format, lint, typecheck, and test commands pass for touched scope.
- Browser smoke covers desktop and phone editing, shared preview, publish, discard, and unchanged-live behavior before publish.
- Frontend verification checks that draft support does not introduce request-time work on ordinary cached public Experience and Homepage routes.
