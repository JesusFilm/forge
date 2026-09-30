import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { afterAll, describe, expect, it, vi } from "vitest"
import { createPrismaClient } from "../db/client"
import {
  input,
  makeHarness,
  semanticCandidates,
} from "../services/recommendations/delivery.service.test-helpers"
import { conversionDatabaseHash } from "../services/recommendations/legacy-candidate-trace-conversion.service"
import {
  freezeLegacyDetailRetirement,
  runLegacyDetailRetirement,
} from "../services/recommendations/legacy-detail-retirement.service"
import {
  readLegacySessionBaseline,
  runLegacyDetailSession,
} from "./retire-legacy-recommendation-detail-session"

// Native fixture IDs are synthetic. The immutable original64 selector is
// tested separately; this proof exercises all SQL, wire, and parity paths.
vi.mock("../services/recommendations/legacy-quality-holds", () => ({
  assertOriginalQualityHolds: vi.fn(),
}))

const sha = (value: string | object | Buffer) =>
  createHash("sha256")
    .update(
      Buffer.isBuffer(value) || typeof value === "string"
        ? value
        : JSON.stringify(value),
    )
    .digest("hex")
const revision = "a".repeat(40)
const selector =
  "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1"
const sourceFiles = [
  "src/scripts/retire-legacy-recommendation-campaign.ts",
  "src/services/recommendations/legacy-detail-retirement-campaign.ts",
  "src/scripts/retire-legacy-recommendation-detail.ts",
  "src/services/recommendations/legacy-detail-retirement.service.ts",
  "src/services/recommendations/legacy-candidate-trace-conversion.service.ts",
  "src/services/recommendations/legacy-quality-holds.ts",
  "src/scripts/retire-legacy-recommendation-detail-session.ts",
]
const db = createPrismaClient("main")
const seeds: string[] = []
const iso = (offset: number) => new Date(Date.now() + offset).toISOString()
async function baselineFor(ids: string[]) {
  const result = []
  for (let offset = 0; offset < ids.length; offset += 100)
    result.push(
      ...(await readLegacySessionBaseline(db, ids.slice(offset, offset + 100))),
    )
  return result
}

class CommandPipe implements AsyncIterable<string> {
  private queue: string[] = []
  private waiting?: (value: IteratorResult<string>) => void
  send(value: object) {
    const line = JSON.stringify(value)
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = undefined
      resolve({ value: line, done: false })
    } else this.queue.push(line)
  }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const line = this.queue.shift()
        if (line !== undefined)
          return Promise.resolve({ value: line, done: false })
        return new Promise((resolve) => {
          this.waiting = resolve
        })
      },
    }
  }
}

async function fixture(candidateCount: number) {
  const harness = makeHarness({ database: db, candidateTraceFormat: "legacy" })
  harness.retrieve.mockResolvedValue(semanticCandidates(candidateCount))
  const seed = `session-native-${randomUUID()}`
  seeds.push(seed)
  const delivery = await harness.service.deliver(input(seed))
  expect(delivery.result).toBe("served")
  const run = await db.recommendationCandidateRun.findUniqueOrThrow({
    where: { requestId: delivery.requestId! },
  })
  await db.$executeRaw`UPDATE recommendation_request
    SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.requestId}`
  await db.$executeRaw`UPDATE recommendation_candidate_run
    SET created_at=clock_timestamp()-interval '2 days' WHERE id=${run.id}`
  return run
}

function source(targetDatabaseHash: string) {
  const sourceHashes = Object.fromEntries(
    sourceFiles.map((file) => [file, sha(readFileSync(file))]),
  )
  return {
    revision,
    targetDatabaseHash,
    sourceHashes,
    reviewedAt: iso(-1000),
    reviewReceiptSha256: "b".repeat(64),
  }
}

