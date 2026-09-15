import { describe, expect, it, vi } from "vitest"
import { RecommendationControlReadinessService } from "./service"

const WINDOW_START = new Date("2026-08-11T00:00:00.000Z")
const WINDOW_END = new Date("2026-08-18T00:00:00.000Z")
const CUTOFF = new Date("2026-08-19T00:00:00.000Z")

const manifest = {
  id: "semantic-transcript-pgvector-v1",
  strategyVersion: "semantic-transcript-pgvector-v1",
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  generator: "semantic",
  maxItems: 6,
  configuration: { retrieval: "transcript-pgvector" },
  enabled: true,
}

const aggregate = {
  issuedRequests: 200n,
  servedRequests: 198n,
  fallbackRequests: 2n,
  servedItems: 1_000n,
  impressions: 800n,
  selections: 160n,
  selectionWithoutImpression: 0n,
  matureOutcomes: 120n,
  qualifiedViewOutcomes: 42n,
  missionQualifiedOutcomes: 8n,
  missionOffsetOutcomes: 5n,
  rejectedMissionOffsets: 3n,
  machineExcluded: 14n,
  integrityExcluded: 7n,
  classifierLag: 0n,
  writeFailures: 0n,
  conflicts: 0n,
  lateEvidence: 0n,
  retrievalP95Ms: 420,
  requestWatermark: new Date("2026-08-17T23:00:00.000Z"),
  impressionWatermark: new Date("2026-08-18T01:00:00.000Z"),
  selectionWatermark: new Date("2026-08-18T01:01:00.000Z"),
  outcomeWatermark: new Date("2026-08-18T08:00:00.000Z"),
  missionWatermark: new Date("2026-08-18T08:05:00.000Z"),
  eligibilityWatermark: new Date("2026-08-18T08:06:00.000Z"),
}

function harness(
  input: {
    aggregate?: typeof aggregate
    previous?: Record<string, unknown> | null
    servingVersion?: number
  } = {},
) {
  const created: Array<Record<string, unknown>> = []
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [input.aggregate ?? aggregate]),
    recommendationServingControl: {
      findUnique: vi.fn(async () => ({
        id: "recommendation-serving-control",
        version: input.servingVersion ?? 7,
        manifestId: manifest.id,
        manifest,
      })),
    },
    recommendationControlEvaluation: {
      findFirst: vi.fn(async () => input.previous ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return { id: "evaluation-new", ...data }
      }),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const service = new RecommendationControlReadinessService({
    prisma: prisma as never,
    now: () => CUTOFF,
    newId: () => "evaluation-new",
  })
  return { service, prisma, tx, created }
}

describe("RecommendationControlReadinessService", () => {
  it("persists a deterministic semantic-only evaluation with pinned inputs", async () => {
    const { service, tx, created } = harness()

    await expect(
      service.evaluate({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        expectedServingControlVersion: 7,
      }),
    ).resolves.toMatchObject({
      status: "published",
      evaluationId: "evaluation-new",
      revision: 1,
      state: "ready",
    })

    const query = (tx.$queryRaw.mock.calls as unknown[][])[0]?.[0] as {
      sql?: string
      text?: string
      strings?: string[]
    }
    const sql = String(query.sql ?? query.text ?? query.strings)
    expect(sql).toContain("successor.supersedes_id = outcome.id")
    expect(sql).toContain(
      "ORDER BY decision.source_key, decision.revision DESC",
    )
    expect(sql).toContain("outcome.actor_class IN")
    expect(sql).toContain("selection.attribution_eligible_at <=")
    expect(sql).toContain("selection.attribution_eligible_at IS NULL")
    expect(sql).toContain("'human_anonymous'")
    expect(sql).toContain("'human_signed_in'")
    expect(sql).toContain("action.purpose IN ('find_to_share', 'course_build')")
    expect(sql).not.toContain("session_digest")

    expect(created[0]).toMatchObject({
      id: "evaluation-new",
      manifestId: manifest.id,
      strategyVersion: manifest.strategyVersion,
      contractVersion: manifest.contractVersion,
      surfaceVersion: manifest.surfaceVersion,
      generator: "semantic",
      servingControlVersion: 7,
      policyVersion: "semantic-control-readiness-v1",
      outcomePolicyVersion: "watch-semantic-control-outcomes-v1",
      classifierVersion: "active-watch-proxy-v1",
      integrityPolicyVersion: "recommendation-integrity-v1",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      requestWatermark: aggregate.requestWatermark,
      outcomeWatermark: aggregate.outcomeWatermark,
      state: "READY",
      deliveryOutcome: "PASS",
      attributionOutcome: "PASS",
      maturityOutcome: "PASS",
      operationalOutcome: "PASS",
      missionOutcome: "PASS",
      guardrailOutcome: "PASS",
      revision: 1,
      supersedesId: null,
      inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      explanation: expect.stringContaining("no incremental viewer-value claim"),
    })
    expect(JSON.stringify(created[0])).not.toMatch(
      /sessionDigest|actorDigest|capabilityJti|profileId/,
    )
  })

  it("returns an existing revision when the exact pinned input digest repeats", async () => {
    const first = harness()
    await first.service.evaluate({
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      expectedServingControlVersion: 7,
    })
    const inputDigest = first.created[0]?.inputDigest
    const second = harness({
      previous: {
        id: "evaluation-existing",
        revision: 4,
        inputDigest,
        state: "READY",
      },
    })

    await expect(
      second.service.evaluate({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        expectedServingControlVersion: 7,
      }),
    ).resolves.toEqual({
      status: "existing",
      evaluationId: "evaluation-existing",
      revision: 4,
      state: "ready",
    })
    expect(
      second.tx.recommendationControlEvaluation.create,
    ).not.toHaveBeenCalled()
  })

  it("appends a superseding revision when late evidence advances the watermark", async () => {
    const { service, created } = harness({
      aggregate: {
        ...aggregate,
        lateEvidence: 1n,
        outcomeWatermark: new Date("2026-08-18T10:00:00.000Z"),
      },
      previous: {
        id: "evaluation-previous",
        revision: 2,
        inputDigest: "a".repeat(64),
        state: "INCONCLUSIVE",
      },
    })

    await expect(
      service.evaluate({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        expectedServingControlVersion: 7,
      }),
    ).resolves.toMatchObject({ status: "published", revision: 3 })
    expect(created[0]).toMatchObject({
      revision: 3,
      supersedesId: "evaluation-previous",
      reasonCodes: expect.arrayContaining(["late_evidence_reconciled"]),
    })
  })

  it("fences a workflow with a stale serving-control generation before reading evidence", async () => {
    const { service, tx } = harness({ servingVersion: 8 })

    await expect(
      service.evaluate({
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        expectedServingControlVersion: 7,
      }),
    ).resolves.toEqual({
      status: "fenced",
      reason: "serving_control_version_changed",
    })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.recommendationControlEvaluation.create).not.toHaveBeenCalled()
  })
})
