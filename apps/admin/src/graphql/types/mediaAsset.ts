// Pothos types for media assets managed by Apps admin.
//
// MediaAsset is `@classification abac-gated`: assets may be private, backed
// by local/S3/Mux storage, and are editable by privileged admin principals.
// Raw storage object keys are intentionally not exposed; clients receive
// durable asset IDs and app routes for previews/downloads.

import { builder } from "@/graphql/builder"
import {
  mediaAssetDownloadUrl,
  mediaAssetPreviewUrl,
} from "@/services/media-asset.service"
import type { MediaAssetUsageRow } from "@/services/media-asset.usage"

export const MediaAssetKindEnum = builder.enumType("MediaAssetKind", {
  values: {
    IMAGE: { value: "IMAGE" },
    VIDEO: { value: "VIDEO" },
    PDF: { value: "PDF" },
    FILE: { value: "FILE" },
  } as const,
})

export const MediaAssetBackendEnum = builder.enumType("MediaAssetBackend", {
  values: {
    LOCAL: { value: "LOCAL" },
    S3: { value: "S3" },
    MUX: { value: "MUX" },
  } as const,
})

export const MediaAssetStatusEnum = builder.enumType("MediaAssetStatus", {
  values: {
    PENDING: { value: "PENDING" },
    UPLOADING: { value: "UPLOADING" },
    PROCESSING: { value: "PROCESSING" },
    READY: { value: "READY" },
    FAILED: { value: "FAILED" },
    MISSING: { value: "MISSING" },
  } as const,
})

export const MediaAssetVisibilityEnum = builder.enumType(
  "MediaAssetVisibility",
  {
    values: {
      PRIVATE: { value: "PRIVATE" },
      PUBLIC: { value: "PUBLIC" },
    } as const,
  },
)

const MediaAssetUsageRef = builder
  .objectRef<MediaAssetUsageRow>("MediaAssetUsage")
  .implement({
    description:
      "A structured reference to an experience metadata or block field that uses a media asset.",
    fields: (t) => ({
      experienceId: t.exposeString("experienceId"),
      experienceLocaleId: t.exposeString("experienceLocaleId"),
      locale: t.exposeString("locale"),
      title: t.exposeString("title", { nullable: true }),
      location: t.exposeString("location"),
      fieldPath: t.exposeString("fieldPath"),
      fieldName: t.exposeString("fieldName"),
      value: t.exposeString("value"),
      match: t.exposeString("match"),
    }),
  })

/** @classification abac-gated */
builder.prismaObject("MediaAsset", {
  description:
    "An uploaded image, video, PDF, or file registered in the Apps admin media library.",
  fields: (t) => ({
    id: t.exposeID("id"),
    kind: t.expose("kind", { type: MediaAssetKindEnum }),
    backend: t.expose("backend", { type: MediaAssetBackendEnum }),
    status: t.expose("status", { type: MediaAssetStatusEnum }),
    visibility: t.expose("visibility", { type: MediaAssetVisibilityEnum }),
    displayName: t.exposeString("displayName"),
    description: t.exposeString("description", { nullable: true }),
    altText: t.exposeString("altText", { nullable: true }),
    mimeType: t.exposeString("mimeType"),
    byteSize: t.string({
      nullable: true,
      resolve: (row) => row.byteSize?.toString() ?? null,
    }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    durationMs: t.string({
      nullable: true,
      resolve: (row) => row.durationMs?.toString() ?? null,
    }),
    originalFilename: t.exposeString("originalFilename", { nullable: true }),
    checksumSha256: t.exposeString("checksumSha256", { nullable: true }),
    folderId: t.exposeID("folderId", { nullable: true }),
    previewUrl: t.string({
      nullable: true,
      resolve: (row) => mediaAssetPreviewUrl(row),
    }),
    downloadUrl: t.string({
      nullable: true,
      resolve: (row) => mediaAssetDownloadUrl(row),
    }),
    editUrl: t.string({
      resolve: (row) => `/dashboard/media?asset=${row.id}`,
    }),
    createdById: t.exposeID("createdById", { nullable: true }),
    createdAt: t.string({ resolve: (row) => row.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

builder.queryFields((t) => ({
  mediaAsset: t.prismaField({
    type: "MediaAsset",
    nullable: true,
    authScopes: { hasPermission: "read:media-assets" },
    description: "Fetch a single media asset by id.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.mediaAsset.getById({
        id: String(args.id),
        user: ctx.user,
        query,
      }),
  }),
  mediaAssets: t.prismaField({
    type: ["MediaAsset"],
    authScopes: { hasPermission: "read:media-assets" },
    description: "List media assets ordered by most recent update.",
    args: {
      kind: t.arg({ type: MediaAssetKindEnum, required: false }),
      backend: t.arg({ type: MediaAssetBackendEnum, required: false }),
      status: t.arg({ type: MediaAssetStatusEnum, required: false }),
      folderId: t.arg.id({ required: false }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false, defaultValue: 50 }),
      offset: t.arg.int({ required: false, defaultValue: 0 }),
    },
    resolve: (query, _root, args, ctx) =>
      ctx.services.mediaAsset.list({
        input: {
          ...(args.kind != null ? { kind: args.kind } : {}),
          ...(args.backend != null ? { backend: args.backend } : {}),
          ...(args.status != null ? { status: args.status } : {}),
          ...(args.folderId != null ? { folderId: String(args.folderId) } : {}),
          ...(args.search != null ? { search: args.search } : {}),
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        },
        user: ctx.user,
        query,
      }),
  }),
  mediaAssetUsage: t.field({
    type: [MediaAssetUsageRef],
    authScopes: { hasPermission: "read:media-assets" },
    description:
      "List experience metadata and block fields that currently reference a media asset.",
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.mediaAsset.usage({
        id: String(args.id),
        user: ctx.user,
      }),
  }),
}))
