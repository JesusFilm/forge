// Pothos types for Experience and ExperienceLocale.
//
// Classification: both types are `@classification abac-gated`. Ownership +
// publish state apply (see canEditExperience / canViewExperience helpers in
// Unit 6). Per the architectural tension resolution in the plan, access to
// abac-gated types from a nested relation MUST route through a service
// resolver that re-applies the ABAC WHERE — DO NOT add `t.relation` pointing
// at Experience or ExperienceLocale from another Pothos type without wrapping
// it in a service call. (See parity test coming in Unit 6.)
//
// Embedding vector EXCLUDED from this type by explicit field list — the
// exclusion is a technical control, not a naming convention (R20). Unit 9
// adds a resolver-surface test that walks every field and asserts no
// 1536-length numeric array leaks.
//
// Blocks exposed as the generic JSON scalar. The Zod discriminated union in
// src/domain/blocks.ts validates writes; on reads the shape is whatever was
// written (agent-extensibility goal — adding a block type doesn't touch the
// schema).
//
// Per Unit 4 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"
// Import for side effect: registers the JSON scalar on the builder so this
// module can reference `type: "JSON"` below. Also exports `LocaleStatusEnum`.
import { LocaleStatusEnum } from "@/graphql/types/reference"

function collectVideoIdsFromBlocks(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectVideoIdsFromBlocks(entry, ids)
    return ids
  }

  if (!value || typeof value !== "object") return ids

  const record = value as Record<string, unknown>
  if (typeof record.videoId === "string" && record.videoId.trim()) {
    ids.add(record.videoId)
  }

  for (const entry of Object.values(record)) {
    collectVideoIdsFromBlocks(entry, ids)
  }

  return ids
}

// -----------------------------------------------------------------------------
// ExperienceLocale
// -----------------------------------------------------------------------------

/** @classification abac-gated */
builder.prismaObject("ExperienceLocale", {
  description:
    "Per-locale content for an Experience — slug, blocks, title, publish state. Editors publish locales independently.",
  fields: (t) => ({
    id: t.exposeID("id"),
    experienceId: t.exposeID("experienceId"),
    locale: t.exposeString("locale"),
    slug: t.exposeString("slug"),
    isHomepage: t.exposeBoolean("isHomepage"),
    pathSegment: t.exposeString("pathSegment", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    metaDescription: t.exposeString("metaDescription", { nullable: true }),
    ogTitle: t.exposeString("ogTitle", { nullable: true }),
    ogDescription: t.exposeString("ogDescription", { nullable: true }),
    ogImageUrl: t.exposeString("ogImageUrl", { nullable: true }),
    /**
     * Block array — JSON scalar. Writes are validated by `BlocksSchema` in
     * `src/domain/blocks.ts` before persistence. Reads return whatever was
     * persisted; the GraphQL schema stays stable as block types evolve.
     */
    blocks: t.field({
      type: "JSON",
      description:
        "Array of Experience blocks. Schema shape enforced at write time by the domain Zod union; see `src/domain/blocks.ts`.",
      resolve: (row) => row.blocks,
    }),
    referencedVideos: t.prismaField({
      type: ["Video"],
      authScopes: { public: true },
      description:
        "Videos referenced by this locale's JSON blocks. Used by public preview renderers to hydrate admin-authored videoId refs without exposing arbitrary video lookups.",
      resolve: (query, row, _args, ctx) => {
        const ids = Array.from(collectVideoIdsFromBlocks(row.blocks))
        if (ids.length === 0) return []

        return ctx.prisma.video.findMany({
          ...query,
          where: {
            id: { in: ids },
            deletedAt: null,
          },
        })
      },
    }),
    status: t.expose("status", { type: LocaleStatusEnum }),
    publishedAt: t.string({
      nullable: true,
      resolve: (row) => row.publishedAt?.toISOString() ?? null,
    }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

// -----------------------------------------------------------------------------
// Experience
//
// Intentional omissions:
//   - `embedding` — NEVER exposed. Excluded by field list; Unit 9 adds a
//     resolver-surface test that proves no field of this type ever returns
//     a 1536-length numeric array even indirectly.
// -----------------------------------------------------------------------------

/** @classification abac-gated */
builder.prismaObject("Experience", {
  description:
    "A page-builder Experience. Canonical row holds non-localized state; per-locale content (slug, blocks, title) lives in ExperienceLocale. Embedding vector is stored here but NEVER exposed via GraphQL.",
  fields: (t) => ({
    id: t.exposeID("id"),
    isTemplate: t.exposeBoolean("isTemplate"),
    ownerId: t.exposeID("ownerId", { nullable: true }),
    archivedAt: t.string({
      nullable: true,
      resolve: (row) => row.archivedAt?.toISOString() ?? null,
    }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
    locales: t.relation("locales", {
      description:
        "Per-locale ExperienceLocale rows. ABAC-filtered: VIEWER/PUBLIC see PUBLISHED only.",
      query: (_args, ctx) =>
        ctx.user?.role === "ADMIN" || ctx.user?.role === "EDITOR"
          ? {}
          : { where: { status: "PUBLISHED" } },
    }),
  }),
})

// -----------------------------------------------------------------------------
// Root queries — delegate to ExperienceService for ABAC filtering.
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  experience: t.prismaField({
    type: "Experience",
    nullable: true,
    authScopes: { hasPermission: "read:experiences" },
    description: "Fetch a single Experience by id. ABAC-filtered.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.experience.getById({
        id: String(args.id),
        user: ctx.user,
        query,
      }),
  }),
  experiences: t.prismaField({
    type: ["Experience"],
    authScopes: { hasPermission: "read:experiences" },
    description: "List Experiences. ABAC-filtered.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
      includeArchived: t.arg.boolean({
        required: false,
        defaultValue: false,
      }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.experience.list({
        input: {
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
          includeArchived: args.includeArchived ?? false,
        },
        user: ctx.user,
        query,
      }),
  }),
  experienceBySlug: t.prismaField({
    type: "ExperienceLocale",
    nullable: true,
    authScopes: { public: true },
    description:
      "Find an Experience locale by (locale, slug). PUBLIC sees published only; EDITOR/ADMIN see all.",
    args: {
      locale: t.arg.string({ required: true }),
      slug: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.experience.getBySlug({
        locale: args.locale,
        slug: args.slug,
        user: ctx.user,
        query,
      }),
  }),
}))
