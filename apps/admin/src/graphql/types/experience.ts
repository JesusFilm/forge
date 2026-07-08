// Pothos types for Experience and ExperienceLocale (abac-gated).
// Embedding column is intentionally excluded (R20). Per Unit 4 of
// docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import type { Block } from "@/domain/blocks"
import { isEditorOrAdmin } from "@/auth/principal"
import { builder } from "@/graphql/builder"
import { ExperienceBlock } from "@/graphql/types/blocks"
import { LocaleStatusEnum } from "@/graphql/types/reference"

// PUBLIC field-strip triplet (consumer-migration U2 — 2026-05-11). The
// `unauthorizedResolver: () => null` overrides Pothos scope-auth's default
// throw so anonymous callers get null without populating `errors[]` — the
// U5 parity comparator (PR #915) inspects both `data` and `errors[]`.

const STRIPPED_FOR_PUBLIC = {
  nullable: true as const,
  authScopes: { hasPermission: "read:experiences" as const },
  unauthorizedResolver: () => null,
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
    // Stripped for PUBLIC so anonymous callers cannot enumerate homepage flags.
    isHomepage: t.exposeBoolean("isHomepage", { ...STRIPPED_FOR_PUBLIC }),
    pathSegment: t.exposeString("pathSegment", { nullable: true }),
    title: t.exposeString("title", { nullable: true }),
    metaDescription: t.exposeString("metaDescription", { nullable: true }),
    ogTitle: t.exposeString("ogTitle", { nullable: true }),
    ogDescription: t.exposeString("ogDescription", { nullable: true }),
    ogImageUrl: t.exposeString("ogImageUrl", { nullable: true }),
    blocks: t.field({
      // `t.field` (NOT `t.prismaField`) because the underlying value is a JSON
      // column projected to a typed union, not a Prisma model relation. The
      // Zod `BlockSchema` is the write-time contract; the union here is the
      // read-time contract that mirrors it. Drift between the two is caught
      // by `src/graphql/types/blocks.drift.test.ts`.
      type: [ExperienceBlock],
      nullable: false,
      description:
        "Array of Experience blocks. Shape mirrors `src/domain/blocks.ts` BlockSchema (Zod). Mutations still accept opaque JSON; only the query output is typed.",
      resolve: async (row, _args, ctx) =>
        (await ctx.services.mediaAsset.hydratePublicUrlsInBlocks(
          row.blocks,
        )) as Block[],
    }),
    status: t.expose("status", { type: LocaleStatusEnum }),
    publishedAt: t.string({
      nullable: true,
      resolve: (row) => row.publishedAt?.toISOString() ?? null,
    }),
    createdAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.updatedAt.toISOString(),
    }),
  }),
})

/** @classification abac-gated */
builder.prismaObject("Experience", {
  description:
    "A page-builder Experience. Per-locale content lives in ExperienceLocale. Embedding vector is stored here but never exposed via GraphQL.",
  fields: (t) => ({
    id: t.exposeID("id"),
    isTemplate: t.exposeBoolean("isTemplate", { ...STRIPPED_FOR_PUBLIC }),
    ownerId: t.exposeID("ownerId", { ...STRIPPED_FOR_PUBLIC }),
    archivedAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.archivedAt?.toISOString() ?? null,
    }),
    createdAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.updatedAt.toISOString(),
    }),
    locales: t.relation("locales", {
      description: "VIEWER/PUBLIC see PUBLISHED only; EDITOR/ADMIN see all.",
      query: (_args, ctx) =>
        isEditorOrAdmin(ctx.user) ? {} : { where: { status: "PUBLISHED" } },
    }),
  }),
})

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
