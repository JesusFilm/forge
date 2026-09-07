import { studioPlaybackUrl } from "./playback-config"
import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  studioAttemptResultSchema,
  studioDocumentSchema,
  studioIdSchema,
} from "@forge/studio-contracts"
import {
  studioStageCatalogSchema,
  studioCatalogRenderManifestSchema,
} from "@forge/studio-contracts/catalog"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "../errors"
import { studioActor, studioHash, lockProject, assertEditable } from "./state"
import { StudioCommandError } from "./errors"
import { StudioAssetService, resolveAssetVersion } from "./assets"
import { assertStudioRenderSources } from "./sources"
import { resolveStudioPackSources } from "./packs"

/** Registers completed render evidence only. It neither calls Mux nor publishes. */
export class StudioCatalogService {
  constructor(private readonly db: PrismaClient) {}
  async read(user: Principal | null, rawId: string) {
    studioActor(user)
    const row = await this.db.studioCatalogRelease.findUnique({
      where: { id: studioIdSchema.parse(rawId) },
      include: {
        video: { include: { locales: true } },
        dub: true,
        edition: true,
        mux: true,
        derivations: { include: { sourceSnapshot: true } },
        packs: true,
      },
    })
    if (!row) throw new NotFoundError("StudioCatalogRelease")
    return row
  }
  async stage(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service")
      throw new ForbiddenError("Trusted render registration required")
    const input = studioStageCatalogSchema.parse(raw)
    const requestHash = studioHash({ actor, input })
    const retry = await this.db.studioCatalogRelease.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    })
    if (retry) {
      if (retry.requestHash !== requestHash)
        throw new StudioCommandError("CONFLICT")
      return retry
    }
    const attempt = await this.db.studioAttempt.findUnique({
      where: { id: input.renderAttemptId },
    })
    if (
      !attempt ||
      attempt.projectId !== input.projectId ||
      attempt.baseRevision !== input.expectedRevision ||
      attempt.kind !== "RENDER" ||
      attempt.status !== "SUCCEEDED"
    )
      throw new StudioCommandError("INVALID")
    const result = studioAttemptResultSchema.parse(attempt.result)
    if (!result.manifest) throw new StudioCommandError("INVALID")
    const assets = new StudioAssetService(this.db)
    const manifestAsset = await assets.read(user, result.manifest)
    if (manifestAsset.role !== "manifest" || manifestAsset.byteSize > 32768)
      throw new StudioCommandError("INVALID")
    const manifest = studioCatalogRenderManifestSchema.parse(
      JSON.parse(
        Buffer.from(await assets.readBytes(user, result.manifest)).toString(
          "utf8",
        ),
      ),
    )
    if (
      manifest.projectId !== input.projectId ||
      manifest.revision !== input.expectedRevision ||
      manifest.renderAttemptId !== attempt.id ||
      manifest.inputHash !== attempt.inputHash ||
      manifest.verification.outputDigest !== manifest.output.digest ||
      !result.assets.some((a) => studioHash(a) === studioHash(manifest.output))
    )
      throw new StudioCommandError("INVALID")
    const outputAsset = await assets.read(user, manifest.output)
    if (
      outputAsset.role !== "render" ||
      !outputAsset.mimeType.startsWith("video/")
    )
      throw new StudioCommandError("INVALID")
    // The byte registry proves checksums; actual codec/dimension certification is
    // the trusted renderer's responsibility in feat-460, not inferred from JSON.
    await assets.readBytes(user, manifest.output)
    return this.db.$transaction(
      async (tx) => {
        const project = await lockProject(tx, input.projectId)
        const prior = await tx.studioCatalogRelease.findUnique({
          where: {
            projectId_idempotencyKey: {
              projectId: input.projectId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        })
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new StudioCommandError("CONFLICT")
          return prior
        }
        assertEditable(project, input.expectedRevision)
        if (
          await tx.studioCatalogRelease.findUnique({
            where: { renderAttemptId: attempt.id },
          })
        )
          throw new StudioCommandError("CONFLICT")
        const revision = await tx.studioProjectRevision.findUniqueOrThrow({
          where: {
            projectId_number: {
              projectId: project.id,
              number: project.currentRevision,
            },
          },
        })
        const document = studioDocumentSchema.parse(revision.document)
        for (const key of [
          "language",
          "runtimeVersion",
          "width",
          "height",
          "fps",
          "durationInFrames",
        ] as const)
          if (document[key] !== manifest[key])
            throw new StudioCommandError("CONFLICT")
        const language = await tx.language.findFirst({
          where: { slug: document.language, deletedAt: null },
        })
        if (!language) throw new NotFoundError("Exact author language")
        const sources = await assertStudioRenderSources(tx, document)
        const packs = await resolveStudioPackSources(
          tx,
          document.packRevisionIds,
        )
        const restrictions = [
          ...new Set([
            ...sources.flatMap((s) => s.eligibility.restrictions),
            ...packs.flatMap((p) =>
              p.sources.flatMap((s) => s.eligibility.restrictions),
            ),
          ]),
        ].sort()
        await resolveAssetVersion(tx, manifest.output)
        await resolveAssetVersion(tx, result.manifest!)
        // Serialize cross-project registration of the same external identity.
        for (const key of [
          `asset:${input.mux.assetId}`,
          `playback:${input.mux.playbackId}`,
        ].sort())
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`studio-catalog-mux:${key}`}, 0))::text`
        if (
          await tx.muxVideo.findFirst({
            where: {
              OR: [
                { assetId: input.mux.assetId },
                { playbackId: input.mux.playbackId },
              ],
            },
          })
        )
          throw new StudioCommandError("CONFLICT")
        const id = randomUUID()
        const video = await tx.video.create({
          data: {
            source: "MANAGER",
            slug: `studio-${id}`,
            primaryLanguageId: language.id,
            noIndex: true,
            aiMetadata: true,
            restrictViewPlatforms: restrictions,
            locales: {
              create: {
                source: "MANAGER",
                languageId: language.id,
                languageSlug: language.slug,
                languageCoreId: language.coreId,
                locale: language.bcp47,
                title: document.title,
                status: "DRAFT",
              },
            },
          },
        })
        const edition = await tx.videoEdition.create({
          data: { source: "MANAGER", name: `Studio render ${attempt.id}` },
        })
        const mux = await tx.muxVideo.create({
          data: {
            source: "MANAGER",
            assetId: input.mux.assetId,
            playbackId: input.mux.playbackId,
          },
        })
        const durationMs = Math.round(
          (document.durationInFrames * 1000) / document.fps,
        )
        const dub = await tx.videoDub.create({
          data: {
            source: "MANAGER",
            videoId: video.id,
            videoEditionId: edition.id,
            muxVideoId: mux.id,
            languageId: language.id,
            duration: Math.ceil(durationMs / 1000),
            lengthInMilliseconds: BigInt(durationMs),
            aiGenerated: true,
            published: false,
            downloadable: false,
            hls: studioPlaybackUrl(id, "index.m3u8"),
          },
        })
        const poster = studioPlaybackUrl(id, "poster.webp")
        if (poster)
          await tx.videoImage.create({
            data: {
              source: "MANAGER",
              videoId: video.id,
              url: poster,
              thumbnail: poster,
              videoStill: poster,
              width: document.width,
              height: document.height,
              kind: "poster",
            },
          })
        const generation = {
          renderAttemptId: attempt.id,
          inputHash: attempt.inputHash,
          instructions: attempt.instructions,
          actor: attempt.actor,
          result,
          revisionActor: revision.actor,
        }
        return tx.studioCatalogRelease.create({
          data: {
            id,
            projectId: project.id,
            revision: project.currentRevision,
            renderAttemptId: attempt.id,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            videoId: video.id,
            dubId: dub.id,
            editionId: edition.id,
            muxId: mux.id,
            snapshot: {
              version: 1,
              document,
              manifest,
              manifestReference: result.manifest!,
              mux: input.mux,
              actor,
              restrictions,
              generation,
              sources: sources.map((s) => ({
                snapshotId: s.snapshot.id,
                itemId: s.itemId,
                catalogDigest: s.snapshot.catalogDigest,
                currentRestrictions: s.eligibility.restrictions,
              })),
              packs: packs.map((p) => ({
                revisionId: p.revisionId,
                packId: p.packId,
                number: p.number,
                document: p.document,
              })),
            },
            derivations: {
              create: sources.map((s) => ({
                itemId: s.itemId,
                sourceSnapshotId: s.snapshot.id,
                startMs: s.startMs,
                endMs: s.endMs,
                startFrame: s.startFrame,
                durationInFrames: document.items.find((i) => i.id === s.itemId)!
                  .durationInFrames,
              })),
            },
            packs: {
              create: packs.map((p) => ({ packRevisionId: p.revisionId })),
            },
          },
        })
      },
      { timeout: 15000 },
    )
  }
}
