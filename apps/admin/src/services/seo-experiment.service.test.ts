import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  isExperimentableEngineeringBrief,
  redactSeoJson,
  SeoExperimentService,
} from "./seo-experiment.service"
import { seoContentHash } from "./seo-target.service"

const assertion = {
  keyId: "workload-key",
  environment: "test",
  audience: "forge-admin:seo:ingest",
  capability: "ingest" as const,
  requestDigest: "a".repeat(64),
  jtiHash: "b".repeat(64),
  expiresAt: new Date("2026-08-01T00:01:00.000Z"),
}

function serviceFor(tx: Record<string, unknown>) {
  return new SeoExperimentService({
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  } as never)
}

function run(mode: "OFF" | "DRY_RUN" | "LIVE") {
  return {
    id: "run-1",
    idempotencyKey: "daily-1",
    mode,
    status: "RUNNING",
    providerCoverage: {},
    report: {},
    eligibleCount: 0,
    selectedCount: 0,
    wouldProposeCount: 0,
    proposedCount: 0,
    materializationCount: 0,
    ticketCount: 0,
    experimentCount: 0,
    suppressedOperations: [],
    startedAt: new Date("2026-08-01T00:00:00.000Z"),
    completedAt: null,
  }
}

describe("SEO experiment eligibility", () => {
  it("keeps ticket-only engineering work out of the experiment queue", () => {
    expect(
      isExperimentableEngineeringBrief({
        ticketOnly: true,
        deploymentProbe: null,
      }),
    ).toBe(false)
  })

  it("requires a supported objective deployment probe", () => {
    expect(
      isExperimentableEngineeringBrief({
        ticketOnly: false,
        deploymentProbe: {
          type: "page_text_hash",
          expectedValue: "digest",
        },
      }),
    ).toBe(true)
    expect(
      isExperimentableEngineeringBrief({
        ticketOnly: false,
        deploymentProbe: { type: "operator_confirmation" },
      }),
    ).toBe(false)
  })
})

