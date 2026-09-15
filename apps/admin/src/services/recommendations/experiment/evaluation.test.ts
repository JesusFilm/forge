import { describe, expect, it, vi } from "vitest"
import { RecommendationExperimentEvaluationService } from "./evaluation"
import type { ExperimentCounts } from "./policy"

const windowStart = new Date("2026-08-01T00:00:00.000Z")
const windowEnd = new Date("2026-08-08T00:00:00.000Z")
const capturedAt = new Date("2026-08-09T00:00:00.000Z")

const experiment = {
  id: "semantic-aa-v1",
  experimentVersion: "semantic-aa-v1",
  generation: 1,
  configurationDigest: "b".repeat(64),
  challengerProbability: 0.5,
  assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
  outcomePolicyVersion: "active-watch-multi-outcome-v1",
  integrityPolicyVersion: "recommendation-integrity-v1",
  evaluationPolicyVersion: "recommendation-experiment-aa-v1",
  expiresAt: new Date("2028-01-01T00:00:00.000Z"),
}

const healthyCounts: ExperimentCounts = {
  controlAssigned: 100,
  challengerAssigned: 100,
  controlExposed: 80,
  challengerExposed: 75,
  controlSelections: 30,
  challengerSelections: 30,
  controlQualified: 20,
  challengerQualified: 20,
  controlMission: 5,
  challengerMission: 5,
  controlPlaybackErrors: 1,
  challengerPlaybackErrors: 1,
  contamination: 0,
  conflictingOutcomes: 0,
}

function harness(
  evidence: ExperimentCounts[] = [healthyCounts],
  options: { databaseEvidence?: boolean } = {},
) {
  const evaluations: Array<Record<string, unknown>> = []
  const runs = new Map([
    [
      "run-1",
      {
        id: "run-1",
        experimentId: experiment.id,
        windowStart,
        windowEnd,
        generation: 1,
        state: "CLAIMED",
        claimId: "11111111-1111-4111-8111-111111111111",
        experiment,
      },
    ],
    [
      "run-2",
      {
        id: "run-2",
        experimentId: experiment.id,
        windowStart,
        windowEnd,
        generation: 2,
        state: "CLAIMED",
        claimId: "22222222-2222-4222-8222-222222222222",
        experiment,
      },
    ],
  ])
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [healthyCounts]),
    recommendationExperimentEvaluationRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        runs.get(where.id),
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        const run = runs.get(where.id)
        if (
          !run ||
          run.generation !== where.generation ||
          run.claimId !== where.claimId ||
          run.state !== where.state
        )
          return { count: 0 }
        Object.assign(run, data)
        return { count: 1 }
      }),
    },
    recommendationExperimentEvaluation: {
      findUnique: vi.fn(async ({ where }) =>
        evaluations.find(
          (row) =>
            row.inputDigest ===
            where.experimentId_windowStart_windowEnd_inputDigest.inputDigest,
        ),
      ),
      findFirst: vi.fn(async () => evaluations.at(-1) ?? null),
      create: vi.fn(async ({ data }) => {
        evaluations.push(data)
        return data
      }),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (work) => work(tx)),
    recommendationExperimentEvaluationRun: {
      updateMany: tx.recommendationExperimentEvaluationRun.updateMany,
    },
  }
  let evidenceIndex = 0
  let id = 0
  const service = new RecommendationExperimentEvaluationService({
    prisma: prisma as never,
    now: () => capturedAt,
    newId: () => `evaluation-${++id}`,
    ...(options.databaseEvidence
      ? {}
      : {
          loadEvidence: async () => ({
            counts: evidence[Math.min(evidenceIndex++, evidence.length - 1)]!,
            watermarks: {
              assignment: windowEnd,
              exposure: windowEnd,
              outcome: windowEnd,
              mission: windowEnd,
              eligibility: windowEnd,
            },
          }),
        }),
  })
  return { service, evaluations, runs, tx }
}

describe("RecommendationExperimentEvaluationService", () => {
  it("publishes immutable ITT evidence and late evidence supersedes it", async () => {
    const lateEvidence = {
      ...healthyCounts,
      challengerPlaybackErrors: 10,
    }
    const { service, evaluations } = harness([healthyCounts, lateEvidence])

    await expect(
      service.evaluateClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        expectedExperimentGeneration: 1,
        claimId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      status: "published",
      revision: 1,
      state: "pass",
    })
    await expect(
      service.evaluateClaimedRun({
        runId: "run-2",
        expectedGeneration: 2,
        expectedExperimentGeneration: 1,
        claimId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toMatchObject({
      status: "published",
      revision: 2,
      state: "fail",
    })

    expect(evaluations).toHaveLength(2)
    expect(evaluations[1]).toMatchObject({
      supersedesId: evaluations[0]?.id,
      revision: 2,
      counts: expect.objectContaining({
        controlAssigned: 100,
        controlExposed: 80,
      }),
      intentToTreat: expect.objectContaining({ primary: true }),
      exposedOnly: expect.objectContaining({ primary: false }),
    })
  })

  it("fences stale workflow claims and experiment generations", async () => {
    const { service, runs } = harness()
    await expect(
      service.evaluateClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        expectedExperimentGeneration: 2,
        claimId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({
      status: "fenced",
      reason: "experiment_generation_changed",
    })
    expect(runs.get("run-1")?.state).toBe("FENCED")

    await expect(
      service.evaluateClaimedRun({
        runId: "run-2",
        expectedGeneration: 2,
        expectedExperimentGeneration: 1,
        claimId: "wrong-claim",
      }),
    ).resolves.toEqual({ status: "fenced", reason: "claim_lost" })
  })

  it("admits only impression-qualified selections to experiment evidence", async () => {
    const { service, tx } = harness([healthyCounts], {
      databaseEvidence: true,
    })

    await expect(
      service.evaluateClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        expectedExperimentGeneration: 1,
        claimId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({ status: "published" })

    const query = (tx.$queryRaw.mock.calls as unknown[][])[0]?.[0] as {
      sql?: string
      text?: string
      strings?: string[]
    }
    const sql = String(query.sql ?? query.text ?? query.strings)
    expect(sql).toContain("attribution_eligible_episodes")
    expect(sql).toContain("selection.attribution_eligible_at <=")
    expect(sql).toContain("JOIN attribution_eligible_episodes episode")
  })
})
