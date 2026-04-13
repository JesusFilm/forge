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
// module can reference `type: "JSON"` below.
import "@/graphql/types/reference"

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
    status: t.expose("status", {
      type: builder.enumType("ExperienceLocaleStatus", {
        values: {
          DRAFT: { value: "DRAFT" },
          PUBLISHED: { value: "PUBLISHED" },
          ARCHIVED: { value: "ARCHIVED" },
        } as const,
      }),
    }),
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
    /**
     * Per-locale rows. Unit 6 will route this relation through a service
     * resolver that re-applies ABAC (e.g., EDITOR sees only their own draft
     * locales plus any published locale). For now it's a direct relation —
     * Unit 6 is where the parity test catches the bypass risk.
     */
    locales: t.relation("locales", {
      description:
        "Per-locale ExperienceLocale rows. Editors publish locales independently.",
    }),
  }),
})

// -----------------------------------------------------------------------------
// Root queries — direct lookups only. Full CRUD lands in Unit 7 once the
// service layer + permission matrix are in place.
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  experience: t.prismaField({
    type: "Experience",
    nullable: true,
    authScopes: { loggedIn: true },
    description:
      "Fetch a single Experience by id. Unit 6 swaps in ABAC (owner / published-only for VIEWER).",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.experience.findFirst({
        ...query,
        where: { id: String(args.id) },
      }),
  }),
  experiences: t.prismaField({
    type: ["Experience"],
    authScopes: { loggedIn: true },
    description: "List Experiences. Unit 6 applies ABAC filtering.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
      includeArchived: t.arg.boolean({
        required: false,
        defaultValue: false,
        description:
          "When true, include archived Experiences. Default excludes them.",
      }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.experience.findMany({
        ...query,
        where: args.includeArchived ? {} : { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: Math.min(args.limit ?? 50, 200),
        skip: args.offset ?? 0,
      }),
  }),
  experienceBySlug: t.prismaField({
    type: "ExperienceLocale",
    nullable: true,
    authScopes: { loggedIn: true },
    description:
      "Find a published Experience locale by (locale, slug). Unit 6 loosens to PUBLIC for published rows.",
    args: {
      locale: t.arg.string({ required: true }),
      slug: t.arg.string({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.experienceLocale.findFirst({
        ...query,
        where: {
          locale: args.locale,
          slug: args.slug,
          status: "PUBLISHED",
        },
      }),
  }),
}))
