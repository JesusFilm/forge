import { builder } from "@/graphql/builder"
import type { MediaFolderDeleteResult } from "@/services/media-folder.service"

const DeleteMediaFolderResultRef = builder
  .objectRef<MediaFolderDeleteResult>("DeleteMediaFolderResult")
  .implement({
    fields: (t) => ({
      deleted: t.exposeBoolean("deleted"),
      childCount: t.exposeInt("childCount"),
      assetCount: t.exposeInt("assetCount"),
    }),
  })

builder.mutationFields((t) => ({
  createMediaFolder: t.prismaField({
    type: "MediaFolder",
    authScopes: { hasPermission: "write:media-assets" },
    description: "Create a media folder at the root or inside another folder.",
    args: {
      name: t.arg.string({ required: true }),
      parentId: t.arg.id({ required: false }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.mediaFolder.create({
        input: {
          name: args.name,
          ...(args.parentId != null ? { parentId: String(args.parentId) } : {}),
        },
        user: ctx.user,
      }),
  }),

  updateMediaFolder: t.prismaField({
    type: "MediaFolder",
    authScopes: { hasPermission: "write:media-assets" },
    description: "Rename a media folder.",
    args: {
      id: t.arg.id({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.mediaFolder.update({
        input: {
          id: String(args.id),
          name: args.name,
        },
        user: ctx.user,
      }),
  }),

  deleteMediaFolder: t.field({
    type: DeleteMediaFolderResultRef,
    authScopes: { hasPermission: "delete:media-assets" },
    description:
      "Delete an empty media folder. Fails when child folders or assets remain.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.mediaFolder.delete({
        input: { id: String(args.id) },
        user: ctx.user,
      }),
  }),
}))
