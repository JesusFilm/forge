import type { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_SHADOW_GENERATOR_KEY,
} from "../cowatch/graph"
import { loadCowatchInspection } from "../cowatch/inspection.service"
import { COWATCH_SOURCE_WINDOW_VERSION } from "../cowatch/source-window"
import {
  COWATCH_MMR_SHADOW_SAMPLING_VERSION,
  COWATCH_MMR_TRIAL_MANIFEST,
  COWATCH_MMR_TRIAL_MANIFEST_ID,
} from "../promotion/manifest"
import {
  cowatchTrialCandidateReadiness,
  requireCowatchShadowBinding,
  validateCowatchTrialProtocol,
} from "./cowatch-readiness"

vi.mock("../cowatch/inspection.service", () => ({
  loadCowatchInspection: vi.fn(),
}))
const now = new Date("2026-09-29T00:00:00Z")
const expires = new Date("2026-10-10T00:00:00Z")
const graphId = "a".repeat(64)
const evaluation = {
  id: "evaluation",
  manifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
  generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
  cowatchGenerationId: graphId,
  requestedSampleSize: 500,
  samplingVersion: COWATCH_MMR_SHADOW_SAMPLING_VERSION,
}
function setup() {
  const protocol = {
    sourceManifestId: evaluation.manifestId,
    challengerManifestId: evaluation.manifestId,
    generatorVersion: evaluation.generatorVersion,
    config: { cowatchGenerationId: graphId },
    revokedAt: null as Date | null,
    expiresAt: expires,
  }
  const graph = {
    lineageVersion: COWATCH_DURABLE_LINEAGE_VERSION,
    sourceWindowVersion: COWATCH_SOURCE_WINDOW_VERSION,
    id: graphId,
    edgeCount: 1,
    invalidatedAt: null as Date | null,
    expiresAt: expires,
  }
  const evidence = { invalid: 0n, mismatched: 0n, eligible: 1n }
  const cohort = {
    sampledAt: now as Date | null,
    sampledCount: 1,
    retainedCount: 1n,
  }
  const tx = {
    recommendationStrategyManifest: {
      findUnique: vi.fn(async () => COWATCH_MMR_TRIAL_MANIFEST),
    },
    recommendationCompositionProtocol: {
      findUnique: vi.fn(async () => protocol),
    },
    recommendationCowatchGeneration: { findUnique: vi.fn(async () => graph) },
    $queryRaw: vi.fn(async (query: Prisma.Sql) =>
      query.sql.includes('AS "retainedCount"')
        ? [cohort]
        : query.sql.includes("AS invalid")
          ? [evidence]
          : [],
    ),
  }
  return {
    protocol,
    graph,
    evidence,
    cohort,
    tx,
    db: tx as unknown as Prisma.TransactionClient,
  }
}
describe("co-watch controlled-study candidate readiness", () => {
  beforeEach(() => {
    vi.mocked(loadCowatchInspection)
      .mockReset()
      .mockResolvedValue({ state: "current" } as Awaited<
        ReturnType<typeof loadCowatchInspection>
      >)
  })
  it("requires a predeclared exact graph protocol before creating the sample", async () => {
    const h = setup()
    h.protocol.config.cowatchGenerationId = "b".repeat(64)
    await expect(
      requireCowatchShadowBinding(h.db, evaluation, now),
    ).rejects.toThrow("cowatch_trial_protocol_invalid")
    h.protocol.config.cowatchGenerationId = graphId
    await expect(
      requireCowatchShadowBinding(h.db, evaluation, now),
    ).resolves.toBeUndefined()
  })
  it("rejects mixed manifest or oversized trial populations", async () => {
    const h = setup()
    await expect(
      validateCowatchTrialProtocol(
        h.db,
        { ...evaluation, requestedSampleSize: 501 },
        now,
      ),
    ).resolves.toBe("cowatch_trial_contract_invalid")
    await expect(
      requireCowatchShadowBinding(
        h.db,
        { ...evaluation, generatorVersion: "semantic" },
        now,
      ),
    ).rejects.toThrow("shadow_graph_binding_incompatible")
    await expect(
      validateCowatchTrialProtocol(
        h.db,
        { ...evaluation, samplingVersion: "stable-request-hash-v1" },
        now,
      ),
    ).resolves.toBe("cowatch_trial_contract_invalid")
  })
  it("accepts current exact source evidence only as candidate trial readiness", async () => {
    const h = setup()
    await expect(
      cowatchTrialCandidateReadiness(h.db, evaluation, now),
    ).resolves.toBeNull()
    expect(loadCowatchInspection).toHaveBeenCalledWith(h.db, {
      generationId: graphId,
      now,
    })
    expect(h.tx.$queryRaw.mock.calls[0]?.[0].sql).toContain(
      "FROM recommendation_cowatch_generation",
    )
    expect(h.tx.$queryRaw.mock.calls[1]?.[0].sql).toContain(
      "FOR SHARE OF protocol, manifest",
    )
    expect(
      h.tx.recommendationCompositionProtocol.findUnique.mock
        .invocationCallOrder[0],
    ).toBeGreaterThan(h.tx.$queryRaw.mock.invocationCallOrder[1]!)
  })
  it("revalidates a protocol revoked while waiting for the publication fence", async () => {
    const h = setup()
    h.tx.$queryRaw.mockImplementationOnce(async () => {
      h.protocol.revokedAt = now
      return []
    })
    await expect(
      cowatchTrialCandidateReadiness(h.db, evaluation, now),
    ).resolves.toBe("cowatch_trial_protocol_invalid")
    expect(loadCowatchInspection).not.toHaveBeenCalled()
  })
  it.each(["missing_receipt", "lost_root"] as const)(
    "rejects the current cohort with %s after acquiring authority locks",
    async (reason) => {
      const h = setup()
      if (reason === "missing_receipt") h.cohort.sampledAt = null
      else h.cohort.retainedCount = 0n
      await expect(
        cowatchTrialCandidateReadiness(h.db, evaluation, now),
      ).resolves.toBe("cowatch_trial_sample_retention_incomplete")
      expect(loadCowatchInspection).not.toHaveBeenCalled()
    },
  )
  it.each(["invalid", "mismatched"] as const)(
    "rejects %s retained source evidence",
    async (field) => {
      const h = setup()
      h.evidence[field] = 1n
      await expect(
        cowatchTrialCandidateReadiness(h.db, evaluation, now),
      ).resolves.toBe("cowatch_trial_source_evidence_incomplete")
    },
  )
  it("does not promote a semantic-only fallback as successful co-watch evidence", async () => {
    const h = setup()
    h.evidence.eligible = 0n
    await expect(
      cowatchTrialCandidateReadiness(h.db, evaluation, now),
    ).resolves.toBe("cowatch_trial_no_eligible_nominations")
  })
  it("refuses stale graphs and revoked protocols", async () => {
    const h = setup()
    vi.mocked(loadCowatchInspection).mockResolvedValue({
      state: "stale",
    } as Awaited<ReturnType<typeof loadCowatchInspection>>)
    await expect(
      cowatchTrialCandidateReadiness(h.db, evaluation, now),
    ).resolves.toBe("cowatch_trial_graph_not_current")
    h.protocol.revokedAt = now
    await expect(
      cowatchTrialCandidateReadiness(h.db, evaluation, now),
    ).resolves.toBe("cowatch_trial_protocol_invalid")
  })
})
