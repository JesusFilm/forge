import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "@/db/client"
import { loadRecommendationRequestDetail } from "./admin-ops/detail.service"
import * as evidencePersistence from "./candidate-evidence-persistence"
import { runSemanticCandidatePlatform } from "./orchestration"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"

// Full migrations must be applied to an owned database. Retrieval/token fixtures
// are synthetic; persistence, constraints, triggers and adapter are real.
describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "delivery persistence observation",
  () => {
    const prisma = createPrismaClient("main")
    const controller = new Client({
      connectionString: process.env.DATABASE_URL,
    })
    const seeds: string[] = []
    beforeAll(async () => {
      await controller.connect()
    })
    afterAll(async () => {
      await prisma.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await prisma.$disconnect()
      await controller.end()
    })

    it("returns identical complete Admin stage detail from actual legacy and compact writes", async () => {
      const candidates = semanticCandidates(12)
      candidates[1] = {
        ...candidates[1],
        videoCoreId: candidates[0].videoCoreId,
      }
      candidates[11] = {
        ...candidates[11],
        sourceRejectionReason: "fixture_rejected",
      }
      const details = []
      for (const format of ["legacy", "compact"] as const) {
        const harness = makeHarness({
          database: prisma,
          candidateTraceFormat: format,
        })
        harness.retrieve.mockResolvedValue(candidates)
        const seed = `detail-parity-${format}-${randomUUID()}`
        seeds.push(seed)
        const response = await harness.service.deliver(input(seed))
        expect(response.result).toBe("served")
        const run = await prisma.recommendationCandidateRun.findUniqueOrThrow({
          where: { requestId: response.requestId! },
        })
        const legacyRows =
          await prisma.recommendationCandidateStageEvidence.count({
            where: { runId: run.id },
          })
        if (format === "compact") {
          expect(run.traceFormatVersion).toBe(1)
          expect(legacyRows).toBe(0)
        } else {
          expect(run.tracePayload).toBeNull()
          expect(legacyRows).toBeGreaterThan(0)
        }
        const detail = await loadRecommendationRequestDetail(prisma, {
          requestId: response.requestId!,
          actorDigest: "a".repeat(64),
        })
        expect(detail?.candidateExecution).not.toBeNull()
        details.push(detail!.candidateExecution)
      }
      const stages = details[0]!.stages
      expect(new Set(stages.map((stage) => stage.stage))).toEqual(
        new Set([
          "nominated",
          "canonicalized",
          "deduplicated",
          "rejected",
          "scored",
          "ordered",
          "composed",
        ]),
      )
      expect(stages.some((stage) => stage.reasonCodes.length > 0)).toBe(true)
      expect(
        stages.some(
          (stage) => stage.sourceCount > 1 && stage.contributors.length > 1,
        ),
      ).toBe(true)
      expect(stages.some((stage) => stage.deterministicScore != null)).toBe(
        true,
      )
      expect(details[1]).toEqual(details[0])
    })

    it("commits a complete compact trace and atomically rejects invalid evidence", async () => {
      const harness = makeHarness({
        database: prisma,
        candidateTraceFormat: "compact",
      })
      harness.retrieve.mockResolvedValue(semanticCandidates(32))
      const seed = `compact-observation-${randomUUID()}`
      seeds.push(seed)
      const response = await harness.service.deliver(input(seed))
      expect(response.result).toBe("served")
      const run = await prisma.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: response.requestId! },
      })
      expect(run.traceFormatVersion).toBe(1)
      const payload = run.tracePayload as {
        stages: Array<Record<string, unknown>>
      }
      expect(payload.stages.length).toBeGreaterThan(32)
      expect(payload.stages[0]).toMatchObject({
        id: expect.any(String),
        stage: "nominated",
        ordinal: 0,
        createdAt: expect.any(String),
        sourceEvidence: expect.any(Array),
      })
      expect(payload.stages[0]).not.toHaveProperty("runId")
      expect(payload.stages[0]).not.toHaveProperty("expiresAt")
      expect(
        await prisma.recommendationCandidateStageEvidence.count({
          where: { runId: run.id },
        }),
      ).toBe(0)

      const failing = makeHarness({
        database: prisma,
        candidateTraceFormat: "compact",
      })
      failing.retrieve.mockResolvedValue(semanticCandidates(32))
      failing.orchestrate.mockImplementation((...args) => {
        const result = runSemanticCandidatePlatform(...args)
        return {
          ...result,
          evidence: result.evidence.map((entry, index) =>
            index === 0 ? { ...entry, sourceScore: 2 } : entry,
          ),
        }
      })
      const invalidSeed = `compact-invalid-${randomUUID()}`
      seeds.push(invalidSeed)
      const rejected = await failing.service.deliver(input(invalidSeed))
      expect(rejected.result).toBe("unavailable")
      expect(
        await prisma.recommendationRequest.count({
          where: { seedMediaId: invalidSeed },
        }),
      ).toBe(0)
    })

    it("preserves every evidence field against createMany and observes the commit", async () => {
      const harness = makeHarness({ database: prisma })
      harness.retrieve.mockResolvedValue(semanticCandidates(32))
      const seed = `observation-${randomUUID()}`
      seeds.push(seed)
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      const insert = vi.spyOn(
        evidencePersistence,
        "persistCandidateStageEvidence",
      )
      try {
        const response = await harness.service.deliver(input(seed))
        expect(response.result).toBe("served")
        expect(response.items).toHaveLength(6)
        const run = await prisma.recommendationCandidateRun.findUniqueOrThrow({
          where: { requestId: response.requestId! },
        })
        const persisted =
          await prisma.recommendationCandidateStageEvidence.count({
            where: { runId: run.id },
          })
        const event = log.mock.calls
          .map(([line]) => JSON.parse(String(line)))
          .find(
            (row) =>
              row.event === "recommendation.runtime" &&
              row.phase === "complete",
          )
        expect(event.timings["candidate_evidence.insert"]).toMatchObject({
          calls: 1,
          errors: 0,
          inputRows: persisted,
        })
        expect(event.timings["transaction.commit_ack"]).toMatchObject({
          calls: 1,
          errors: 0,
          inFlight: 0,
        })
        expect(persisted).toBeGreaterThan(32)
        const rows = insert.mock.calls[0][1]
        const actual =
          await prisma.recommendationCandidateStageEvidence.findMany({
            where: { runId: run.id },
          })
        for (const row of rows)
          expect(actual.find((value) => value.id === row.id)).toMatchObject(row)
        await prisma.$transaction(async (tx) => {
          const parityRows = rows.map((row) => ({
            ...row,
            createdAt: new Date(),
          }))
          await tx.recommendationCandidateStageEvidence.deleteMany({
            where: { runId: run.id },
          })
          await tx.recommendationCandidateStageEvidence.createMany({
            data: parityRows,
          })
          const legacy = await tx.recommendationCandidateStageEvidence.findMany(
            { where: { runId: run.id }, orderBy: { id: "asc" } },
          )
          await tx.recommendationCandidateStageEvidence.deleteMany({
            where: { runId: run.id },
          })
          await evidencePersistence.persistCandidateStageEvidence(
            tx,
            parityRows,
          )
          expect(
            await tx.recommendationCandidateStageEvidence.findMany({
              where: { runId: run.id },
              orderBy: { id: "asc" },
            }),
          ).toEqual(legacy)
        })
        // Real constraints reject a whole batch and preserve the old committed
        // evidence. No ON CONFLICT, dropped rows or independent audit commits.
        for (const invalid of [
          { ...rows[0], sourceScore: 2 },
          { ...rows[0], expiresAt: new Date(0) },
          { ...rows[0], sourceScore: Number.NaN },
        ]) {
          await expect(
            prisma.$transaction(async (tx) => {
              await tx.recommendationCandidateStageEvidence.deleteMany({
                where: { runId: run.id },
              })
              await evidencePersistence.persistCandidateStageEvidence(tx, [
                rows[1],
                invalid,
              ])
            }),
          ).rejects.toBeDefined()
          expect(
            await prisma.recommendationCandidateStageEvidence.count({
              where: { runId: run.id },
            }),
          ).toBe(persisted)
        }
      } finally {
        insert.mockRestore()
        log.mockRestore()
      }
    })

    it("identifies a blocked evidence insert and leaves no partially issued request", async () => {
      const harness = makeHarness({ database: prisma })
      harness.retrieve.mockResolvedValue(semanticCandidates(32))
      const seed = `observation-${randomUUID()}`
      seeds.push(seed)
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      await controller.query("BEGIN")
      await controller.query(
        "LOCK TABLE recommendation_candidate_stage_evidence IN ACCESS EXCLUSIVE MODE",
      )
      try {
        const response = await harness.service.deliver(input(seed))
        expect(response.result).toBe("unavailable")
        const event = log.mock.calls
          .map(([line]) => JSON.parse(String(line)))
          .find(
            (row) =>
              row.event === "recommendation.runtime" &&
              row.phase === "complete",
          )
        expect(event.timings.persistence.errors).toBe(1)
        const insert = event.timings["candidate_evidence.insert"]
        expect(insert.calls).toBe(1)
        expect(insert.errors + insert.inFlight).toBe(1)
      } finally {
        await controller.query("ROLLBACK")
        log.mockRestore()
      }
      // Wait for the blocked statement/rollback to settle on the same pool.
      expect(
        await prisma.recommendationRequest.count({
          where: { seedMediaId: seed },
        }),
      ).toBe(0)
    })
  },
)
