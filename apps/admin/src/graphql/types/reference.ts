// Pothos types for Core-sourced reference data.
//
// Classification: every type here is `@classification public-shape`. Rows
// are Core-sourced, read-only at the GraphQL layer in v1 (no mutations),
// and safe to expose via `t.relation` from other types. Permission
// enforcement at the service layer is minimal — public reads are fine once
// the auth middleware has extracted a principal.
//
// Naming mirrors Strapi for consumer migration (`languages`, `language`,
// `countries`, etc.) — see R23 and the "shared-entity naming" decision.
//
// Per Unit 4 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { GraphQLScalarType, Kind } from "graphql"
import { builder } from "@/graphql/builder"

// -----------------------------------------------------------------------------
// JSON scalar — used for localized `name` maps ({ en: "...", es: "..." })
// and block arrays. Passes through validated values unchanged.
// -----------------------------------------------------------------------------

/**
 * Generic JSON scalar. Parse values as-is (the service layer validates with
 * Zod before anything reaches a resolver). Serializes any JSON-compatible
 * value on the way out.
 *
 * Registered on the builder's `Scalars.JSON` slot so fields reference it as
 * `type: "JSON"` — see `src/graphql/builder.ts`.
 */
const JSONScalarGraphQL = new GraphQLScalarType({
  name: "JSON",
  description:
    "Arbitrary JSON value. Consumer types narrow this with a locale map or block union on the client.",
  parseValue: (value) => value,
  serialize: (value) => value,
  parseLiteral: (ast): unknown => {
    const walk = (node: typeof ast): unknown => {
      switch (node.kind) {
        case Kind.STRING:
        case Kind.BOOLEAN:
        case Kind.ENUM:
          return node.value
        case Kind.INT:
        case Kind.FLOAT:
          return Number(node.value)
        case Kind.OBJECT:
          return Object.fromEntries(
            node.fields.map((f) => [f.name.value, walk(f.value)]),
          )
        case Kind.LIST:
          return node.values.map(walk)
        case Kind.NULL:
          return null
        default:
          return null
      }
    }
    return walk(ast)
  },
})

builder.addScalarType("JSON", JSONScalarGraphQL, {})

// -----------------------------------------------------------------------------
// Shared enums — registered once so multiple type modules can reference them
// without registering duplicates under different GraphQL names.
// -----------------------------------------------------------------------------

/** Per-locale publish state (mirrors Prisma `LocaleStatus`). */
export const LocaleStatusEnum = builder.enumType("LocaleStatus", {
  values: {
    DRAFT: { value: "DRAFT" },
    PUBLISHED: { value: "PUBLISHED" },
    ARCHIVED: { value: "ARCHIVED" },
  } as const,
})

// -----------------------------------------------------------------------------
// Language
// -----------------------------------------------------------------------------

/** @classification public-shape */
builder.prismaObject("Language", {
  description: "A spoken/written language synced from JesusFilm Core.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    /**
     * Localized display names keyed by locale code, e.g. {"en":"English"}.
     * Consumers pick by requested locale; no single `name` field is exposed.
     */
    name: t.field({
      type: "JSON",
      resolve: (row) => row.name,
    }),
    bcp47: t.exposeString("bcp47", { nullable: true }),
    iso3: t.exposeString("iso3", { nullable: true }),
    slug: t.exposeString("slug", { nullable: true }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

// -----------------------------------------------------------------------------
// Continent + Country
// -----------------------------------------------------------------------------

/** @classification public-shape */
builder.prismaObject("Continent", {
  description: "A continent synced from Core.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.field({ type: "JSON", resolve: (row) => row.name }),
    slug: t.exposeString("slug", { nullable: true }),
  }),
})

/** @classification public-shape */
builder.prismaObject("Country", {
  description: "A country synced from Core.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    name: t.field({ type: "JSON", resolve: (row) => row.name }),
    population: t.exposeInt("population", { nullable: true }),
    latitude: t.exposeFloat("latitude", { nullable: true }),
    longitude: t.exposeFloat("longitude", { nullable: true }),
    flagPngSrc: t.exposeString("flagPngSrc", { nullable: true }),
    flagWebpSrc: t.exposeString("flagWebpSrc", { nullable: true }),
    continent: t.relation("continent", { nullable: true }),
  }),
})

// -----------------------------------------------------------------------------
// Keyword
// -----------------------------------------------------------------------------

/** @classification public-shape */
builder.prismaObject("Keyword", {
  description: "A searchable keyword tag attached to videos.",
  fields: (t) => ({
    id: t.exposeID("id"),
    coreId: t.exposeString("coreId"),
    value: t.exposeString("value"),
    language: t.relation("language", { nullable: true }),
  }),
})

// -----------------------------------------------------------------------------
// Root queries — reference data (authenticated reads; Unit 6 widens to PUBLIC
// for appropriate operations once the tier model is finalized).
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  languages: t.prismaField({
    type: ["Language"],
    authScopes: { loggedIn: true },
    description: "List active (non-soft-deleted) languages.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 100 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.language.findMany({
        ...query,
        where: { deletedAt: null },
        orderBy: { slug: "asc" },
        take: Math.min(args.limit ?? 100, 500),
        skip: args.offset ?? 0,
      }),
  }),
  countries: t.prismaField({
    type: ["Country"],
    authScopes: { loggedIn: true },
    description: "List active (non-soft-deleted) countries.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 250 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.country.findMany({
        ...query,
        where: { deletedAt: null },
        take: Math.min(args.limit ?? 250, 500),
        skip: args.offset ?? 0,
      }),
  }),
  keywords: t.prismaField({
    type: ["Keyword"],
    authScopes: { loggedIn: true },
    description: "List active (non-soft-deleted) keywords.",
    args: {
      limit: t.arg.int({ required: false, defaultValue: 100 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.prisma.keyword.findMany({
        ...query,
        where: { deletedAt: null },
        orderBy: { value: "asc" },
        take: Math.min(args.limit ?? 100, 500),
        skip: args.offset ?? 0,
      }),
  }),
}))
