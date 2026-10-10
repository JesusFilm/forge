// Media asset mutations. Resolvers are thin wiring; MediaAssetService owns
// permission checks, validation, storage-shape rules, and Prisma writes.

import { builder } from "@/graphql/builder"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  MediaAssetBackendEnum,
  MediaAssetKindEnum,
  MediaAssetStatusEnum,
  MediaAssetVisibilityEnum,
} from "@/graphql/types/mediaAsset"
import { runMediaImageEnrichment } from "@/workflows/mediaImageEnrichment"
import { start } from "workflow/api"

type DeleteMediaAssetResult = {
  deleted: boolean
  usageCount: number
}

const DeleteMediaAssetResultRef = builder
  .objectRef<DeleteMediaAssetResult>("DeleteMediaAssetResult")
  .implement({
    fields: (t) => ({
      deleted: t.exposeBoolean("deleted"),
      usageCount: t.exposeInt("usageCount"),
    }),
  })

builder.mutationFields((t) => ({
  registerMediaAsset: t.prismaField({
    type: "MediaAsset",
    authScopes: { hasPermission: "write:media-assets" },
    description:
      "Register an uploaded file in the media library after its bytes are stored.",
    args: {
      kind: t.arg({ type: MediaAssetKindEnum, required: true }),
      backend: t.arg({ type: MediaAssetBackendEnum, required: false }),
      status: t.arg({ type: MediaAssetStatusEnum, required: false }),
      visibility: t.arg({ type: MediaAssetVisibilityEnum, required: false }),
      mimeType: t.arg.string({ required: true }),
      folderId: t.arg.id({ required: false }),
      byteSize: t.arg.string({ required: false }),
      width: t.arg.int({ required: false }),
      height: t.arg.int({ required: false }),
      durationMs: t.arg.string({ required: false }),
      originalFilename: t.arg.string({ required: false }),
      checksumSha256: t.arg.string({ required: false }),
      muxAssetId: t.arg.string({ required: false }),
      muxUploadId: t.arg.string({ required: false }),
      muxPlaybackId: t.arg.string({ required: false }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.mediaAsset.create({
        input: {
          kind: args.kind,
          ...(args.backend != null ? { backend: args.backend } : {}),
          ...(args.status != null ? { status: args.status } : {}),
          ...(args.visibility != null ? { visibility: args.visibility } : {}),
          mimeType: args.mimeType,
          ...(args.folderId != null ? { folderId: String(args.folderId) } : {}),
          ...(args.byteSize != null ? { byteSize: args.byteSize } : {}),
          ...(args.width != null ? { width: args.width } : {}),
          ...(args.height != null ? { height: args.height } : {}),
          ...(args.durationMs != null ? { durationMs: args.durationMs } : {}),
          ...(args.originalFilename !== undefined
            ? { originalFilename: args.originalFilename }
            : {}),
          ...(args.checksumSha256 !== undefined
            ? { checksumSha256: args.checksumSha256 }
            : {}),
          ...(args.muxAssetId !== undefined
            ? { muxAssetId: args.muxAssetId }
            : {}),
          ...(args.muxUploadId !== undefined
            ? { muxUploadId: args.muxUploadId }
            : {}),
          ...(args.muxPlaybackId !== undefined
            ? { muxPlaybackId: args.muxPlaybackId }
            : {}),
        },
        user: ctx.user,
      }),
  }),

  updateMediaAsset: t.prismaField({
    type: "MediaAsset",
    authScopes: { hasPermission: "write:media-assets" },
    description: "Update editable media asset metadata and processing state.",
    args: {
      id: t.arg.id({ required: true }),
      status: t.arg({ type: MediaAssetStatusEnum, required: false }),
      visibility: t.arg({ type: MediaAssetVisibilityEnum, required: false }),
      folderId: t.arg.id({ required: false }),
      byteSize: t.arg.string({ required: false }),
      width: t.arg.int({ required: false }),
      height: t.arg.int({ required: false }),
      durationMs: t.arg.string({ required: false }),
      originalFilename: t.arg.string({ required: false }),
      checksumSha256: t.arg.string({ required: false }),
      muxAssetId: t.arg.string({ required: false }),
      muxUploadId: t.arg.string({ required: false }),
      muxPlaybackId: t.arg.string({ required: false }),
      errorCode: t.arg.string({ required: false }),
      errorMessage: t.arg.string({ required: false }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.mediaAsset.update({
        input: {
          id: String(args.id),
          ...(args.status != null ? { status: args.status } : {}),
          ...(args.visibility != null ? { visibility: args.visibility } : {}),
          ...(args.folderId !== undefined
            ? { folderId: args.folderId ? String(args.folderId) : null }
            : {}),
          ...(args.byteSize != null ? { byteSize: args.byteSize } : {}),
          ...(args.width != null ? { width: args.width } : {}),
          ...(args.height != null ? { height: args.height } : {}),
          ...(args.durationMs != null ? { durationMs: args.durationMs } : {}),
          ...(args.originalFilename !== undefined
            ? { originalFilename: args.originalFilename }
            : {}),
          ...(args.checksumSha256 !== undefined
            ? { checksumSha256: args.checksumSha256 }
            : {}),
          ...(args.muxAssetId !== undefined
            ? { muxAssetId: args.muxAssetId }
            : {}),
          ...(args.muxUploadId !== undefined
            ? { muxUploadId: args.muxUploadId }
            : {}),
          ...(args.muxPlaybackId !== undefined
            ? { muxPlaybackId: args.muxPlaybackId }
            : {}),
          ...(args.errorCode !== undefined
            ? { errorCode: args.errorCode }
            : {}),
          ...(args.errorMessage !== undefined
            ? { errorMessage: args.errorMessage }
            : {}),
        },
        user: ctx.user,
      }),
  }),

  deleteMediaAsset: t.field({
    type: DeleteMediaAssetResultRef,
    authScopes: { hasPermission: "delete:media-assets" },
    description:
      "Delete a media asset only when no experience or video locale fields still reference it.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.mediaAsset.delete({
        id: String(args.id),
        user: ctx.user,
      }),
  }),

  updateMediaAssetLocale: t.prismaField({
    type: "MediaAssetLocale",
    authScopes: { hasPermission: "write:media-assets" },
    description:
      "Edit localized media display name or alt text. Edited fields become human-protected and are not overwritten by future AI retries.",
    args: {
      mediaAssetId: t.arg.id({ required: true }),
      locale: t.arg.string({ required: true }),
      displayName: t.arg.string({ required: false }),
      altText: t.arg.string({ required: false }),
    },
    resolve: (_query, _root, args, ctx) =>
      ctx.services.mediaAsset.updateImageLocale({
        input: {
          mediaAssetId: String(args.mediaAssetId),
          locale: args.locale,
          ...(args.displayName !== undefined
            ? { displayName: args.displayName }
            : {}),
          ...(args.altText !== undefined ? { altText: args.altText } : {}),
        },
        user: ctx.user,
      }),
  }),

  triggerMediaImageEnrichment: t.prismaField({
    type: "MediaAsset",
    authScopes: { hasPermission: "write:media-assets" },
    description:
      "Queue or retry image enrichment for a media asset. Human-protected localized fields are preserved by the workflow.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (query, _root, args, ctx) => {
      const mediaAssetId = String(args.id)
      await ctx.services.mediaAsset.updateImageEnrichmentState({
        mediaAssetId,
        user: SYSTEM_PRINCIPAL,
        data: {
          imageEnrichmentStatus: "WAITING",
          imageEnrichmentErrorCode: null,
          imageEnrichmentErrorMessage: null,
          imageEnrichmentCompletedAt: null,
        },
      })

      try {
        await start(runMediaImageEnrichment, [{ mediaAssetId }])
      } catch (error) {
        await ctx.services.mediaAsset.updateImageEnrichmentState({
          mediaAssetId,
          user: SYSTEM_PRINCIPAL,
          data: {
            imageEnrichmentStatus: "FAILED",
            imageEnrichmentErrorCode: "workflow_dispatch_failed",
            imageEnrichmentErrorMessage:
              error instanceof Error ? error.message : String(error),
            imageEnrichmentCompletedAt: new Date(),
          },
        })
      }

      const asset = await ctx.services.mediaAsset.getById({
        id: mediaAssetId,
        user: ctx.user,
        query,
      })
      if (!asset) {
        throw new Error("Media asset not found")
      }
      return asset
    },
  }),
}))
