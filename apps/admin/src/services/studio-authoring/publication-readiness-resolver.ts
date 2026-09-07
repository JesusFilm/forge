import type { Prisma, PrismaClient } from "@prisma/client"
import {
  studioActorSchema,
  studioDocumentSchema,
} from "@forge/studio-contracts"
import {
  studioApprovedReleaseSchema,
  type StudioApprovedRelease,
} from "@forge/studio-contracts/publication"
import type { Principal } from "@/auth/principal"
import { canReviewStudio } from "@/auth/permissions"
import { ForbiddenError } from "../errors"
import {
  lockProject,
  publicationDependencyHash,
  studioActor,
  studioHash,
} from "./state"
import { StudioCommandError } from "./errors"
import { resolveStudioPackSources } from "./packs"
import { assertStudioRenderSources } from "./sources"
import { stagedStudioReleaseSchema } from "./catalog-readiness"

/** Canonical, transaction-compatible eligibility. No provider I/O, replacement
 * content, approval creation or authority minting occurs in this module. */
export async function assertStudioPublicationEligibility(
  tx: Prisma.TransactionClient,
  input: StudioApprovedRelease,
  operatorId?: string,
) {
  const project = await lockProject(tx, input.projectId)
  if (
    project.firstPublishedAt ||
    project.lifecycle !== "DRAFT" ||
    project.currentRevision !== input.expectedRevision
  )
    throw new StudioCommandError("STALE_BINDING")
  const release = await tx.studioCatalogRelease.findUnique({
    where: { id: input.releaseId },
    include: { mux: true, dub: true },
  })
  if (
    !release ||
    release.projectId !== project.id ||
    release.revision !== input.expectedRevision ||
    release.renderAttemptId !== input.renderAttemptId
  )
    throw new StudioCommandError("STALE_BINDING")
  const revision = await tx.studioProjectRevision.findUniqueOrThrow({
    where: {
      projectId_number: {
        projectId: project.id,
        number: input.expectedRevision,
      },
    },
  })
  const document = studioDocumentSchema.parse(revision.document)
  const approval = await tx.studioApproval.findUnique({
    where: { id: input.approvalId },
  })
  if (
    !approval ||
    approval.projectId !== project.id ||
    approval.revision !== input.expectedRevision ||
    approval.kind !== "PUBLICATION" ||
    approval.renderAttemptId !== input.renderAttemptId ||
    approval.dependencyHash !==
      (await publicationDependencyHash(
        tx,
        project,
        document,
        input.renderAttemptId,
      ))
  )
    throw new StudioCommandError("APPROVAL_REQUIRED")
  const actor = studioActorSchema.parse(approval.actor)
  if (actor.kind !== "human" || actor.authority !== "interactive")
    throw new StudioCommandError("APPROVAL_REQUIRED")
  for (const id of [
    ...new Set([actor.id, ...(operatorId ? [operatorId] : [])]),
  ].sort()) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT u.id FROM "user" u JOIN manager_membership m ON m.user_id=u.id WHERE u.id=${id} AND m.role='OPERATOR' AND m.revoked_at IS NULL FOR SHARE OF u,m`
    if (rows.length !== 1) throw new StudioCommandError("AUTHORIZATION_REVOKED")
  }
  const sources = await assertStudioRenderSources(tx, document),
    packs = await resolveStudioPackSources(tx, document.packRevisionIds)
  const restrictions = [
    ...new Set([
      ...sources.flatMap((source) => source.eligibility.restrictions),
      ...packs.flatMap((pack) =>
        pack.sources.flatMap((source) => source.eligibility.restrictions),
      ),
    ]),
  ].sort()
  if (
    studioHash(restrictions) !==
    studioHash(stagedStudioReleaseSchema.parse(release.snapshot).restrictions)
  )
    throw new StudioCommandError("STALE_BINDING")
  return { project, release, approval, restrictions }
}

export class StudioPublicationReadinessResolver {
  constructor(private readonly db: PrismaClient) {}
  /** Advisory UI and trusted preparation use the same exact canonical binding.
   * This read never fetches a provider, mints approval or admits publication. */
  async candidate(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service" && !canReviewStudio(user))
      throw new ForbiddenError("Trusted publication preparation required")
    const input = studioApprovedReleaseSchema.parse(raw)
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`
        await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
        await assertStudioPublicationEligibility(
          tx,
          input,
          actor.kind === "human" ? actor.id : undefined,
        )
        const row = await tx.studioCatalogReadiness.findFirst({
          where: { releaseId: input.releaseId },
          orderBy: { sequence: "desc" },
        })
        return {
          ...input,
          readiness: {
            state: !row
              ? ("missing" as const)
              : row.expiresAt <= new Date()
                ? ("expired" as const)
                : ("ready" as const),
            id: row?.id ?? null,
            expiresAt: row?.expiresAt.toISOString() ?? null,
          },
        }
      },
      { maxWait: 1000, timeout: 5000 },
    )
  }
}
