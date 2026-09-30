import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  studioDocumentSchema,
  studioIdSchema,
  type StudioDocument,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "../errors"
import { StudioCommandError } from "./errors"
import { lockProject, studioActor, studioHash } from "./state"
import {
  assertStudioRenderSources,
  resolveStudioDocumentSources,
} from "./sources"

const identitySchema = z
  .object({ attemptId: studioIdSchema, leaseId: z.uuid() })
  .strict()
const preparationSchema = identitySchema
  .extend({ document: studioDocumentSchema })
  .strict()
/** Only retained media handles may change. Timing, selected catalog identities,
 * subtitles, script, layout and authored asset/code references remain identical. */
export function assertStudioMaterializationIdentity(
  original: StudioDocument,
  prepared: StudioDocument,
) {
  const withoutHandles = (document: StudioDocument) => ({
    ...document,
    items: document.items.map((item) =>
      item.kind === "video"
        ? {
            ...item,
            source: { ...item.source, preview: null, export: null },
          }
        : item,
    ),
  })
  if (
    studioHash(withoutHandles(original)) !==
    studioHash(withoutHandles(prepared))
  )
    throw new StudioCommandError("CONFLICT")
}
export class StudioRenderPreparation {
  constructor(private readonly db: PrismaClient) {}
  async read(user: Principal, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted render worker required")
    const input = identitySchema.parse(raw)
    return this.db.shortRenderPreparation.findUnique({
      where: { attemptId_leaseId: input },
    })
  }
  async save(user: Principal, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted render worker required")
    const input = preparationSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const identity = await tx.shortAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      })
      const project = await lockProject(tx, identity.projectId)
      const attempt = await tx.shortAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      })
      const prior = await tx.shortRenderPreparation.findUnique({
        where: {
          attemptId_leaseId: {
            attemptId: input.attemptId,
            leaseId: input.leaseId,
          },
        },
      })
      if (prior) {
        if (studioHash(prior.document) !== studioHash(input.document))
          throw new StudioCommandError("CONFLICT")
        return prior
      }
      const job = await tx.shortRenderJob.findUniqueOrThrow({
        where: { attemptId: input.attemptId },
      })
      if (
        attempt.kind !== "RENDER" ||
        attempt.status !== "RUNNING" ||
        job.state !== "RUNNING" ||
        job.leaseId !== input.leaseId ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt <= new Date() ||
        project.currentRevision !== attempt.baseRevision ||
        project.firstPublishedAt
      )
        throw new StudioCommandError("CONFLICT")
      const revision = await tx.shortRevision.findUniqueOrThrow({
        where: {
          projectId_number: {
            projectId: project.id,
            number: attempt.baseRevision,
          },
        },
      })
      assertStudioMaterializationIdentity(
        studioDocumentSchema.parse(revision.document),
        input.document,
      )
      const originalSources = await resolveStudioDocumentSources(
        tx,
        studioDocumentSchema.parse(revision.document),
      )
      const preparedSources = await assertStudioRenderSources(
        tx,
        input.document,
      )
      for (const source of originalSources) {
        const prepared = preparedSources.find(
          (value) => value.itemId === source.itemId,
        )
        if (
          source.snapshot.materialization === "broker-manifest" &&
          studioHash(source.snapshot.source) !==
            studioHash(prepared?.snapshot.source)
        )
          throw new StudioCommandError("CONFLICT")
        if (
          !prepared ||
          prepared.snapshot.catalogDigest !== source.snapshot.catalogDigest ||
          prepared.snapshot.downloadId !== source.snapshot.downloadId
        )
          throw new StudioCommandError("CONFLICT")
      }
      // Eligibility reads can wait on catalog locks. Recheck real wall time after them.
      if (job.leaseExpiresAt <= new Date())
        throw new StudioCommandError("CONFLICT")
      return tx.shortRenderPreparation.create({
        data: { ...input, inputHash: attempt.inputHash },
      })
    })
  }
}

/** Only the accepted successful lease can supply source authority. Historic jobs
 * without a preparation still must pass the original strict retained-source gate. */
export async function assertStudioCompletedRenderSources(
  tx: Prisma.TransactionClient,
  document: StudioDocument,
  attemptId: string,
) {
  const execution = await tx.shortRenderExecution.findFirst({
    where: { attemptId, admitted: true, status: "SUCCEEDED" },
    include: { lease: { include: { preparation: true } } },
  })
  const prepared = execution?.lease.preparation
  if (!prepared) return assertStudioRenderSources(tx, document)
  const attempt = await tx.shortAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  })
  if (prepared.inputHash !== attempt.inputHash)
    throw new StudioCommandError("CONFLICT")
  const materialized = studioDocumentSchema.parse(prepared.document)
  assertStudioMaterializationIdentity(document, materialized)
  return assertStudioRenderSources(tx, materialized)
}
