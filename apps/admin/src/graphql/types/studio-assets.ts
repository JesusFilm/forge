import { builder } from "@/graphql/builder"
import { StudioAssetService } from "@/services/studio-authoring/assets"
import { ContentPackService } from "@/services/studio-authoring/packs"
import { StudioSourceService } from "@/services/studio-authoring/sources"
import { StudioTransferService } from "@/services/studio-authoring/transfers"
import { StudioExperimentService } from "@/services/studio-authoring/experiments"
import type { StudioAssetReference } from "@forge/studio-contracts"
import type { StudioAssetVersion } from "@forge/studio-contracts/assets"
import type { StudioSourceSnapshot } from "@forge/studio-contracts/sources"
import type { ContentPackRevision } from "@prisma/client"

/** @classification abac-gated */
const reference = builder
  .objectRef<StudioAssetReference>("ShortsAssetReference")
  .implement({
    fields: (t) => ({
      assetId: t.exposeID("assetId"),
      versionId: t.exposeID("versionId"),
      digest: t.exposeString("digest"),
    }),
  })
/** @classification abac-gated */
const asset = builder
  .objectRef<StudioAssetVersion>("ShortsAssetVersion")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      reference: t.field({ type: reference, resolve: (r) => r.reference }),
      mediaAssetId: t.exposeID("mediaAssetId"),
      filename: t.exposeString("filename"),
      mimeType: t.exposeString("mimeType"),
      role: t.exposeString("role"),
      byteSize: t.exposeFloat("byteSize"),
      provenance: t.field({ type: "JSON", resolve: (r) => r.provenance }),
      narration: t.field({
        type: "JSON",
        nullable: true,
        resolve: (r) => r.narration,
      }),
      voice: t.field({ type: "JSON", nullable: true, resolve: (r) => r.voice }),
    }),
  })
/** @classification abac-gated */
const pack = builder
  .objectRef<ContentPackRevision>("ContentPackRevision")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      id: t.exposeID("id"),
      packId: t.exposeID("packId"),
      number: t.exposeInt("number"),
      document: t.field({ type: "JSON", resolve: (r) => r.document }),
    }),
  })
/** @classification abac-gated */
const source = builder
  .objectRef<StudioSourceSnapshot>("ShortsSourceSnapshot")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      id: t.exposeID("id"),
      source: t.field({ type: "JSON", resolve: (r) => r.source }),
      durationMs: t.exposeFloat("durationMs"),
      hlsUrl: t.exposeString("hlsUrl"),
      downloadUrl: t.exposeString("downloadUrl"),
      downloadId: t.exposeID("downloadId"),
      catalogDigest: t.exposeString("catalogDigest"),
      materialization: t.exposeString("materialization"),
      originalByteDigest: t.exposeString("originalByteDigest", {
        nullable: true,
      }),
      coveredRanges: t.field({ type: "JSON", resolve: (r) => r.coveredRanges }),
      restrictions: t.exposeStringList("restrictions"),
      subtitleUrl: t.exposeString("subtitleUrl"),
      subtitlePrimary: t.exposeBoolean("subtitlePrimary"),
      subtitleAiGenerated: t.exposeBoolean("subtitleAiGenerated"),
      exportHeight: t.exposeInt("exportHeight", { nullable: true }),
    }),
  })
/** @classification abac-gated */
const transfer = builder
  .objectRef<{
    path: string
    expiresAt: string
    method: string
  }>("ShortsAssetTransfer")
  .implement({
    fields: (t) => ({
      path: t.exposeString("path"),
      expiresAt: t.exposeString("expiresAt"),
      method: t.exposeString("method"),
    }),
  })
builder.queryFields((t) => ({
  shortsAssets: t.field({
    type: [asset],
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON" }) },
    resolve: (_, a, c) =>
      new StudioAssetService(c.prisma).list(c.user, a.input ?? {}),
  }),
  shortsAsset: t.field({
    type: asset,
    authScopes: { loggedIn: true },
    args: { reference: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioAssetService(c.prisma).read(c.user, a.reference),
  }),
  shortsNarrationMatches: t.field({
    type: [asset],
    authScopes: { loggedIn: true },
    args: { identity: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioAssetService(c.prisma).findNarration(c.user, a.identity),
  }),
  shortsNarrationIdentity: t.field({
    type: "JSON",
    authScopes: { loggedIn: true },
    args: {
      language: t.arg.string({ required: true }),
      speech: t.arg({ type: "JSON", required: true }),
    },
    resolve: (_, a, c) =>
      new StudioAssetService(c.prisma).narrationIdentity(
        c.user,
        a.language,
        a.speech,
      ),
  }),
  shortsContentPacks: t.field({
    type: [pack],
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON" }) },
    resolve: (_, a, c) =>
      new ContentPackService(c.prisma).list(c.user, a.input ?? {}),
  }),
  shortsContentPackRevision: t.field({
    type: pack,
    authScopes: { loggedIn: true },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_, a, c) => new ContentPackService(c.prisma).read(c.user, a.id),
  }),
  shortsSourceEligibility: t.field({
    type: "JSON",
    authScopes: { loggedIn: true },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_, a, c) =>
      new StudioSourceService(c.prisma).eligibility(c.user, a.id),
  }),
  shortsSourceSnapshot: t.field({
    type: source,
    authScopes: { loggedIn: true },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_, a, c) => new StudioSourceService(c.prisma).read(c.user, a.id),
  }),
  shortsExperiment: t.field({
    type: "JSON",
    authScopes: { loggedIn: true },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_, a, c) =>
      new StudioExperimentService(c.prisma).read(c.user, a.id),
  }),
}))
builder.mutationFields((t) => ({
  writeShortsContentPack: t.field({
    type: pack,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new ContentPackService(c.prisma).write(c.user, a.input),
  }),
  captureShortsSource: t.field({
    type: source,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioSourceService(c.prisma).capture(c.user, a.input),
  }),
  materializeShortsSource: t.field({
    type: source,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioSourceService(c.prisma).materialize(c.user, a.input),
  }),
  issueShortsAssetRead: t.field({
    type: transfer,
    authScopes: { loggedIn: true },
    args: { reference: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioTransferService(c.prisma).issue(c.user, "read", a.reference),
  }),
  issueShortsAssetUpload: t.field({
    type: transfer,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioTransferService(c.prisma).issue(c.user, "upload", a.input),
  }),
  requestShortsExperiment: t.field({
    type: "JSON",
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_, a, c) =>
      new StudioExperimentService(c.prisma).request(c.user, a.input),
  }),
  attachShortsExperimentCandidate: t.field({
    type: "JSON",
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: async (_, a, c) => {
      const r = await new StudioExperimentService(c.prisma).addCandidate(
        c.user,
        a.input,
      )
      return { ...r, actualCostMicros: Number(r.actualCostMicros) }
    },
  }),
}))
