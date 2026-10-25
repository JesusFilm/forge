import type { PrismaClient } from "@prisma/client"
import { SignJWT } from "jose"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { stagedStudioReleaseSchema } from "./catalog-readiness"
import { assertStudioRenderSources } from "./sources"
import { resolveStudioPackSources } from "./packs"
import { studioPlaybackConfiguration } from "./playback-config"
import { StudioPlaybackGateway } from "./playback"

/** A current public read on every media request, never an edge-cached decision.
 * Current source restrictions also remain enforceable after publication. */
export async function authorizeStudioPublicPlayback(
  db: PrismaClient,
  releaseId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  return db.$transaction(
    async (tx) => {
      signal?.throwIfAborted()
      await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
      const release = await tx.shortRelease.findFirst({
        where: {
          id: releaseId,
          publication: {
            is: {
              revokedAt: null,
              project: { is: { lifecycle: "PUBLISHED" } },
            },
          },
        },
        include: { projectRevision: true },
      })
      signal?.throwIfAborted()
      if (!release) return null
      const snapshot = stagedStudioReleaseSchema.parse(release.snapshot)
      if (
        release.muxAssetId !== snapshot.mux.assetId ||
        release.muxPlaybackId !== snapshot.mux.playbackId
      )
        return null
      const document = studioDocumentSchema.parse(
        release.projectRevision.document,
      )
      try {
        const sources = await assertStudioRenderSources(tx, document)
        signal?.throwIfAborted()
        const packs = await resolveStudioPackSources(
          tx,
          document.packRevisionIds,
        )
        signal?.throwIfAborted()
        if (
          sources.some((source) =>
            source.eligibility.restrictions.includes("watch"),
          ) ||
          packs.some((pack) =>
            pack.sources.some((source) =>
              source.eligibility.restrictions.includes("watch"),
            ),
          )
        )
          return null
      } catch {
        return null
      }
      return { playbackId: snapshot.mux.playbackId }
    },
    { maxWait: 1000, timeout: 5000 },
  )
}
export function createStudioPublicPlayback(db: PrismaClient) {
  const config = studioPlaybackConfiguration()
  if (!config) return null
  return new StudioPlaybackGateway({
    resourceKey: config.resourceKey,
    authorize: (releaseId, signal) =>
      authorizeStudioPublicPlayback(db, releaseId, signal),
    sign: (playbackId, audience) =>
      new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: config.keyId })
        .setSubject(playbackId)
        .setAudience(audience)
        .setExpirationTime("1h")
        .setIssuedAt()
        .sign(config.key),
  })
}
