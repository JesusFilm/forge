---
title: "Duplicate Experiences through one service and reset lifecycle state"
category: cms
module: "Admin Experience lifecycle"
date: 2026-08-21
problem_type: architecture_pattern
component: service_layer
severity: high
applies_when:
  - "Exposing the same content-duplication operation through Admin UI, GraphQL, and MCP"
  - "Copying localized authored content while the destination must never inherit public or derived lifecycle state"
  - "Authorizing a copy with separate destination-write and source-read checks"
  - "Keeping transport adapters thin so copy semantics cannot drift between operator surfaces"
related_components:
  - api_layer
  - frontend
  - mcp
tags:
  - experience
  - duplication
  - draft-lifecycle
  - graphql
  - mcp
  - admin
  - authorization
  - unpublished-copy
---

# Duplicate Experiences through one service and reset lifecycle state

## Context

Experience duplication is a cross-surface operation: the Admin editor,
GraphQL clients, and MCP agents all need the same copy semantics. Implementing
the copy independently in each adapter would let authorization, publication
resets, and copied-field selection drift. Forge's mutation convention already
places domain writes in services (`apps/admin/src/services/experience.service.ts:1-5`),
so duplication belongs in one service mutation with thin transport adapters.

The safety requirement is stronger than cloning a database row. A copied
Experience must remain editable without becoming public: the caller owns the
destination, all copied locales are drafts, homepage and publication state are
cleared, and public or derived side effects are not replayed. Authored routing,
SEO, Open Graph, template, and block data from each locale's latest saved
effective state must survive (`apps/admin/src/services/experience.service.ts:424-488`,
`apps/admin/src/services/experience.service.ts:506-533`).

## Guidance

### Put the copy algorithm in one service mutation

Make `ExperienceService.duplicate` the only code path that decides what
duplication means. It parses input, authorizes the request, selects a narrow
source shape, resolves each locale's active saved draft, validates the effective
content, derives destination slugs, and performs one nested Experience create
(`apps/admin/src/services/experience.service.ts:408-533`). GraphQL delegates
directly to it (`apps/admin/src/graphql/mutations/experience.ts:9-16`,
`apps/admin/src/graphql/mutations/experience.ts:45-55`), as does MCP
(`apps/admin/src/services/experience-mcp.service.ts:208-219`). The Admin server
action supplies the same service instead of reconstructing locales in the UI
(`apps/admin/src/app/dashboard/experiences/[id]/page.tsx:314-326`).

Keep authorization order intentional. Require `write:experiences` before
loading the source so a caller without destination-create authority cannot
probe source IDs (`apps/admin/src/services/experience.service.ts:415-424`).
After loading, apply source `canViewExperience` ABAC before any destination
write (`apps/admin/src/services/experience.service.ts:424-455`). Assign the new
owner from the authenticated caller, never the source or input
(`apps/admin/src/services/experience.service.ts:506-512`).

Copy an explicit allowlist of authored fields. Preserve `isTemplate`, locale,
routing, title, metadata, Open Graph fields, and blocks
(`apps/admin/src/services/experience.service.ts:424-445`,
`apps/admin/src/services/experience.service.ts:506-526`). Resolve any active
locale draft into that allowlist before validating it
(`apps/admin/src/services/experience.service.ts:461-488`). Validate blocks with
`BlocksSchema.safeParse`, but persist the selected saved JSON so schema defaults
do not rewrite valid canonical content
(`apps/admin/src/services/experience.service.ts:477-488`,
`apps/admin/src/services/experience.service.ts:526`).

Reset lifecycle fields in the create payload. Every copied locale sets
`isHomepage: false`, `status: "DRAFT"`, and `publishedAt: null`
(`apps/admin/src/services/experience.service.ts:513-529`). Embeddings,
revisions, chats, identifiers, timestamps, and public refresh work remain
outside the copy because they are absent from that payload and no publish
workflow is invoked (`apps/admin/src/services/experience.service.ts:506-533`).
Tests guard against revision creation and public side effects
(`apps/admin/src/services/experience.service.test.ts:376-412`,
`apps/admin/src/app/mcp/route.test.ts:586-610`).

Generate readable per-locale slugs with `-copy`, `-copy-2`, and numbered
successors, trimming the source portion so the result stays within 200
characters (`apps/admin/src/services/experience.service.ts:44-58`). Seed a
request-local set from existing slugs before the nested create
(`apps/admin/src/services/experience.service.ts:490-530`). This is
deterministic best-effort naming, not a concurrency guarantee: lookup and
create are separate and draft slugs have no locking contract.

Reject unusable saved state before slug work or creation. A source without
locales, or with saved blocks that fail the persistence schema, raises the
safe `ExperienceDuplicationError`
(`apps/admin/src/services/experience.service.ts:457-488`,
`apps/admin/src/services/errors.ts:20-24`). Tests verify both failures happen
before the slug query and create
(`apps/admin/src/services/experience.service.test.ts:580-614`).

