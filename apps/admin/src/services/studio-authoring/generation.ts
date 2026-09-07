import { proposalSpeech } from "./proposal-speech"
import { ForbiddenError } from "../errors"
import { studioGenerationOutputSchema } from "@forge/studio-contracts/generation"
import {
  studioCompleteSchema,
  studioIdSchema,
  studioAssetReferenceSchema,
} from "@forge/studio-contracts"
import {
  StudioAssetService,
  readVerifiedStudioAsset,
  resolveAssetVersion,
} from "./assets"
import { studioActor, studioHash } from "./state"
import { z } from "zod"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  studioValidateProposalSchema,
  validateStudioRoleCoverage,
} from "@forge/studio-contracts/production"
import { StudioAuthoringService } from "./index"
import { applyOperations } from "./operations"
import { StudioCommandError } from "./errors"
import { resolveStudioDocumentSources } from "./sources"
/** Read-only canonical projection; validated proposals still require an explicit apply command. */
export class StudioGenerationService {
  constructor(private readonly db: PrismaClient) {}
  async complete(user: Principal | null, raw: unknown, rawOutput: unknown) {
    if (studioActor(user).kind !== "service") throw new ForbiddenError()
    const input = studioCompleteSchema.parse(raw),
      output = studioGenerationOutputSchema.parse(rawOutput)
    const attempt = await this.db.studioAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    })
    if (
      attempt.kind !== "GENERATION" ||
      attempt.projectId !== input.projectId ||
      attempt.baseRevision !== input.expectedRevision ||
      input.operations.length
    )
      throw new StudioCommandError("INVALID")
    const asset = await new StudioAssetService(this.db).register(
      user,
      {
        idempotencyKey: `${attempt.id}:generation-output`,
        filename: "generation-output.json",
        mimeType: "application/json",
        role: "manifest",
        provenance: {
          status: "recorded",
          recorded: {
            attemptId: attempt.id,
            projectId: attempt.projectId,
            revision: attempt.baseRevision,
            instructions: attempt.instructions,
          },
        },
      },
      Buffer.from(JSON.stringify(output)),
    )
    return new StudioAuthoringService(this.db).complete(user, {
      ...input,
      result: { ...input.result, manifest: asset.reference },
    })
  }
  async read(user: Principal | null, raw: unknown) {
    studioActor(user)
    const input = z
      .object({
        attemptId: studioIdSchema,
        proposalIndex: z.number().int().min(0).max(31).default(0),
      })
      .strict()
      .parse(raw)
    const attempt = await this.db.studioAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    })
    if (attempt.kind !== "GENERATION") throw new StudioCommandError("INVALID")
    const manifest = z
      .object({ manifest: studioAssetReferenceSchema })
      .parse(attempt.result).manifest
    const output = studioGenerationOutputSchema.parse(
      JSON.parse(
        (await readVerifiedStudioAsset(this.db, manifest, 262144)).toString(),
      ),
    )
    const base = await new StudioAuthoringService(this.db).readRevision(
      user,
      attempt.projectId,
      attempt.baseRevision,
    )
    const previews = []
    for (const proposal of output.proposals.slice(
      input.proposalIndex,
      input.proposalIndex + 1,
    )) {
      if (
        proposal.command.projectId !== attempt.projectId ||
        proposal.command.expectedRevision !== attempt.baseRevision
      )
        throw new StudioCommandError("INVALID")
      const document = applyOperations(
        base.document,
        proposal.command.operations,
      )
      if (proposal.quality)
        validateStudioRoleCoverage(document, proposal.quality.coverage)
      const sources = await this.db.$transaction((tx) =>
        resolveStudioDocumentSources(tx, document),
      )
      previews.push({
        proposal,
        document,
        sources: sources.map((source) => ({
          itemId: source.itemId,
          snapshot: source.snapshot.id,
          startMs: source.startMs,
          endMs: source.endMs,
          startFrame: source.startFrame,
          eligibility: source.eligibility,
        })),
      })
    }
    return {
      attemptId: attempt.id,
      projectId: attempt.projectId,
      revision: attempt.baseRevision,
      status: attempt.status,
      instructions: attempt.instructions,
      manifest,
      text: output.text,
      diagnostics: output.diagnostics,
      proposalCount: output.proposals.length,
      proposalIndex: input.proposalIndex,
      previews,
    }
  }
  async validate(user: Principal | null, raw: unknown) {
    const { command, quality } = studioValidateProposalSchema.parse(raw)
    const project = await new StudioAuthoringService(this.db).read(
      user,
      command.projectId,
    )
    if (project.revision !== command.expectedRevision)
      throw new StudioCommandError("CONFLICT")
    const operationsDigest = studioHash(command.operations)
    const document = applyOperations(
      project.document,
      structuredClone(command.operations),
    )
    if (quality) {
      validateStudioRoleCoverage(document, quality.coverage)
      if (
        quality.findings.some((f) =>
          f.itemIds.some((id) => !document.items.some((i) => i.id === id)),
        )
      )
        throw new StudioCommandError("INVALID")
      const references = new Map(
        quality.findings
          .flatMap((finding) => finding.sources)
          .map((reference) => [JSON.stringify(reference), reference]),
      )
      for (const reference of references.values())
        await resolveAssetVersion(this.db, reference)
    }
    await this.db.$transaction((tx) =>
      resolveStudioDocumentSources(tx, document),
    )
    return {
      valid: true,
      projectId: project.projectId,
      revision: project.revision,
      quality,
      effectiveSpeech: proposalSpeech(document, command, operationsDigest),
    }
  }
}
