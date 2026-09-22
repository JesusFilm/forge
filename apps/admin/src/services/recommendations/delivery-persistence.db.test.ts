import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "@/db/client"
import * as evidencePersistence from "./candidate-evidence-persistence"
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
