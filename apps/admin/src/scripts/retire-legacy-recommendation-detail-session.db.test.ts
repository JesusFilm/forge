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
  readLegacySessionQuality,
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

async function setFixtureExpiry(
  runId: string,
  requestId: string,
  expiry: Date,
) {
  // The production lifecycle is immutable. Only this disposable database
  // fixture moves its original clock to exercise both sides of the boundary.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role=replica")
    await tx.$executeRaw`UPDATE recommendation_request SET expires_at=${expiry} WHERE id=${requestId}`
    await tx.$executeRaw`UPDATE recommendation_candidate_run SET expires_at=${expiry} WHERE id=${runId}`
  })
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
      expect([
        "/forge_legacy_session_owned_20260930",
        "/forge_unattended_owned_20261001",
      ]).toContain(url.pathname)
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
      const campaignReviewedAt = iso(-3 * 60_000)
      const campaignStart = {
        ...start,
        source: { ...start.source, reviewedAt: campaignReviewedAt },
        lease: {
          ...lease,
          reviewedAt: campaignReviewedAt,
          expiresAt: new Date(
            Date.parse(campaignReviewedAt) + 12 * 60 * 60_000,
          ).toISOString(),
          authorization: {
            kind: "unattended-finite-v1",
            scopeSha256: "1".repeat(64),
          },
        },
      }
      const malformedAuthorization = new CommandPipe()
      malformedAuthorization.send({
        ...start,
        lease: {
          ...lease,
          authorization: {
            kind: "unattended-finite-v1",
            scopeSha256: "1".repeat(64),
            extra: true,
          },
        },
      })
      await expect(
        runLegacyDetailSession(
          db,
          malformedAuthorization,
          () => {},
          cohort.digest,
          target,
        ),
      ).rejects.toThrow()
      const staleManual = new CommandPipe()
      staleManual.send({
        ...start,
        source: { ...start.source, reviewedAt: iso(-121_000) },
      })
      await expect(
        runLegacyDetailSession(
          db,
          staleManual,
          () => {},
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("source-review")
      const [initialLedger] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM recommendation_legacy_detail_retirement_run`,
      )
      const staleCampaign = new CommandPipe()
      staleCampaign.send(campaignStart)
      await expect(
        runLegacyDetailSession(
          db,
          staleCampaign,
          (frame) => {
            if ((frame as Record<string, unknown>).kind === "ready")
              staleCampaign.send({
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
      const changedCampaign = new CommandPipe()
      changedCampaign.send({
        ...campaignStart,
        source: {
          ...campaignStart.source,
          sourceHashes: {
            ...campaignStart.source.sourceHashes,
            [sourceFiles[0]!]: "0".repeat(64),
          },
        },
      })
      await expect(
        runLegacyDetailSession(
          db,
          changedCampaign,
          () => {},
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("source")
      const expiredCampaign = new CommandPipe()
      expiredCampaign.send({
        ...campaignStart,
        lease: {
          ...campaignStart.lease,
          expiresAt: new Date(
            Date.parse(campaignReviewedAt) + 2 * 60_000,
          ).toISOString(),
        },
      })
      await expect(
        runLegacyDetailSession(
          db,
          expiredCampaign,
          () => {},
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("cohort")
      const [afterCampaignRefusals] = await db.$queryRawUnsafe<
        Array<{ n: bigint }>
      >(`SELECT count(*) AS n FROM recommendation_legacy_detail_retirement_run`)
      expect(afterCampaignRefusals.n).toBe(initialLedger.n)
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
      pipe.send(campaignStart)
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

      const rejected = async (
        changed: typeof cohort,
        stopBefore = start.stopBefore,
      ) => {
        const attempt = new CommandPipe()
        attempt.send({
          ...start,
          source: source(target),
          cohort: changed,
          stopBefore,
        })
        await expect(
          runLegacyDetailSession(db, attempt, () => {}, changed.digest, target),
        ).rejects.toThrow()
      }
      const oversizedBatchBody = {
        ...cohortBody,
        waves: cohortBody.waves.map((wave, index) =>
          index === 0
            ? {
                ...wave,
                batches: [
                  [...wave.batches[0]!, ...wave.batches[1]!.slice(0, 1)].sort(
                    (a, b) => a.runId.localeCompare(b.runId),
                  ),
                  ...wave.batches.slice(1),
                ],
              }
            : wave,
        ),
      }
      await rejected({ ...oversizedBatchBody, digest: sha(oversizedBatchBody) })
      const overRowsBody = {
        ...cohortBody,
        waves: cohortBody.waves.map((wave, index) =>
          index === 0
            ? {
                ...wave,
                batches: [
                  wave.batches[0]!.map((row) => ({
                    ...row,
                    declaredStageRows: 448,
                  })),
                  ...wave.batches.slice(1),
                ],
              }
            : wave,
        ),
      }
      await rejected({ ...overRowsBody, digest: sha(overRowsBody) })
      await rejected(cohort, iso(31 * 60_000))
      const replay = new CommandPipe()
      replay.send({ ...start, source: source(target) })
      await expect(
        runLegacyDetailSession(
          db,
          replay,
          (frame) => {
            if ((frame as Record<string, unknown>).kind === "ready")
              replay.send({
                kind: "freeze-batch",
                seq: 1,
                planDigest: cohort.digest,
                waveIndex: 14,
                batchIndex: 0,
                permit: permit(target, registrySha256),
              })
          },
          cohort.digest,
          target,
        ),
      ).rejects.toThrow("batch-baseline")

      // A later reviewed cohort can stop after partial waves and batches.
      const smaller: Array<Awaited<ReturnType<typeof fixture>>> = []
      for (let index = 0; index < 4; index++) smaller.push(await fixture(3))
      const smallerRows = await baselineFor(smaller.map((run) => run.id))
      const smallerById = new Map(smallerRows.map((row) => [row.id, row]))
      const roster = (selected: typeof smaller) =>
        selected
          .map((run) => ({
            runId: run.id,
            declaredStageRows: smallerById.get(run.id)!.declared_stage_count,
            expiresAt: new Date(
              smallerById.get(run.id)!.expires_at,
            ).toISOString(),
          }))
          .sort((a, b) => a.runId.localeCompare(b.runId))
      const smallBody = {
        ...cohortBody,
        waves: [
          {
            index: 24,
            plannedEnd: iso(12 * 60_000),
            batches: [roster(smaller.slice(0, 1)), roster(smaller.slice(1, 3))],
          },
          {
            index: 25,
            plannedEnd: iso(12 * 60_000),
            batches: [roster(smaller.slice(3))],
          },
        ],
      }
      const smallCohort = { ...smallBody, digest: sha(smallBody) }
      const smallPipe = new CommandPipe()
      const smallFrames: Array<Record<string, unknown>> = []
      let smallSeq = 0
      const smallNext = (body: Record<string, unknown>) =>
        smallPipe.send({
          ...body,
          seq: ++smallSeq,
          planDigest: smallCohort.digest,
        })
      smallPipe.send({ ...start, source: source(target), cohort: smallCohort })
      await runLegacyDetailSession(
        db,
        smallPipe,
        (value) => {
          const frame = value as Record<string, unknown>
          smallFrames.push(frame)
          const waveIndex = Number(frame.waveIndex ?? 24)
          const batchIndex = Number(frame.batchIndex ?? 0)
          if (frame.kind === "ready" || frame.kind === "wave-acked")
            smallNext({
              kind: "freeze-batch",
              waveIndex: frame.kind === "ready" ? 24 : 25,
              batchIndex: 0,
              permit: permit(target, registrySha256),
            })
          else if (frame.kind === "frozen-private")
            smallNext({
              kind: "ack-manifest",
              waveIndex,
              batchIndex,
              sha256: frame.sha256,
              manifestDigest: frame.manifestDigest,
            })
          else if (frame.kind === "frozen-acked")
            smallNext({
              kind: "execute-batch",
              waveIndex,
              batchIndex,
              permit: permit(target, registrySha256),
              attemptSha256: "a".repeat(64),
              manifestDigest: frame.manifestDigest,
            })
          else if (frame.kind === "batch-verified")
            smallNext(
              batchIndex + 1 ===
                smallBody.waves.find((wave) => wave.index === waveIndex)!
                  .batches.length
                ? { kind: "verify-wave", waveIndex }
                : {
                    kind: "freeze-batch",
                    waveIndex,
                    batchIndex: batchIndex + 1,
                    permit: permit(target, registrySha256),
                  },
            )
          else if (frame.kind === "wave-verified")
            smallNext({
              kind: "ack-wave",
              waveIndex,
              receiptSha256: frame.receiptSha256,
            })
        },
        smallCohort.digest,
        target,
      )
      expect(smallFrames.at(-1)).toMatchObject({
        kind: "session-complete",
        completedWaves: 2,
        completedRuns: 4,
      })
      expect(
        smallFrames.filter((frame) => frame.kind === "batch-verified"),
      ).toHaveLength(3)
      expect(
        smallFrames.filter((frame) => frame.kind === "wave-verified"),
      ).toHaveLength(2)
      expect(
        smallFrames
          .filter((frame) => frame.kind === "wave-verified")
          .map((frame) => frame.committed),
      ).toEqual([2, 1])

      const changed = qualityIds[4]!
      await db.$executeRaw`UPDATE recommendation_candidate_run SET created_at=created_at+interval '1 second' WHERE id=${changed}`
      await expect(
        readLegacySessionQuality(db, qualityBaseline, lease),
      ).rejects.toThrow("quality-parent")
      await db.$executeRaw`UPDATE recommendation_candidate_run SET created_at=created_at-interval '1 second' WHERE id=${changed}`

      const expiring = qualityIds[5]!
      const future = new Date(Date.now() + 15_000)
      await setFixtureExpiry(
        expiring,
        qualityBaseline.find((row) => row.id === expiring)!.request_id,
        future,
      )
      const expiringBaseline = (
        await readLegacySessionBaseline(db, [expiring])
      )[0]!
      const expiryBaseline = qualityBaseline.map((row) =>
        row.id === expiring ? expiringBaseline : row,
      )
      await db.recommendationRequest.delete({
        where: { id: expiringBaseline.request_id },
      })
      await expect(
        readLegacySessionQuality(db, expiryBaseline, lease),
      ).rejects.toThrow("quality-missing")
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, future.getTime() - Date.now() + 200)),
      )
      const expired = await readLegacySessionQuality(db, expiryBaseline, lease)
      expect(expired).toMatchObject({
        live: 63,
        expiredPurged: 1,
        liveObservations:
          8_621 -
          (expiringBaseline.stage_count + expiringBaseline.compact_count),
      })
      expect(expired.expiredObservations + expired.liveObservations).toBe(8_621)
      expect(expired.partitionSha256).toMatch(/^[a-f0-9]{64}$/)

      const missingRun = qualityIds[6]!
      const past = new Date(Date.now() - 1000)
      await setFixtureExpiry(
        missingRun,
        qualityBaseline.find((row) => row.id === missingRun)!.request_id,
        past,
      )
      const missingRunBaseline = (
        await readLegacySessionBaseline(db, [missingRun])
      )[0]!
      const twoExpiryBaseline = expiryBaseline.map((row) =>
        row.id === missingRun ? missingRunBaseline : row,
      )
      await db.recommendationCandidateRun.delete({ where: { id: missingRun } })
      await expect(
        readLegacySessionQuality(db, twoExpiryBaseline, lease),
      ).rejects.toThrow("quality-missing")
    }, 1_200_000)
  },
)
