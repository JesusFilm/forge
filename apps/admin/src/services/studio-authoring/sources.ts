import { randomUUID } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { StudioDocument } from "@forge/studio-contracts"
import {
  studioCaptureSourceSchema,
  studioSourceSnapshotSchema,
  studioMaterializeSourceSchema,
  studioSourceManifestSchema,
  parseStudioVtt,
  type StudioSourceSnapshot,
} from "@forge/studio-contracts/sources"
import type { Principal } from "@/auth/principal"
import { defaultBackend, type MediaStorageBackend } from "@/storage/media"
import { ForbiddenError, NotFoundError } from "../errors"
import { studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"
import {
  StudioAssetService,
  resolveAssetVersion,
  readVerifiedStudioAsset,
  STUDIO_MAX_ASSET_BYTES,
} from "./assets"

type Selection = {
  videoId: string
  dubId: string
  editionId: string
  language: string
  trackId: string
  downloadId: string
}
export type StudioSourceDownload = (
  url: string,
  maxBytes: number,
) => Promise<Uint8Array>
export const downloadStudioSource: StudioSourceDownload = async (
  raw,
  maxBytes,
) => {
  const url = new URL(raw)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["api-media-core.jesusfilm.org", "stream.mux.com"].includes(url.hostname)
  )
    throw new StudioCommandError("INVALID")
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok || !response.body)
    throw new NotFoundError("Canonical source bytes")
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > maxBytes) throw new StudioCommandError("INVALID")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
async function exactCatalog(db: Prisma.TransactionClient, selected: Selection) {
  const dub = await db.videoDub.findFirst({
    where: {
      id: selected.dubId,
      videoId: selected.videoId,
      videoEditionId: selected.editionId,
      published: true,
      downloadable: true,
      deletedAt: null,
      language: { slug: selected.language, deletedAt: null },
      videoEdition: { deletedAt: null },
      video: {
        deletedAt: null,
        noIndex: false,
        NOT: { restrictViewPlatforms: { has: "watch" } },
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
      },
    },
    include: { video: true, language: true, videoEdition: true },
  })
  const track = await db.videoSubtitle.findFirst({
    where: {
      id: selected.trackId,
      videoEditionId: selected.editionId,
      deletedAt: null,
      language: { slug: selected.language, deletedAt: null },
      OR: [{ videoId: selected.videoId }, { videoId: null }],
    },
  })
  const download = await db.videoDubDownload.findFirst({
    where: {
      id: selected.downloadId,
      videoDubId: selected.dubId,
      deletedAt: null,
    },
  })
  const durationMs = Number(dub?.lengthInMilliseconds ?? 0)
  if (
    !dub?.hls?.trim() ||
    !track?.vttSrc?.trim() ||
    !download?.url?.trim() ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    dub.video.restrictViewPlatforms.includes("studio")
  )
    throw new NotFoundError("Eligible exact Studio source")
  return {
    durationMs,
    exportHeight: download.height,
    hlsUrl: dub.hls,
    downloadUrl: download.url,
    subtitleUrl: track.vttSrc,
    restrictions: dub.video.restrictViewPlatforms,
    subtitlePrimary: track.primary,
    subtitleAiGenerated: track.aiGenerated,
    catalogDigest: studioHash({
      selected: {
        videoId: selected.videoId,
        dubId: selected.dubId,
        editionId: selected.editionId,
        trackId: selected.trackId,
        downloadId: selected.downloadId,
        language: selected.language,
      },
      durationMs,
      hls: dub.hls,
      download: download.url,
      track: track.vttSrc,
      dubVersion: dub.version,
      languageId: dub.languageId,
      primary: track.primary,
      aiGenerated: track.aiGenerated,
      exportHeight: download.height,
    }),
  }
}
/** Recheck current access and identities inside the catalog publication transaction. */
export async function assertStudioSourceEligible(
  tx: Prisma.TransactionClient,
  snapshot: StudioSourceSnapshot,
) {
  const s = snapshot.source
  // Locks prevent a concurrent catalog edit from slipping between eligibility and publication.
  await tx.$queryRaw`SELECT v.id FROM video v JOIN video_dub d ON d.video_id=v.id JOIN video_edition e ON e.id=d.video_edition_id JOIN video_subtitle t ON t.video_edition_id=e.id JOIN language l ON l.id=d.language_id JOIN video_dub_download dl ON dl.video_dub_id=d.id WHERE v.id=${s.videoId} AND d.id=${s.dubId} AND e.id=${s.editionId} AND t.id=${s.subtitle.trackId} AND dl.id=${snapshot.downloadId} FOR SHARE OF v,d,e,t,l,dl`
  await tx.$queryRaw`SELECT id FROM video_locale WHERE video_id=${s.videoId} FOR SHARE`
  const current = await exactCatalog(tx, {
    ...s,
    trackId: s.subtitle.trackId,
    downloadId: snapshot.downloadId,
  })
  if (current.catalogDigest !== snapshot.catalogDigest)
    throw new StudioCommandError("CONFLICT")
  return current
}
/** Shared by commands and feat-459/460; returns the pinned snapshot and each used range. */
export async function resolveStudioDocumentSources(
  tx: Prisma.TransactionClient,
  document: StudioDocument,
) {
  const resolved: {
    snapshot: StudioSourceSnapshot
    itemId: string
    startMs: number
    endMs: number
    startFrame: number
    eligibility: Awaited<ReturnType<typeof assertStudioSourceEligible>>
  }[] = []
  const subtitleBytes = new Map<string, Uint8Array>()
  for (const item of document.items) {
    if (item.kind !== "video") continue
    const s = item.source
    const row = await tx.studioSourceSnapshot.findFirst({
      where: {
        videoId: s.videoId,
        dubId: s.dubId,
        editionId: s.editionId,
        trackId: s.subtitle.trackId,
        AND: [
          { snapshot: { path: ["source", "language"], equals: s.language } },
          { snapshot: { path: ["source", "subtitle"], equals: s.subtitle } },
          { snapshot: { path: ["source", "preview"], equals: s.preview } },
          { snapshot: { path: ["source", "export"], equals: s.export } },
        ],
      },
      orderBy: { id: "asc" },
    })
    const snapshot = row ? studioSourceSnapshotSchema.parse(row.snapshot) : null
    if (
      !snapshot ||
      s.startMs < 0 ||
      s.endMs > snapshot.durationMs ||
      s.endMs <= s.startMs
    )
      throw new NotFoundError("Pinned source/range")
    const eligibility = await assertStudioSourceEligible(tx, snapshot)
    let bytes = subtitleBytes.get(s.subtitle.asset.digest)
    if (!bytes) {
      bytes = await readVerifiedStudioAsset(tx, s.subtitle.asset, 1048576)
      subtitleBytes.set(s.subtitle.asset.digest, bytes)
    }
    parseStudioVtt(bytes, { startMs: s.startMs, endMs: s.endMs })
    resolved.push({
      snapshot,
      eligibility,
      itemId: item.id,
      startMs: s.startMs,
      endMs: s.endMs,
      startFrame: item.startFrame,
    })
  }
  return resolved
}
export class StudioSourceService {
  constructor(
    private readonly db: PrismaClient,
    private readonly download: StudioSourceDownload = downloadStudioSource,
    private readonly backend: MediaStorageBackend = defaultBackend(),
  ) {}
  async capture(user: Principal | null, raw: unknown) {
    const actor = studioActor(user),
      input = studioCaptureSourceSchema.parse(raw)
    const requestKey = studioHash({
        actor,
        idempotencyKey: input.idempotencyKey,
      }),
      requestHash = studioHash(input)
    const prior = await this.db.studioSourceSnapshot.findUnique({
      where: { requestKey },
    })
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new StudioCommandError("CONFLICT")
      return studioSourceSnapshotSchema.parse(prior.snapshot)
    }
    const catalog = await exactCatalog(this.db, input)
    if (input.startMs >= input.endMs || input.endMs > catalog.durationMs)
      throw new StudioCommandError("INVALID")
    const subtitleBytes = await this.download(catalog.subtitleUrl, 1048576)
    parseStudioVtt(subtitleBytes, {
      startMs: input.startMs,
      endMs: input.endMs,
    })
    const sourceBytes = input.retainOriginalBytes
      ? await this.download(catalog.downloadUrl, STUDIO_MAX_ASSET_BYTES)
      : Buffer.from(
          JSON.stringify({
            kind: "canonical-source-descriptor",
            selection: input,
            catalog,
            originalByteDigest: null,
          }),
        )
    const assets = new StudioAssetService(this.db)
    const provenance = {
      status: "recorded",
      recorded: { selection: input, catalog },
    }
    const subtitle = await assets.register(
      user,
      {
        filename: "canonical.vtt",
        mimeType: "text/vtt",
        role: "subtitle",
        provenance,
        idempotencyKey: studioHash({ requestKey, role: "subtitle" }),
      },
      subtitleBytes,
      this.backend,
    )
    const source = await assets.register(
      user,
      {
        filename: input.retainOriginalBytes ? "source.mp4" : "source.json",
        mimeType: input.retainOriginalBytes ? "video/mp4" : "application/json",
        role: input.retainOriginalBytes ? "source" : "manifest",
        provenance,
        idempotencyKey: studioHash({ requestKey, role: "source" }),
      },
      sourceBytes,
      this.backend,
    )
    const snapshot = studioSourceSnapshotSchema.parse({
      id: randomUUID(),
      ...catalog,
      materialization: input.retainOriginalBytes
        ? "original-bytes"
        : "descriptor",
      originalByteDigest: input.retainOriginalBytes
        ? source.reference.digest
        : null,
      coveredRanges: input.retainOriginalBytes
        ? [{ startMs: 0, endMs: catalog.durationMs }]
        : [],
      downloadId: input.downloadId,
      source: {
        videoId: input.videoId,
        dubId: input.dubId,
        editionId: input.editionId,
        language: input.language,
        startMs: input.startMs,
        endMs: input.endMs,
        preview: source.reference,
        export: source.reference,
        subtitle: {
          trackId: input.trackId,
          editionId: input.editionId,
          language: input.language,
          asset: subtitle.reference,
        },
      },
    })
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 455))::text`
      const retry = await tx.studioSourceSnapshot.findUnique({
        where: { requestKey },
      })
      if (retry) {
        if (retry.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return studioSourceSnapshotSchema.parse(retry.snapshot)
      }
      await assertStudioSourceEligible(tx, snapshot)
      await tx.studioSourceSnapshot.create({
        data: {
          id: snapshot.id,
          videoId: input.videoId,
          dubId: input.dubId,
          editionId: input.editionId,
          trackId: input.trackId,
          downloadId: input.downloadId,
          snapshot,
          requestKey,
          requestHash,
        },
      })
      return snapshot
    })
  }
  async materialize(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service")
      throw new ForbiddenError("Trusted broker materialization required")
    const input = studioMaterializeSourceSchema.parse(raw)
    const admitted = await this.read(user, input.sourceSnapshotId)
    const assets = new StudioAssetService(this.db)
    const manifests: ReturnType<typeof studioSourceManifestSchema.parse>[] = []
    for (const purpose of ["preview", "export"] as const) {
      const bytes = await assets.readBytes(user, input[purpose])
      if (bytes.length > 131072) throw new StudioCommandError("INVALID")
      const manifest = studioSourceManifestSchema.parse(
        JSON.parse(Buffer.from(bytes).toString("utf8")),
      )
      if (
        manifest.sourceSnapshotId !== admitted.id ||
        manifest.catalogDigest !== admitted.catalogDigest ||
        manifest.purpose !== purpose ||
        manifest.ranges.some(
          (r) => r.endMs <= r.startMs || r.endMs > admitted.durationMs,
        ) ||
        (purpose === "export" &&
          (!admitted.exportHeight || manifest.height < admitted.exportHeight))
      )
        throw new StudioCommandError("INVALID")
      for (const ref of manifest.media) {
        const media = await assets.read(user, ref)
        if (media.role !== "source" || !media.mimeType.startsWith("video/"))
          throw new StudioCommandError("INVALID")
        await assets.readBytes(user, ref)
      }
      manifests.push(manifest)
    }
    if (studioHash(manifests[0]!.ranges) !== studioHash(manifests[1]!.ranges))
      throw new StudioCommandError("INVALID")
    const requestKey = studioHash({
        actor,
        key: input.idempotencyKey,
        command: "materialize",
      }),
      requestHash = studioHash(input)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 455))::text`
      const prior = await tx.studioSourceSnapshot.findUnique({
        where: { requestKey },
      })
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return studioSourceSnapshotSchema.parse(prior.snapshot)
      }
      await assertStudioSourceEligible(tx, admitted)
      const snapshot = studioSourceSnapshotSchema.parse({
        ...admitted,
        id: randomUUID(),
        materialization: "broker-manifest",
        originalByteDigest: null,
        coveredRanges: manifests[1]!.ranges,
        source: {
          ...admitted.source,
          preview: input.preview,
          export: input.export,
        },
      })
      await tx.studioSourceSnapshot.create({
        data: {
          id: snapshot.id,
          videoId: snapshot.source.videoId,
          dubId: snapshot.source.dubId,
          editionId: snapshot.source.editionId,
          trackId: snapshot.source.subtitle.trackId,
          downloadId: snapshot.downloadId,
          snapshot,
          requestKey,
          requestHash,
        },
      })
      for (const manifest of manifests) {
        for (const ref of manifest.media) {
          await resolveAssetVersion(tx, ref)
          await tx.studioAssetUsage.createMany({
            data: [
              {
                ownerType: "STUDIO_SOURCE",
                ownerId: snapshot.id,
                versionId: ref.versionId,
              },
              {
                ownerType: "STUDIO_ASSET_VERSION",
                ownerId: input[manifest.purpose].versionId,
                versionId: ref.versionId,
              },
            ],
            skipDuplicates: true,
          })
        }
      }
      return snapshot
    })
  }
  async eligibility(user: Principal | null, id: string) {
    const snapshot = await this.read(user, id)
    return this.db.$transaction((tx) =>
      assertStudioSourceEligible(tx, snapshot),
    )
  }
  async read(user: Principal | null, id: string) {
    studioActor(user)
    const row = await this.db.studioSourceSnapshot.findUnique({ where: { id } })
    if (!row) throw new NotFoundError("StudioSourceSnapshot")
    return studioSourceSnapshotSchema.parse(row.snapshot)
  }
}

export async function assertStudioRenderSources(
  tx: Prisma.TransactionClient,
  document: StudioDocument,
) {
  const sources = await resolveStudioDocumentSources(tx, document)
  for (const source of sources) {
    if (
      source.snapshot.materialization === "descriptor" ||
      !source.snapshot.coveredRanges.some(
        (r) => r.startMs <= source.startMs && r.endMs >= source.endMs,
      )
    )
      throw new StudioCommandError("INVALID")
  }
  return sources
}