### Keep transport adapters narrow and strict

GraphQL exposes `duplicateExperience(id: ID!): Experience!`, applies the
existing write scope, and delegates to the service
(`apps/admin/src/graphql/mutations/experience.ts:45-55`). Regenerate both the
checked-in SDL and gql.tada environment when the Pothos source changes; schema
tests pin the public shape and exact delegation arguments
(`apps/admin/src/graphql/schema.test.ts:360-390`).

MCP accepts a strict, non-empty `{ experienceId }` object
(`apps/admin/src/services/experience-mcp.service.ts:50-52`). Discovery must
match the runtime validator, reject additional properties, and require both
`experience:read` and `experience:create`
(`apps/admin/src/mcp/admin-mcp-tools.ts:234-246`). Dispatch calls the adapter
instead of introducing another copy implementation
(`apps/admin/src/app/mcp/route.ts:177-182`). The result returns the source ID,
destination summary, every copied locale, and an editor URL
(`apps/admin/src/services/experience-mcp.service.ts:220-233`).

### Treat Admin duplication as a saved-state transition

Render Duplicate only for principals with `write:experiences`
(`apps/admin/src/app/dashboard/experiences/[id]/page.tsx:903-907`). Disable it
for changes to any authored editor field, another save/transition, active chat
or generation, or an existing duplicate request
(`apps/admin/src/app/dashboard/experiences/experience-editor.tsx:10178-10184`,
`apps/admin/src/app/dashboard/experiences/experience-editor/duplicate-experience-control.tsx:40-84`).
The dirty predicate covers every locale-authored scalar and blocks
(`apps/admin/src/app/dashboard/experiences/experience-editor.tsx:1666-1680`).
That makes Duplicate mean “copy the latest saved effective Experience,” not an
ambiguous mixture of saved and in-flight content.

On success, preserve the selected locale when possible and fall back to the
first copied locale before navigating
(`apps/admin/src/app/dashboard/experiences/duplicate-experience-action.ts:24-43`).
Map known domain failures to safe messages, hide unknown exception details,
and ignore asynchronous completion after unmount
(`apps/admin/src/app/dashboard/experiences/duplicate-experience-action.ts:44-60`,
`apps/admin/src/app/dashboard/experiences/experience-editor/duplicate-experience-control.tsx:25-79`).

## Why This Matters

A single service-owned mutation gives every caller the same authorization and
lifecycle invariants. The explicit source selection and destination payload
make the copied-data boundary reviewable and prevent a transport-specific clone
from inheriting public state, homepage designation, source ownership, or
derived history.

Lossless validation protects authored content without normalizing it as a side
effect. Adapter parity tests are equally important: MCP has both discovery JSON
Schema and runtime Zod contracts, while GraphQL has Pothos source and generated
checked-in artifacts. Tests at those seams catch drift before clients do
(`apps/admin/src/app/mcp/route.test.ts:235-253`,
`apps/admin/src/app/mcp/route.test.ts:574-650`,
`apps/admin/src/graphql/schema.test.ts:360-390`).

## When to Apply

- One clone operation must be exposed through multiple interfaces.
- The source can be published, archived, multi-locale, or owned by another principal.
- Authored configuration should survive while operational lifecycle state resets.
- A new transport needs duplication: delegate to `ExperienceService.duplicate` and extend parity tests.

Revisit the slug strategy if drafts gain a database uniqueness constraint,
concurrent bulk duplication becomes common, or callers need retry idempotency.

## Examples

A thin adapter translates only its identifier and caller context:

```ts
return ctx.services.experience.duplicate({
  input: { id: String(args.id) },
  user: ctx.user,
})
```

The destination payload separates copied authored fields from reset lifecycle
fields:

```ts
{
  isTemplate: source.isTemplate,
  ownerId: user.id,
  locales: {
    create: sourceLocales.map((locale) => ({
      locale: locale.locale,
      slug: availableDuplicateSlug(
        locale.slug,
        usedSlugsByLocale.get(locale.locale)!,
      ),
      pathSegment: locale.pathSegment,
      title: locale.title,
      metaDescription: locale.metaDescription,
      ogTitle: locale.ogTitle,
      ogDescription: locale.ogDescription,
      ogImageUrl: locale.ogImageUrl,
      blocks: locale.blocks,
      isHomepage: false,
      status: "DRAFT",
      publishedAt: null,
    })),
  },
}
```

## Related

- `docs/solutions/cms/experience-locale-content-revision-draft-gateway.md`
- `docs/solutions/architecture-patterns/oauth-protected-mcp-tool-parity-pattern-20260721.md`
- `docs/solutions/graphql/pothos-relation-abac-filter-required-for-nested-types.md`
- `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
