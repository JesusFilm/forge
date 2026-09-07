import { stagedStudioReleaseSchema } from "./catalog-readiness"
import type { PrismaClient } from "@prisma/client"
import { studioIdSchema } from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { StudioAuthoringService } from "./index"

/** Advisory UI projection only. Publication revalidates every binding under
 * its project lock; neither this read nor a provider-ready badge admits it. */
export async function readStudioRenderState(
  db: PrismaClient,
  user: Principal | null,
  rawId: unknown,
) {
  const projectId = studioIdSchema.parse(rawId)
  const project = await new StudioAuthoringService(db).read(user, projectId)
  const [attempts, approvals, publication] = await Promise.all([
    db.studioAttempt.findMany({
      where: { projectId, kind: "RENDER" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true,
        baseRevision: true,
        status: true,
        createdAt: true,
        renderJob: { select: { state: true, generation: true } },
        muxJob: { select: { state: true } },
        catalogRelease: {
          select: {
            id: true,
            snapshot: true,
            video: { select: { slug: true } },
            dub: {
              select: { hls: true, language: { select: { slug: true } } },
            },
            readiness: {
              orderBy: { sequence: "desc" },
              take: 1,
              select: { id: true, checkedAt: true, expiresAt: true },
            },
          },
        },
      },
    }),
    db.studioApproval.findMany({
      where: { projectId, revision: project.revision, kind: "PUBLICATION" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, renderAttemptId: true },
    }),
    db.studioPublication.findUnique({
      where: { projectId },
      select: { releaseId: true, publishedAt: true, revokedAt: true },
    }),
  ])
  return {
    project,
    attempts: attempts.map((attempt) => {
      if (!attempt.catalogRelease) return attempt
      const { snapshot, ...release } = attempt.catalogRelease
      return {
        ...attempt,
        catalogRelease: {
          ...release,
          output: stagedStudioReleaseSchema.parse(snapshot).manifest.output,
        },
      }
    }),
    approvals,
    publication,
  }
}
