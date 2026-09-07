import type { PrismaClient } from "@prisma/client"
import {
  studioExperimentRequestSchema,
  studioExperimentCandidateSchema,
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
    if (actor.kind !== "human")
      throw new ForbiddenError("Explicit human experiment admission required")
    const input = studioExperimentRequestSchema.parse(raw)
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
          Number(prior.actualCostMicros) !== input.actualCostMicros
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
        experiment.candidates.length >= request.candidateCount ||
        experiment.candidates.reduce(
          (n, c) => n + Number(c.actualCostMicros),
          input.actualCostMicros,
        ) > request.maxCostMicros
      )
        throw new StudioCommandError("INVALID")
      return tx.studioExperimentCandidate.create({
        data: {
          ...input,
          actualCostMicros: BigInt(input.actualCostMicros),
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
    return {
      ...row,
      candidates: row.candidates.map((c) => ({
        ...c,
        actualCostMicros: Number(c.actualCostMicros),
      })),
    }
  }
}
