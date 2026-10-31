import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "@/db/client"
import {
  makeHarness,
  input,
  semanticCandidates,
} from "../services/recommendations/delivery.service.test-helpers"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"
import {
  executeRetirementWave,
  freezeRetirementWave,
  validateWaveInput,
} from "./retire-legacy-recommendation-detail-wave"

const revision = "a".repeat(40)
vi.mock("../config/env", () => ({ env: { DD_VERSION: "a".repeat(40) } }))
vi.mock("../services/recommendations/legacy-quality-holds", () => ({
  assertOriginalQualityHolds: vi.fn(),
}))

const sha = (value: unknown) =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex")
const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
]
const sourceHashes = Object.fromEntries(
  sourceFiles.map((file) => [file, sha(readFileSync(file))]),
)
const entrypointSha256 = sha(
  readFileSync("src/scripts/retire-legacy-recommendation-detail-wave.ts"),
)

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "batch wave CLI PostgreSQL proof",
  () => {
    const db = createPrismaClient("main")
    const seeds: string[] = []
    const dirs: string[] = []
    const cutoff = new Date(Date.now() - 86_400_000).toISOString()
    const holds = {
      qualitySelectorSha256:
        "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1",
      qualityRunIds: Array.from(
        { length: 64 },
        (_, index) => `quality-${index}`,
      ),
      activeInvestigationRunIds: [] as string[],
    }
    beforeAll(async () => {
      if (
        !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(
          process.env.DATABASE_URL ?? "",
        )
      )
        throw new Error(
          "Native proof requires an exclusively owned loopback database",
        )
    })
    afterAll(async () => {
      for (const directory of dirs)
        rmSync(directory, { recursive: true, force: true })
      await db.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await db.$disconnect()
    })

    async function fixture() {
      const harness = makeHarness({
        database: db,
        candidateTraceFormat: "legacy",
      })
      harness.retrieve.mockResolvedValue(semanticCandidates(3))
      const seed = `wave-native-${randomUUID()}`
      seeds.push(seed)
      const delivered = await harness.service.deliver(input(seed))
      expect(delivered.result).toBe("served")
      const run = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { requestId: delivered.requestId! },
      })
      await db.$executeRaw`UPDATE recommendation_request SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.requestId}`
      await db.$executeRaw`UPDATE recommendation_candidate_run SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.id}`
      return run
    }

    it("freezes two batches without writes, then retires and losslessly converts with exact receipts", async () => {
      const [protectedRun, retiredRun, incompleteRun] = await Promise.all([
        fixture(),
        fixture(),
        fixture(),
      ])
      await db.$executeRaw`UPDATE recommendation_candidate_run SET evidence_complete=false WHERE id=${incompleteRun.id}`
      if (process.env.LEGACY_QUALITY_HOLDS_FILE) {
        const original = JSON.parse(
          readFileSync(process.env.LEGACY_QUALITY_HOLDS_FILE, "utf8"),
        )
        holds.qualityRunIds = original.qualityRunIds
        holds.qualitySelectorSha256 = original.qualitySelectorSha256
      }
      holds.activeInvestigationRunIds = [protectedRun.id]
      const all = [protectedRun, retiredRun, incompleteRun]
      const before = await Promise.all(
        all.map(async (run) => ({
          id: run.id,
          root: await db.recommendationRequest.findUniqueOrThrow({
            where: { id: run.requestId },
          }),
          items: await db.recommendationServedItem.findMany({
            where: { requestId: run.requestId },
          }),
          stages: await db.recommendationCandidateStageEvidence.findMany({
            where: { runId: run.id },
          }),
        })),
      )
      const rows = before.map((item) => {
        const run = all.find((candidate) => candidate.id === item.id)!
        const baseline = {
          id: run.id,
          stage_count: item.stages.length,
          declared_stage_count:
            run.nominatedCount +
            run.canonicalizedCount +
            run.deduplicatedCount +
            run.rejectedCount +
            run.scoredCount +
            run.orderedCount +
            run.composedCount,
          trace_format_version: null,
          legacy_detail_retired_at: null,
          expires_at: run.expiresAt.toISOString(),
          root_expires_at: item.root.expiresAt.toISOString(),
        }
        return {
          runId: run.id,
          declaredStageRows: baseline.declared_stage_count,
          expiresAt: run.expiresAt.toISOString(),
          stageRows: baseline.stage_count,
          baseline,
          baselineSha256: sha(baseline),
        }
      })
      const wave = {
        index: 0,
        plannedEnd: new Date(Date.now() + 600_000).toISOString(),
        batches: [
          rows.slice(0, 2).sort((a, b) => a.runId.localeCompare(b.runId)),
          rows.slice(2),
        ],
      }
      const target = await conversionDatabaseHash(db)
      const inputWave = validateWaveInput({
        masterDigest: "d".repeat(64),
        masterHeader: {
          digest: "d".repeat(64),
          targetDatabaseHash: target,
          createdBefore: cutoff,
          originalRevision: revision,
          sourceHashes,
          selectionReceiptSha256: "e".repeat(64),
        },
        waveIndex: 0,
        waveDigest: sha(wave),
        wave,
        expectedRevision: revision,
        sourceHashes,
        entrypointSha256,
        holdsEnvelope: {
          reviewedAt: new Date().toISOString(),
          sourceReceiptSha256: "f".repeat(64),
          holds,
        },
        capacity: {
          measuredAt: new Date().toISOString(),
          targetDatabaseHash: target,
          filesystemAvailableBytes: 10_000_000_000,
          walBytes: 100_000_000,
          httpHealthy: true,
          workerHealthy: true,
          compactWritersConverged: true,
          retentionHealthy: true,
        },
      })
      const directory = mkdtempSync(join(tmpdir(), "forge-batch-native-"))
      dirs.push(directory)
      const child = (script: string, args: string[]) => {
        const result = spawnSync("pnpm", ["exec", "tsx", script, ...args], {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 60_000,
          env: { ...process.env, NEXT_PUBLIC_DATADOG_VERSION: revision },
        })
        expect(result.status).toBe(0)
        return result
      }
      let oldFreezeMs: number | undefined
      if (process.env.LEGACY_QUALITY_HOLDS_FILE) {
        const holdsFile = join(directory, "holds.json")
        writeFileSync(holdsFile, JSON.stringify(holds))
        const oldStarted = performance.now()
        for (const [index, batch] of inputWave.wave.batches.entries()) {
          const idsFile = join(directory, `ids-${index}.json`)
          writeFileSync(idsFile, JSON.stringify(batch.map((row) => row.runId)))
          child("src/scripts/retire-legacy-recommendation-detail.ts", [
            "--freeze",
            join(directory, `old-manifest-${index}.json`),
            "--holds",
            holdsFile,
            "--run-ids",
            idsFile,
            "--created-before",
            cutoff,
          ])
        }
        oldFreezeMs = Math.round(performance.now() - oldStarted)
      }
      const freezeStarted = performance.now()
      if (process.env.LEGACY_QUALITY_HOLDS_FILE) {
        const inputFile = join(directory, "wave-input.json")
        writeFileSync(inputFile, JSON.stringify(inputWave))
        child("src/scripts/retire-legacy-recommendation-detail-wave.ts", [
          "--freeze-wave",
          "--input",
          inputFile,
          "--manifest-dir",
          directory,
        ])
      } else {
        await freezeRetirementWave(db, inputWave, directory, () => inputWave)
      }
      const freezeMs = Math.round(performance.now() - freezeStarted)
      const manifests = [0, 1].map((index) =>
        JSON.parse(
          readFileSync(
            join(directory, `manifest-${String(index).padStart(2, "0")}.json`),
            "utf8",
          ),
        ),
      )
      expect(
        manifests
          .flatMap((manifest) =>
            manifest.candidates.map(
              (candidate: { action: string }) => candidate.action,
            ),
          )
          .sort(),
      ).toEqual(["preserve", "retire", "convert"].sort())
      expect(
        await db.recommendationCandidateStageEvidence.count({
          where: { runId: { in: all.map((run) => run.id) } },
        }),
      ).toBe(before.reduce((count, item) => count + item.stages.length, 0))
      const manifestSetSha256 = sha(
        manifests.map((manifest, index) => ({
          index,
          digest: manifest.digest,
        })),
      )
      const archiveReceipt = {
        waveDigest: inputWave.waveDigest,
        manifestSetSha256,
        count: manifests.length,
        fileSha256: manifests.map((manifest, index) => ({
          index,
          sha256: sha(Buffer.from(JSON.stringify(manifest))),
        })),
      }
      const approved = validateWaveInput({
        ...inputWave,
        manifests,
        ack: {
          kind: "durable-private-ack",
          waveDigest: inputWave.waveDigest,
          manifestSetSha256,
          archivedAt: new Date().toISOString(),
          archiveReceipt,
          archiveReceiptSha256: sha(archiveReceipt),
        },
      })
      const executeStarted = performance.now()
      if (process.env.LEGACY_QUALITY_HOLDS_FILE) {
        const inputFile = join(directory, "approved-wave.json")
        writeFileSync(inputFile, JSON.stringify(approved))
        child("src/scripts/retire-legacy-recommendation-detail-wave.ts", [
          "--execute-wave",
          "--input",
          inputFile,
          "--confirm-target",
          target,
        ])
      } else {
        await executeRetirementWave(db, approved, () => approved)
      }
      const executeMs = Math.round(performance.now() - executeStarted)
      const after = await Promise.all(
        all.map(async (run) => ({
          run: await db.recommendationCandidateRun.findUniqueOrThrow({
            where: { id: run.id },
          }),
          root: await db.recommendationRequest.findUniqueOrThrow({
            where: { id: run.requestId },
          }),
          items: await db.recommendationServedItem.findMany({
            where: { requestId: run.requestId },
          }),
          stages: await db.recommendationCandidateStageEvidence.count({
            where: { runId: run.id },
          }),
        })),
      )
      for (const [index, item] of after.entries()) {
        expect(item.root).toEqual(before[index]!.root)
        expect(item.items).toEqual(before[index]!.items)
        expect(item.stages).toBe(0)
      }
      expect(after[0]!.run.traceFormatVersion).toBe(1)
      expect(after[1]!.run.legacyDetailRetiredAt).toBeInstanceOf(Date)
      expect(after[2]!.run.traceFormatVersion).toBe(1)
      const receipts = await db.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM recommendation_legacy_detail_retirement_run
        WHERE manifest_digest IN (${manifests[0].digest}, ${manifests[1].digest})`
      expect(receipts[0]?.count).toBe(2)
      process.stdout.write(
        JSON.stringify({
          nativeBatchWave: true,
          batches: 2,
          oldFreezeMs,
          freezeMs,
          executeMs,
        }) + "\n",
      )
    }, 120_000)
  },
)
