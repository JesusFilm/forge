import { assertStudioProductionEnabled } from "./release-controls"
import { StudioProductionPreflightError } from "./errors"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import { canReviewStudio } from "@/auth/permissions"
import type { PrismaClient } from "@prisma/client"
import {
  studioExperimentSelectionSchema,
  studioExperimentRequestSchema,
  studioExperimentCandidateSchema,
  studioExperimentOutcomeSchema,
} from "@forge/studio-contracts/experiments"
import type { Principal } from "@/auth/principal"
import { studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"
import { ForbiddenError, NotFoundError } from "../errors"
import { studioRegisterAssetSchema } from "@forge/studio-contracts/assets"
import { resolveAssetVersion } from "./assets"

/** Admission and retained candidates only. There is deliberately no provider dispatch. */
export class StudioExperimentService {
  constructor(private readonly db: PrismaClient) {}
  async request(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (!canReviewStudio(user))
      throw new ForbiddenError("Explicit human experiment admission required")
    const input = studioExperimentRequestSchema.parse(raw)
    if (input.kind === "voice" && input.provider === "elevenlabs") {
      const code = input.settings.languageCode
      const language = await this.db.language.findUnique({
        where: { slug: input.language },
        select: { bcp47: true },
      })
      if (
        typeof code !== "string" ||
        code !== (language?.bcp47 ?? input.language) ||
        !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(code)
      )
        throw new StudioProductionPreflightError(
          "Voice design language must match the canonical author language",
        )
    }
    const requestKey = studioHash({ actor, key: input.idempotencyKey }),
      requestHash = studioHash(input)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 455))::text`
      const prior = await tx.studioExperiment.findUnique({
        where: { requestKey },
      })
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new StudioCommandError("CONFLICT")
        return prior
      }
      assertStudioProductionEnabled()
      if (
        Date.parse(input.estimate.expiresAt) <= Date.now() ||
        input.maxCostMicros < input.estimate.amountMicros
      )
        throw new StudioCommandError("INVALID")
      return tx.studioExperiment.create({
        data: { request: input, actor, requestKey, requestHash },
      })
    })
  }
  async addCandidate(user: Principal | null, raw: unknown) {
    const actor = studioActor(user)
    if (actor.kind !== "service")
      throw new ForbiddenError(
        "Only trusted execution can attach experiment candidates",
      )
    const input = studioExperimentCandidateSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_experiment WHERE id=${input.experimentId} FOR UPDATE`
      const experiment = await tx.studioExperiment.findUnique({
        where: { id: input.experimentId },
        include: { candidates: true },
      })
      if (!experiment) throw new NotFoundError("StudioExperiment")
      const prior = experiment.candidates.find(
        (c) => c.candidateKey === input.candidateKey,
      )
      if (prior) {
        if (
          studioHash(prior.asset) !== studioHash(input.asset) ||
          prior.providerRequestId !== input.providerRequestId ||
          (prior.actualCostMicros === null
            ? null
            : Number(prior.actualCostMicros)) !== input.actualCostMicros
        )
          throw new StudioCommandError("CONFLICT")
        return prior
      }
      const request = studioExperimentRequestSchema.parse(experiment.request)
      const version = await resolveAssetVersion(tx, input.asset),
        metadata = studioRegisterAssetSchema.parse(version.metadata)
      const recorded = metadata.provenance.recorded
      if (
        version.role !== request.kind ||
        metadata.provenance.status !== "recorded" ||
        recorded.experimentId !== experiment.id ||
        recorded.provider !== request.provider ||
        recorded.model !== request.model ||
        recorded.prompt !== request.prompt ||
        recorded.language !== request.language ||
        recorded.settings === undefined ||
        studioHash(recorded.settings) !== studioHash(request.settings)
      )
        throw new StudioCommandError("INVALID")
      return tx.studioExperimentCandidate.create({
        data: {
          ...input,
          actualCostMicros:
            input.actualCostMicros === null
              ? null
              : BigInt(input.actualCostMicros),
          actor,
        },
      })
    })
  }
  async select(user: Principal | null, raw: unknown) {
    if (!canReviewStudio(user))
      throw new ForbiddenError("Interactive candidate selection required")
    const actor = studioActor(user),
      input = studioExperimentSelectionSchema.parse(raw)
    const requestKey = studioHash({ actor, key: input.idempotencyKey }),
      inputHash = studioHash(input)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_experiment WHERE id=${input.experimentId} FOR UPDATE`
      const prior = await tx.studioExperimentSelection.findUnique({
        where: { requestKey },
      })
      if (prior) {
        if (prior.inputHash !== inputHash)
          throw new StudioCommandError("CONFLICT")
        return prior
      }
      const candidate = await tx.studioExperimentCandidate.findUniqueOrThrow({
        where: { candidateKey: input.candidateKey },
      })
      if (candidate.experimentId !== input.experimentId)
        throw new StudioCommandError("INVALID")
      const asset =
        input.registeredVoice ??
        studioAssetReferenceSchema.parse(candidate.asset)
      if (input.registeredVoice) {
        const version = await resolveAssetVersion(tx, input.registeredVoice),
          metadata = studioRegisterAssetSchema.parse(version.metadata)
        if (
          version.role !== "voice" ||
          metadata.provenance.recorded.registrationStatus !== "registered" ||
          metadata.provenance.recorded.candidateKey !==
            candidate.candidateKey ||
          metadata.provenance.recorded.experimentId !== input.experimentId
        )
          throw new StudioCommandError("INVALID")
      }
      return tx.studioExperimentSelection.create({
        data: {
          experimentId: input.experimentId,
          candidateKey: input.candidateKey,
          requestKey,
          inputHash,
          asset,
          actor,
        },
      })
    })
  }
  async read(user: Principal | null, id: string) {
    studioActor(user)
    const row = await this.db.studioExperiment.findUnique({
      where: { id },
      include: { candidates: true },
    })
    if (!row) throw new NotFoundError("StudioExperiment")
    const request = studioExperimentRequestSchema.parse(row.request)
    const actualCost = row.candidates.reduce(
      (sum, c) => sum + (c.actualCostMicros ?? 0n),
      0n,
    )
    const costUnknown = row.candidates.some((c) => c.actualCostMicros === null)
    const costExceeded = actualCost > BigInt(request.maxCostMicros)
    const countExceeded = row.candidates.length > request.candidateCount
    return {
      ...row,
      selection: await this.db.studioExperimentSelection.findFirst({
        where: { experimentId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      outcome: studioExperimentOutcomeSchema.parse({
        status:
          costExceeded || countExceeded
            ? "OVERRUN"
            : costUnknown
              ? "COST_UNKNOWN"
              : "WITHIN_LIMITS",
        actualCostMicros: costUnknown ? null : actualCost.toString(),
        candidateCount: row.candidates.length,
        costExceeded,
        countExceeded,
      }),
      candidates: row.candidates.map((c) => ({
        ...c,
        actualCostMicros:
          c.actualCostMicros === null ? null : Number(c.actualCostMicros),
      })),
    }
  }
}