function permit(targetDatabaseHash: string, registrySha256: string) {
  return {
    measuredAt: iso(-1000),
    targetDatabaseHash,
    revision,
    registrySha256,
    receiptSha256: "c".repeat(64),
    filesystemAvailableBytes: 10_000_000_000,
    walBytes: 100_000_000,
    httpHealthy: true,
    workerHealthy: true,
    compactWritersConverged: true,
    retentionHealthy: true,
    serving: {
      lastRequestAt: iso(-1000),
      requests: 10,
      latencySamples: 10,
      p95Ms: 100,
      maxMs: 200,
      unexpectedResultCount: 0,
    },
    locks: { waiters: 0, targetSessions: 0, assignedWriteXidSessions: 0 },
  }
}

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "bounded persistent legacy detail session on owned PostgreSQL",
  () => {
    afterAll(async () => {
      await db.recommendationRequest.deleteMany({
        where: { seedMediaId: { in: seeds } },
      })
      await db.$disconnect()
    })

    it("executes exactly ten waves and one thousand runs with durable command ordering and typed parity", async () => {
      const url = new URL(process.env.DATABASE_URL!)
      expect(url.hostname).toBe("127.0.0.1")
      expect(url.pathname).toBe("/forge_legacy_session_owned_20260930")
      expect(process.env.NEXT_PUBLIC_DATADOG_VERSION).toBe(revision)
      const qualityIds: string[] = []
      for (let index = 0; index < 64; index++)
        qualityIds.push((await fixture(index < 47 ? 26 : 25)).id)
      const qualityTarget = await conversionDatabaseHash(db)
      const qualityManifest = await freezeLegacyDetailRetirement(db, {
        runIds: qualityIds.slice(0, 3).sort(),
        createdBefore: iso(-86_400_000),
        holds: {
          qualitySelectorSha256: selector,
          qualityRunIds: qualityIds,
          activeInvestigationRunIds: [],
        },
      })
      const qualityConversion = await runLegacyDetailRetirement(
        db,
        qualityManifest,
        { execute: true, confirmTarget: qualityTarget },
      )
      expect(qualityConversion.converted).toBe(3)
      // 47×136 + 17×131 = 8,619. Two additional typed observations make the
      // synthetic quality baseline match the immutable 8,621-observation proof.
      const first = await db.recommendationCandidateRun.findUniqueOrThrow({
        where: { id: qualityIds[3] },
      })
      for (let index = 0; index < 2; index++)
        await db.$executeRaw`
          INSERT INTO recommendation_candidate_stage_evidence
            (id,run_id,stage,ordinal,candidate_key,expires_at)
          VALUES (${randomUUID()},${first.id},'nominated',${62 + index},
            ${`quality-extra-${index}`},${first.expiresAt})
        `
      const qualityBaseline = await readLegacySessionBaseline(db, qualityIds)
      expect(
        qualityBaseline.reduce(
          (sum, row) => sum + row.stage_count + row.compact_count,
          0,
        ),
      ).toBe(8621)

      const runs = []
      for (let index = 0; index < 1000; index++) runs.push(await fixture(3))
      const protectedRequests = runs.slice(0, 900).map((run) => run.requestId)
      await db.$executeRawUnsafe(
        `UPDATE recommendation_request SET owner_release_id=$1,
          owner_release_generation=1 WHERE id=ANY($2::text[])`,
        randomUUID(),
        protectedRequests,
      )
      const ids = runs.map((run) => run.id)
      const baseline = await baselineFor(ids)
      const byId = new Map(baseline.map((row) => [row.id, row]))
      const waves = Array.from({ length: 10 }, (_, waveIndex) => ({
        index: 14 + waveIndex,
        plannedEnd: iso(12 * 60_000),
        batches: Array.from({ length: 10 }, (_, batchIndex) =>
          ids
            .slice(
              waveIndex * 100 + batchIndex * 10,
              waveIndex * 100 + batchIndex * 10 + 10,
            )
            .sort()
            .map((runId) => ({
              runId,
              declaredStageRows: byId.get(runId)!.declared_stage_count,
              expiresAt: new Date(byId.get(runId)!.expires_at).toISOString(),
            })),
        ),
      }))
      const cohortBody = {
        version: 1,
        masterDigest:
          "fff0103d6966b69fa913fd61eecc0c05c2e10009c4b6206b32fd2000a8fc3d34",
        createdBefore: iso(-86400000),
        selectionReceiptSha256: "d".repeat(64),
        waves,
      }
      const cohort = { ...cohortBody, digest: sha(cohortBody) }
      const target = await conversionDatabaseHash(db)
      const registrySha256 = "e".repeat(64)
      const reviewedAt = iso(-1000)
      const lease = {
        reviewedAt,
        expiresAt: new Date(Date.parse(reviewedAt) + 30 * 60_000).toISOString(),
        canonicalRegistrySha256: registrySha256,
        reviewReceiptSha256: "f".repeat(64),
        holds: {
          qualitySelectorSha256: selector,
          qualityRunIds: qualityIds,
          activeInvestigationRunIds: [],
        },
      }
      const start = {
        kind: "start",
        seq: 0,
        cohort,
        source: source(target),
        lease,
        qualityBaseline,
        stopBefore: iso(20 * 60_000),
      }
      const [initialLedger] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM recommendation_legacy_detail_retirement_run`,
      )
      const stale = new CommandPipe()
      stale.send(start)
      await expect(
        runLegacyDetailSession(
          db,
          stale,
          (frame) => {
            if ((frame as Record<string, unknown>).kind === "ready")
              stale.send({
                kind: "freeze-batch",
                seq: 1,
                planDigest: cohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                permit: {
                  ...permit(target, registrySha256),
                  measuredAt: iso(-120_000),
                },
              })
          },
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("permit")
      const nearBody = {
        ...cohortBody,
        waves: cohortBody.waves.map((wave, index) =>
          index === 0 ? { ...wave, plannedEnd: iso(25_000) } : wave,
        ),
      }
      const nearCohort = { ...nearBody, digest: sha(nearBody) }
      const near = new CommandPipe()
      near.send({ ...start, cohort: nearCohort })
      await expect(
        runLegacyDetailSession(
          db,
          near,
          (frame) => {
            const reply = frame as Record<string, unknown>
            if (reply.kind === "ready")
              near.send({
                kind: "freeze-batch",
                seq: 1,
                planDigest: nearCohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                permit: permit(target, registrySha256),
              })
            else if (reply.kind === "frozen-private")
              near.send({
                kind: "ack-manifest",
                seq: 2,
                planDigest: nearCohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                sha256: reply.sha256,
                manifestDigest: reply.manifestDigest,
              })
            else if (reply.kind === "frozen-acked")
              near.send({
                kind: "execute-batch",
                seq: 3,
                planDigest: nearCohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                permit: permit(target, registrySha256),
                attemptSha256: "a".repeat(64),
                manifestDigest: reply.manifestDigest,
              })
          },
          nearCohort.digest,
          target,
        ),
      ).rejects.toThrow("execution-deadline")
      const unacked = new CommandPipe()
      unacked.send(start)
      await expect(
        runLegacyDetailSession(
          db,
          unacked,
          (frame) => {
            const reply = frame as Record<string, unknown>
            if (reply.kind === "ready")
              unacked.send({
                kind: "freeze-batch",
                seq: 1,
                planDigest: cohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                permit: permit(target, registrySha256),
              })
            else if (reply.kind === "frozen-private")
              unacked.send({
                kind: "ack-manifest",
                seq: 2,
                planDigest: cohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                sha256: "0".repeat(64),
                manifestDigest: reply.manifestDigest,
              })
          },
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("manifest-ack")
      const [beforeExecution] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM recommendation_legacy_detail_retirement_run`,
      )
      expect(Number(beforeExecution.n)).toBe(Number(initialLedger.n))
      const pipe = new CommandPipe()
      const frames: Array<Record<string, unknown>> = []
      let seq = 0
      const next = (body: Record<string, unknown>) => {
        seq++
        pipe.send({ ...body, seq, planDigest: cohort.digest })
      }
      pipe.send(start)
      await runLegacyDetailSession(
        db,
        pipe,
        (value) => {
          const frame = value as Record<string, unknown>
          frames.push(frame)
          const waveIndex = Number(frame.waveIndex ?? 14)
          const batchIndex = Number(frame.batchIndex ?? 0)
          if (frame.kind === "ready" || frame.kind === "wave-acked")
            next({
              kind: "freeze-batch",
              waveIndex: frame.kind === "ready" ? 14 : waveIndex + 1,
              batchIndex: 0,
              permit: permit(target, registrySha256),
            })
          else if (frame.kind === "frozen-private") {
            const payload = Buffer.from(String(frame.base64), "base64")
            expect(sha(payload)).toBe(frame.sha256)
            const decoded = JSON.parse(payload.toString())
            expect(sha(decoded.baseline)).toBe(frame.baselineSha256)
            next({
              kind: "ack-manifest",
              waveIndex,
              batchIndex,
              sha256: frame.sha256,
              manifestDigest: frame.manifestDigest,
            })
          } else if (frame.kind === "frozen-acked")
            next({
              kind: "execute-batch",
              waveIndex,
              batchIndex,
              permit: permit(target, registrySha256),
              attemptSha256: "a".repeat(64),
              manifestDigest: frame.manifestDigest,
            })
          else if (frame.kind === "batch-verified")
            next(
              batchIndex === 9
                ? { kind: "verify-wave", waveIndex }
                : {
                    kind: "freeze-batch",
                    waveIndex,
                    batchIndex: batchIndex + 1,
                    permit: permit(target, registrySha256),
                  },
            )
          else if (frame.kind === "wave-verified")
            next({
              kind: "ack-wave",
              waveIndex,
              receiptSha256: frame.receiptSha256,
            })
        },
        cohort.digest,
        target,
      )
      expect(frames.at(-1)?.kind).toBe("session-complete")
      expect(
        frames.filter((frame) => frame.kind === "batch-verified"),
      ).toHaveLength(100)
      expect(
        frames.filter((frame) => frame.kind === "wave-verified"),
      ).toHaveLength(10)
      const after = await baselineFor(ids)
      expect(after.every((row) => row.stage_count === 0)).toBe(true)
      expect(
        after.filter((row) => row.trace_format_version === 1),
      ).toHaveLength(900)
      expect(
        after.filter((row) => row.legacy_detail_retired_at != null),
      ).toHaveLength(100)
      const [ledger] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM recommendation_legacy_detail_retirement_run`,
      )
      expect(Number(ledger.n)).toBe(Number(initialLedger.n) + 100)
    }, 1_200_000)
  },
)