describe("SEO ledger boundaries", () => {
  it("redacts credential-shaped values even under innocuous field names", () => {
    expect(
      redactSeoJson({
        note: "Bearer abcdefghijklmnopqrstuvwxyz",
        contact: "person@example.com from 10.0.0.2",
      }),
    ).toEqual({
      note: "[redacted]",
      contact: "[redacted-email] from [redacted-ip]",
    })
  })

  it("stores only the bounded report when persisted mode is dry-run", async () => {
    const original = run("DRY_RUN")
    const createMany = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        findUnique: vi.fn(async () => original),
        update: vi.fn(async ({ data }) => ({
          ...original,
          ...data,
          status: "COMPLETED",
          completedAt: new Date(),
        })),
      },
      seoEvidenceObservation: { createMany },
      $queryRaw: vi.fn(async () => [{ mode: "dry_run" }]),
    }
    const service = serviceFor(tx)
    await service.completeRun({
      assertion,
      input: {
        action: "complete_run",
        runId: "run-1",
        status: "completed",
        providerCoverage: { gsc: "available" },
        report: { wouldProposeCount: 1 },
        eligibleCount: 1,
        selectedCount: 1,
        wouldProposeCount: 1,
        suppressedOperations: [],
        observations: [
          {
            observationKey: "gsc-1",
            provider: "gsc",
            schemaVersion: 1,
            scope: {},
            payload: {},
            citations: [],
            quality: {},
            payloadDigest: "c".repeat(64),
            retrievedAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2027-09-05T00:00:00.000Z",
          },
        ],
        proposals: [],
      },
    })

    expect(createMany).not.toHaveBeenCalled()
    expect(tx.seoRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: "DRY_RUN",
          proposedCount: 0,
          suppressedOperations: expect.arrayContaining([
            "proposal_persistence",
            "experiment_creation",
          ]),
        }),
      }),
    )
  })

  it("allocates the next append-only version under a stable proposal ID", async () => {
    const original = run("LIVE")
    const payload = { lane: "editorial", query: "hope" }
    const payloadDigest = seoContentHash(redactSeoJson(payload))
    const versionCreate = vi.fn(async ({ data }) => ({ id: "v3", ...data }))
    const proposalUpdate = vi.fn()
    const proposalVersionFind = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        findUnique: vi.fn(async () => original),
        update: vi.fn(async ({ data }) => ({
          ...original,
          ...data,
          status: "COMPLETED",
          completedAt: new Date(),
        })),
      },
      seoEvidenceObservation: { createMany: vi.fn() },
      seoProposalVersion: {
        findUnique: proposalVersionFind,
        create: versionCreate,
      },
      seoProposal: {
        upsert: vi.fn(async () => ({
          id: "seo-stable",
          semanticConflictKey: "target:en:editorial:title",
          lane: "EDITORIAL",
          targetType: "VideoLocale",
          targetId: "target",
          canonicalUrl: "https://example.com/watch/hope.html",
          locale: "en",
          currentVersion: 2,
        })),
        update: proposalUpdate,
      },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }
    await serviceFor(tx).completeRun({
      assertion,
      input: {
        action: "complete_run",
        runId: "run-1",
        status: "completed",
        providerCoverage: {},
        report: {},
        eligibleCount: 1,
        selectedCount: 1,
        wouldProposeCount: 1,
        suppressedOperations: [],
        observations: [],
        proposals: [
          {
            proposalId: "seo-stable",
            version: 1,
            idempotencyKey: `seo-stable:${payloadDigest}`,
            payloadDigest,
            semanticConflictKey: "target:en:editorial:title",
            lane: "editorial",
            targetType: "VideoLocale",
            targetId: "target",
            canonicalUrl: "https://example.com/watch/hope.html",
            locale: "en",
            canonicalIdentityDigest: "d".repeat(64),
            baseContentHash: "e".repeat(64),
            intent: "Improve relevance",
            expectedOutcome: "Improve qualified CTR",
            risk: "Title truncation",
            verificationPlan: "Use final GSC windows",
            rollbackPlan: "Restore the snapshot",
            editorialDiff: { title: { before: "Hope", after: "Hope story" } },
            engineeringBrief: null,
            evidence: ["gsc-1"],
            caveats: [],
            affectedFields: ["title"],
            payload,
            preChangeSnapshot: { v: 1, data: { title: "Hope" } },
            treatmentSnapshot: { v: 1, data: { title: "Hope story" } },
            expiresAt: "2026-08-15T00:00:00.000Z",
          },
        ],
      },
    })

    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 3 }),
      }),
    )
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentVersion: 3 }),
      }),
    )
  })

  it("returns a fenced evaluation lease without persisting its plaintext token", async () => {
    const experiment = {
      id: "experiment-1",
      evaluationFenceGeneration: 4,
      proposalVersion: { proposal: {} },
    }
    const update = vi.fn(async () => experiment)
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoExperiment: { update },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ mode: "live" }])
        .mockResolvedValueOnce([{ id: "experiment-1" }]),
    }
    const claimed = await serviceFor(tx).claimDueExperiments({
      assertion: { ...assertion, capability: "evaluate" },
      input: { action: "claim_due", claimId: "daily", limit: 1 },
    })

    expect(claimed).toHaveLength(1)
    expect(claimed[0]).toMatchObject({ claimGeneration: 4 })
    const token = claimed[0]!.claimToken
    expect(token).toBeTruthy()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evaluationFenceGeneration: { increment: 1 },
          evaluationClaimTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
        }),
      }),
    )
    expect(JSON.stringify(update.mock.calls)).not.toContain(token)
  })

  it("rejects a terminal verdict before objective activation", async () => {
    const token = "evaluation-token"
    const eventCreate = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoExperiment: {
        findUnique: vi.fn(async () => ({
          id: "experiment-1",
          status: "AWAITING_ACTIVATION",
          evaluationFenceGeneration: 1,
          evaluationClaimTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
          evaluationClaimExpiresAt: new Date(Date.now() + 60_000),
          treatmentHash: "f".repeat(64),
          proposalVersion: { proposal: {} },
        })),
      },
      seoEvaluationEvent: { create: eventCreate },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    await expect(
      serviceFor(tx).recordEvaluation({
        assertion: { ...assertion, capability: "evaluate" },
        input: {
          action: "record_result",
          experimentId: "experiment-1",
          claimGeneration: 1,
          claimToken: token,
          kind: "final",
          outcome: "beneficial",
          metrics: {},
          evidenceDigest: "a".repeat(64),
          confounders: [],
          observedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toMatchObject({
      code: "evaluation_stage_mismatch",
    })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it("rejects an evaluation when another request already consumed its fence", async () => {
    const token = "evaluation-token"
    const treatmentHash = "f".repeat(64)
    const eventCreate = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoExperiment: {
        findUnique: vi.fn(async () => ({
          id: "experiment-1",
          status: "AWAITING_ACTIVATION",
          evaluationFenceGeneration: 1,
          evaluationClaimTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
          evaluationClaimExpiresAt: new Date(Date.now() + 60_000),
          treatmentHash,
          proposalVersion: { proposal: {} },
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      seoEvaluationEvent: { create: eventCreate },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    await expect(
      serviceFor(tx).recordEvaluation({
        assertion: { ...assertion, capability: "evaluate" },
        input: {
          action: "record_result",
          experimentId: "experiment-1",
          claimGeneration: 1,
          claimToken: token,
          kind: "activation",
          outcome: "activated",
          metrics: {},
          evidenceDigest: "a".repeat(64),
          confounders: [],
          observedAt: new Date().toISOString(),
          observedActivationHash: treatmentHash,
        },
      }),
    ).rejects.toMatchObject({ code: "evaluation_fence_lost" })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it("rejects ticket completion when another request consumed its lease", async () => {
    const leaseToken = "ticket-lease-token"
    const attemptCreate = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoTicketOutbox: {
        findUnique: vi.fn(async () => ({
          id: "outbox-1",
          proposalVersionId: "version-1",
          status: "CLAIMED",
          fenceGeneration: 2,
          leaseTokenHash: createHash("sha256").update(leaseToken).digest("hex"),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      seoTicketOutboxAttempt: { create: attemptCreate },
    }

    await expect(
      serviceFor(tx).finishTicket({
        assertion: { ...assertion, capability: "tickets" },
        input: {
          action: "complete",
          outboxId: "outbox-1",
          generation: 2,
          leaseToken,
          remoteId: "FGE-325",
          remoteUrl: "https://linear.app/jesus-film-project/issue/FGE-325",
        },
      }),
    ).rejects.toMatchObject({ code: "ticket_fence_lost" })
    expect(attemptCreate).not.toHaveBeenCalled()
  })

  it("creates a reviewed lesson candidate and approval-required rollback for harm", async () => {
    const token = "evaluation-token"
    const treatmentHash = "f".repeat(64)
    const preChangeSnapshot = { v: 1, data: { title: "Hope" } }
    const treatmentSnapshot = { v: 1, data: { title: "Hope story" } }
    const experimentUpdate = vi.fn()
    const lessonUpsert = vi.fn()
    const proposalVersionUpsert = vi.fn()
    const now = new Date()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoExperiment: {
        findUnique: vi.fn(async () => ({
          id: "experiment-1",
          status: "MEASURING",
          evaluationFenceGeneration: 1,
          evaluationClaimTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
          evaluationClaimExpiresAt: new Date(now.getTime() + 60_000),
          treatmentHash,
          preChangeHash: "e".repeat(64),
          observedActivationHash: treatmentHash,
          activatedAt: new Date(now.getTime() - 40 * 86_400_000),
          finalDueAt: new Date(now.getTime() - 1_000),
          interimDueAt: null,
          preChangeSnapshot,
          treatmentSnapshot,
          proposalVersion: {
            id: "version-1",
            proposalId: "proposal-1",
            version: 1,
            runId: "run-1",
            canonicalIdentityDigest: "d".repeat(64),
            editorialDiff: {
              title: { before: "Hope", after: "Hope story" },
            },
            proposal: {
              id: "proposal-1",
              semanticConflictKey: "target:en:editorial:title",
              targetType: "VideoLocale",
              targetId: "target-1",
              canonicalUrl: "https://example.com/watch/hope.html",
              locale: "en",
            },
          },
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: experimentUpdate,
      },
      seoEvaluationEvent: {
        create: vi.fn(async ({ data }) => ({
          id: "event-1",
          ...data,
          observedAt: new Date(data.observedAt),
        })),
      },
      seoLesson: { upsert: lessonUpsert },
      seoProposal: { upsert: vi.fn() },
      seoProposalVersion: { upsert: proposalVersionUpsert },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }
    await serviceFor(tx).recordEvaluation({
      assertion: { ...assertion, capability: "evaluate" },
      input: {
        action: "record_result",
        experimentId: "experiment-1",
        claimGeneration: 1,
        claimToken: token,
        kind: "final",
        outcome: "harmful",
        metrics: { gsc: { ctrChange: -0.2 } },
        evidenceDigest: "a".repeat(64),
        confounders: [],
        observedAt: now.toISOString(),
      },
    })

    expect(lessonUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ experimentId: "experiment-1" }),
      }),
    )
    expect(proposalVersionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          baseContentHash: treatmentHash,
          preChangeSnapshot: treatmentSnapshot,
          treatmentSnapshot: preChangeSnapshot,
        }),
      }),
    )
    expect(experimentUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HARMFUL" }),
      }),
    )
  })
})
