// Unit 3 spike types — THROWAWAY, deleted in Unit 4.
//
// Purpose: exercise the full Pothos + Prisma + scope-auth stack end-to-end
// so we can verify on a real DB that:
//   - `...query` passthrough generates a single SQL JOIN for nested relation
//   - scope-auth blocks unauthorized requests at the type/field boundary
//   - public-opt-in fields bypass default-deny
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { builder } from "@/graphql/builder"

builder.prismaObject("PingChild", {
  fields: (t) => ({
    id: t.exposeID("id"),
    label: t.exposeString("label"),
  }),
})

builder.prismaObject("Ping", {
  fields: (t) => ({
    id: t.exposeID("id"),
    message: t.exposeString("message"),
    isPublic: t.exposeBoolean("isPublic"),
    /**
     * Nested relation — Pothos Prisma plugin collapses the selection into
     * the parent Prisma query's `include`, producing a single JOIN.
     */
    children: t.relation("children"),
  }),
})

// Root queries. `pingPublic` is opt-in PUBLIC (verifies scope-auth opt-in).
// `pingAll` requires `loggedIn` (verifies default-deny denial at the field).
builder.queryFields((t) => ({
  pingPublic: t.prismaField({
    type: "Ping",
    nullable: true,
    authScopes: { loggedIn: false },
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (query, _root, args, ctx) =>
      ctx.prisma.ping.findUnique({
        ...query,
        where: { id: String(args.id), isPublic: true },
      }),
  }),
  pingAll: t.prismaField({
    type: ["Ping"],
    authScopes: { loggedIn: true },
    resolve: async (query, _root, _args, ctx) =>
      ctx.prisma.ping.findMany({
        ...query,
        orderBy: { createdAt: "desc" },
      }),
  }),
}))
