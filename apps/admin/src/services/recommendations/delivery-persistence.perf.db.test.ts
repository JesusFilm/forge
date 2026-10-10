import type { Prisma } from "@prisma/client"
import * as evidencePersistence from "./candidate-evidence-persistence"
import { timeRecommendationOperation } from "@/lib/recommendation-runtime-observation"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { afterAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "@/db/client"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "./delivery.service.test-helpers"

// Explicit opt-in: real persistence with synthetic retrieval/token providers.
// This does not establish production end-to-end or storage-equivalent latency.
describe.skipIf(process.env.WATCH_PERSISTENCE_BENCHMARK !== "1")(
  "persistence workload",
  () => {
    const prisma = createPrismaClient("main")
    const seeds: string[] = []
    afterAll(async () => {
      await prisma.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await prisma.$disconnect()
    })
    it("compares evidence batches at ten concurrent requests in ABBA order", async () => {
      const results: unknown[] = []
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      const original = evidencePersistence.persistCandidateStageEvidence
      const insert = vi.spyOn(
        evidencePersistence,
        "persistCandidateStageEvidence",
      )
      let totalIssued = 0
      try {
        for (const variant of ["legacy", "bulk", "bulk", "legacy"]) {
          const concurrency = 10
          insert.mockImplementation(
            variant === "bulk"
              ? original
              : (tx, rows) =>
                  timeRecommendationOperation(
                    "candidate_evidence.insert",
                    async () =>
                      (
                        await (
                          tx as Prisma.TransactionClient
                        ).recommendationCandidateStageEvidence.createMany({
                          data: [...rows],
                        })
                      ).count,
                    rows.length,
                  ),
          )
          const elapsed: number[] = [],
            persistence: number[] = [],
            rowCounts: number[] = []
          const begin = performance.now()
          const stageMs: Record<string, number[]> = {}
          let issued = 0
          for (let round = 0; round < 20; round++) {
            await Promise.all(
              Array.from({ length: concurrency }, async () => {
                const harness = makeHarness({ database: prisma })
                harness.retrieve.mockResolvedValue(semanticCandidates(64))
                const seed = `persistence-bench-${randomUUID()}`
                seeds.push(seed)
                const started = performance.now()
                const response = await harness.service.deliver(input(seed))
                elapsed.push(performance.now() - started)
                if (response.result === "served") issued++
              }),
            )
          }
          for (const [line] of log.mock.calls) {
            if (typeof line !== "string" || !line.startsWith("{")) continue
            const event = JSON.parse(line)
            if (
              event.event !== "recommendation.runtime" ||
              event.phase !== "complete"
            )
              continue
            for (const [label, timing] of Object.entries(event.timings) as [
              string,
              { elapsedMs: number },
            ][]) {
              ;(stageMs[label] ??= []).push(timing.elapsedMs)
            }
            if (event.timings.persistence)
              persistence.push(event.timings.persistence.elapsedMs)
            const evidence = event.timings["candidate_evidence.insert"]
            if (evidence) rowCounts.push(evidence.inputRows)
          }
          log.mockClear()
          const distribution = (values: number[]) => {
            const sorted = [...values].sort((a, b) => a - b)
            return {
              count: sorted.length,
              p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
              p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
              p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
              max: sorted.at(-1),
            }
          }
          results.push({
            stages: Object.fromEntries(
              Object.entries(stageMs).map(([label, values]) => [
                label,
                distribution(values),
              ]),
            ),
            variant,
            concurrency,
            wallMs: performance.now() - begin,
            issued,
            failures: elapsed.length - issued,
            serviceMs: distribution(elapsed),
            persistenceMs: distribution(persistence),
            evidenceRows: distribution(rowCounts),
          })
          totalIssued += issued
          expect(
            await prisma.recommendationRequest.count({
              where: { seedMediaId: { in: seeds } },
            }),
          ).toBe(totalIssued)
        }
        writeFileSync(
          process.env.WATCH_PERSISTENCE_BENCHMARK_OUTPUT!,
          JSON.stringify(
            {
              capturedAt: new Date().toISOString(),
              fixture:
                "real migrations and adapter, synthetic sixty-four-candidate retrieval, alternating original createMany and single-payload insert",
              results,
            },
            null,
            2,
          ),
        )
      } finally {
        insert.mockRestore()
        log.mockRestore()
      }
    }, 120_000)
  },
)
