import { assertStudioPublicationEligibility } from "./publication-readiness-resolver"
import { studioPlaybackUrl } from "./playback-config"
import type { PrismaClient } from "@prisma/client"
import { studioPublishSchema } from "@forge/studio-contracts/publication"
import type { Principal } from "@/auth/principal"
import { canReviewStudio } from "@/auth/permissions"
import { ForbiddenError } from "../errors"
import { studioActor, studioHash } from "./state"
import { publishStudioProject } from "./publication"
import {
  retainedStudioReadinessSchema,
  stagedStudioReleaseSchema,
} from "./catalog-readiness"
import type { StudioSchedulePublicationHook } from "./scheduled-publication"
import { StudioCommandError } from "./errors"

/** The single manual/scheduled catalog admission command. External readiness
 * preparation is complete before entry. No storage/provider call occurs here. */
export class StudioCatalogPublicationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduleHook?: StudioSchedulePublicationHook,
  ) {}
  async publish(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (
      !canReviewStudio(user) &&
      !(actor.kind === "service" && this.scheduleHook)
    )
      throw new ForbiddenError("Trusted publication authority required")
    const input = studioPublishSchema.parse(raw)
    if (
      input.schedule
        ? actor.kind !== "service" || !this.scheduleHook
        : !canReviewStudio(user)
    )
      throw new ForbiddenError("Publication authority does not match delivery")
    return publishStudioProject(
      this.db,
      user,
      input,
      async (tx, snapshot) => {
        const { release, approval, restrictions } =
          await assertStudioPublicationEligibility(
            tx,
            input,
            actor.kind === "human" ? actor.id : undefined,
          )
        if (studioHash(restrictions) !== studioHash(snapshot.restrictions))
          throw new StudioCommandError("STALE_BINDING")
        const playbackUrl = studioPlaybackUrl(release.id, "index.m3u8")
        if (!playbackUrl || release.dub.hls !== playbackUrl)
          throw new StudioCommandError("UNREADY")
        const readiness = await tx.studioCatalogReadiness.findFirst({
          where: { releaseId: release.id },
          orderBy: { sequence: "desc" },
        })
        if (
          !readiness ||
          readiness.id !== input.readinessId ||
          readiness.expiresAt <= new Date()
        )
          throw new StudioCommandError("UNREADY")
        const proof = retainedStudioReadinessSchema.parse(readiness.proof),
          staged = stagedStudioReleaseSchema.parse(release.snapshot)
        if (
          studioHash(staged.restrictions) !== studioHash(snapshot.restrictions)
        )
          throw new StudioCommandError("STALE_BINDING")
        if (
          proof.mux.assetId !== release.mux.assetId ||
          proof.mux.playbackId !== release.mux.playbackId ||
          studioHash(proof.output) !== studioHash(staged.manifest.output) ||
          proof.codec.outputDigest !== staged.manifest.output.digest
        )
          throw new StudioCommandError("UNREADY")
        await tx.studioPublication.create({
          data: {
            releaseId: release.id,
            projectId: release.projectId,
            approvalId: approval.id,
            readinessId: readiness.id,
            publishedAt: snapshot.publishedAt,
          },
        })
        // Invoked again by the common command after latch/receipt persistence.
        // Server decision time, not a claim about the nanosecond commit occurs.
        return () => {
          if (readiness.expiresAt <= new Date())
            throw new StudioCommandError("UNREADY")
        }
      },
      input.schedule && this.scheduleHook
        ? {
            input: { ...input, schedule: input.schedule },
            consume: this.scheduleHook,
          }
        : undefined,
    )
  }
}
