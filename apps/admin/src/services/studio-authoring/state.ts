import { orderedStudioSpeech } from "@forge/studio-contracts/production"
import { studioHash } from "@forge/studio-server"
export { studioHash } from "@forge/studio-server"
import type { Prisma, StudioProject } from "@prisma/client"
import {
  studioActorSchema,
  studioAttemptResultSchema,
  studioCommandResultSchema,
  type StudioActor,
  type StudioCommandResult,
  type StudioDocument,
  type StudioAssetReference,
} from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { canAuthorStudio, isStudioHuman } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "../errors"
import { StudioCommandError } from "./errors"

export function studioActor(user: Principal | null) {
  if (!canAuthorStudio(user)) throw new ForbiddenError()
  if (isStudioHuman(user))
    return studioActorSchema.parse({
      kind: "human",
      id: user!.id,
      authority: user!.studioAuthority,
      clientId: user!.studioClientId,
    })
  if (user?.role === "MANAGER_BACKEND" || user?.role === "SYSTEM")
    return studioActorSchema.parse({
      kind: "service",
      id: user.role.toLowerCase(),
    })
  throw new ForbiddenError()
}

export async function lockProject(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  await tx.$queryRaw`SELECT id FROM studio_project WHERE id = ${projectId} FOR UPDATE`
  const project = await tx.studioProject.findUnique({
    where: { id: projectId },
  })
  if (!project) throw new NotFoundError("StudioProject", projectId)
  return project
}
export function assertEditable(
  project: StudioProject,
  expectedRevision: number,
) {
  if (project.firstPublishedAt || project.lifecycle !== "DRAFT")
    throw new StudioCommandError("IMMUTABLE")
  if (project.currentRevision !== expectedRevision)
    throw new StudioCommandError("CONFLICT")
}
export async function receipt(
  tx: Prisma.TransactionClient,
  projectId: string,
  idempotencyKey: string,
  hash: string,
) {
  const prior = await tx.studioCommand.findUnique({
    where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
  })
  if (!prior) return null
  if (prior.inputHash !== hash) throw new StudioCommandError("CONFLICT")
  return studioCommandResultSchema.parse(prior.result)
}
export async function saveReceipt(
  tx: Prisma.TransactionClient,
  projectId: string,
  idempotencyKey: string,
  hash: string,
  actor: StudioActor,
  result: StudioCommandResult,
) {
  await tx.studioCommand.create({
    data: { projectId, idempotencyKey, inputHash: hash, actor, result },
  })
}

export function scriptHash(document: StudioDocument) {
  return studioHash({
    language: document.language,
    speech: orderedStudioSpeech(document).map((i) => ({
      id: i.id,
      speech: i.speech,
    })),
  })
}

export function publicationHash(
  document: StudioDocument,
  revision: number,
  inputHash: string,
  manifest: StudioAssetReference,
) {
  return studioHash({ document, revision, inputHash, manifest })
}

// Approval and publication must bind to the same successful, current render.
export async function publicationDependencyHash(
  tx: Prisma.TransactionClient,
  project: StudioProject,
  document: StudioDocument,
  renderAttemptId: string,
) {
  const attempt = await tx.studioAttempt.findUnique({
    where: { id: renderAttemptId },
  })
  if (
    !attempt ||
    attempt.projectId !== project.id ||
    attempt.baseRevision !== project.currentRevision ||
    attempt.kind !== "RENDER" ||
    attempt.status !== "SUCCEEDED"
  )
    throw new StudioCommandError("APPROVAL_REQUIRED")
  const render = studioAttemptResultSchema.parse(attempt.result)
  if (!render.manifest) throw new StudioCommandError("APPROVAL_REQUIRED")
  return publicationHash(
    document,
    project.currentRevision,
    attempt.inputHash,
    render.manifest,
  )
}
