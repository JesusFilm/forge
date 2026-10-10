import { builder } from "@/graphql/builder"

/** @classification abac-gated */
builder.prismaObject("MediaFolder", {
  description:
    "A logical folder used to organize media assets in the Apps admin library.",
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    parentId: t.exposeID("parentId", { nullable: true }),
    createdById: t.exposeID("createdById", { nullable: true }),
    editUrl: t.string({
      resolve: (row) => `/dashboard/media?folder=${row.id}`,
    }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

builder.queryFields((t) => ({
  mediaFolders: t.prismaField({
    type: ["MediaFolder"],
    authScopes: { hasPermission: "read:media-assets" },
    description: "List media folders ordered for tree rendering.",
    resolve: (query, _root, _args, ctx) =>
      ctx.services.mediaFolder.list({
        input: {},
        user: ctx.user,
        query,
      }),
  }),
}))
