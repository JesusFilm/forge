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

export const MediaImageEnrichmentStatusEnum = builder.enumType(
  "MediaImageEnrichmentStatus",
  {
    values: {
      WAITING: { value: "WAITING" },
      PROCESSING: { value: "PROCESSING" },
      COMPLETE: { value: "COMPLETE" },
      FAILED: { value: "FAILED" },
      SKIPPED: { value: "SKIPPED" },
    } as const,
  },
)

export const MediaAssetLocaleStatusEnum = builder.enumType(
  "MediaAssetLocaleStatus",
  {
    values: {
      WAITING: { value: "WAITING" },
      PROCESSING: { value: "PROCESSING" },
      COMPLETE: { value: "COMPLETE" },
      FAILED: { value: "FAILED" },
      SKIPPED: { value: "SKIPPED" },
    } as const,
  },
)

export const MediaAssetVisibilityEnum = builder.enumType(
  "MediaAssetVisibility",
  {
    values: {
      PRIVATE: { value: "PRIVATE" },
      PUBLIC: { value: "PUBLIC" },
    } as const,
  },
)

/** @classification abac-gated */
builder.prismaObject("MediaAssetLocale", {
  description:
    "Localized display name and alt text for an uploaded media asset, including AI provenance and human override locks.",
  fields: (t) => ({
    id: t.exposeID("id"),
    mediaAssetId: t.exposeID("mediaAssetId"),
    locale: t.exposeString("locale"),
    displayName: t.exposeString("displayName", { nullable: true }),
    altText: t.exposeString("altText", { nullable: true }),
    displayNameSource: t.string({
      nullable: true,
      resolve: (row) => row.displayNameSource ?? null,
    }),
    altTextSource: t.string({
      nullable: true,
      resolve: (row) => row.altTextSource ?? null,
    }),
    displayNameLocked: t.exposeBoolean("displayNameLocked"),
    altTextLocked: t.exposeBoolean("altTextLocked"),
    status: t.expose("status", { type: MediaAssetLocaleStatusEnum }),
    errorCode: t.exposeString("errorCode", { nullable: true }),
    errorMessage: t.exposeString("errorMessage", { nullable: true }),
    generatedAt: t.string({
      nullable: true,
      resolve: (row) => row.generatedAt?.toISOString() ?? null,
    }),
    updatedAt: t.string({ resolve: (row) => row.updatedAt.toISOString() }),
  }),
})

const MediaAssetUsageRef = builder
  .objectRef<MediaAssetUsageRow>("MediaAssetUsage")
  .implement({
    description:
      "A structured reference to an experience or video locale field that uses a media asset.",
    fields: (t) => ({
      experienceId: t.exposeString("experienceId", { nullable: true }),
      experienceLocaleId: t.exposeString("experienceLocaleId", {
        nullable: true,
      }),
      resourceType: t.exposeString("resourceType"),
      resourceId: t.exposeString("resourceId"),
      resourceLocaleId: t.exposeString("resourceLocaleId"),
      locale: t.exposeString("locale"),
      title: t.exposeString("title", { nullable: true }),
      editUrl: t.exposeString("editUrl"),
      recoverable: t.exposeBoolean("recoverable"),
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
    mimeType: t.exposeString("mimeType"),
    byteSize: t.string({
      nullable: true,
      resolve: (row) => row.byteSize?.toString() ?? null,
    }),
    width: t.exposeInt("width", { nullable: true }),
    height: t.exposeInt("height", { nullable: true }),
    blurDataUrl: t.exposeString("blurDataUrl", { nullable: true }),
    dominantColor: t.exposeString("dominantColor", { nullable: true }),
    imageEnrichmentStatus: t.expose("imageEnrichmentStatus", {
      type: MediaImageEnrichmentStatusEnum,
    }),
    imageEnrichmentErrorCode: t.exposeString("imageEnrichmentErrorCode", {
      nullable: true,
    }),
    imageEnrichmentErrorMessage: t.exposeString("imageEnrichmentErrorMessage", {
      nullable: true,
    }),
    imageEnrichmentStartedAt: t.string({
      nullable: true,
      resolve: (row) => row.imageEnrichmentStartedAt?.toISOString() ?? null,
    }),
    imageEnrichmentCompletedAt: t.string({
      nullable: true,
      resolve: (row) => row.imageEnrichmentCompletedAt?.toISOString() ?? null,
    }),
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
    locales: t.relation("locales"),
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
      "List experience and video locale fields that currently reference a media asset.",
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
