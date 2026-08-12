import { createHash } from "node:crypto"

import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import {
  isExperimentableEngineeringBrief,
  redactSeoJson,
  SeoExperimentService,
} from "./seo-experiment.service"
import {
  seoContentHash,
  SeoTargetService,
  seoVideoLocaleActivationHash,
  seoVideoLocaleSnapshot,
} from "./seo-target.service"

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

function v1Report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    detailState: "available" as const,
    selectionPolicyId: "gsc-low-ctr-v1" as const,
    generatedAt: "2026-08-01T00:00:00.000Z",
    eligibleCount: 1,
    observedCount: 1,
    selectedCount: 1,
    wouldProposeCount: 0,
    persistedProposalCount: 0,
    providerCoverage: { gsc: "available" as const },
    skippedTargetIds: [],
    suppressedOperations: [],
    gscRequests: [
      {
        propertyId: "sc-domain:jesusfilm.org",
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        dimensions: ["query", "page"],
        searchType: "web" as const,
        dataState: "final" as const,
        filters: [],
        timezone: "UTC",
        configuredRowCap: 25_000,
        returnedRowCount: 1,
        pageCount: 1,
        requestCount: 1,
        capReached: false,
        responseAggregationType: "byPage",
        firstIncompleteDate: null,
        status: "available" as const,
        caveats: [],
      },
    ],
    queryFunnel: {
      providerRows: 1,
      malformedRows: 0,
      unmatchedTargetRows: 0,
      belowImpressionThresholdRows: 0,
      ctrThresholdNotMetRows: 0,
      rankedRows: 1,
      selectedQueryRows: 1,
      rejectedQueryRows: 0,
    },
    queryDecisions: [
      {
        observationId: "gsc-1",
        targetId: "target-1",
        locale: "en",
        canonicalUrl: "https://www.jesusfilm.org/watch/hope.html",
        query:
          "hope https://private.example/path?token=secret-value +1 902 555 0199",
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 5,
        score: 95,
        selectionOutcome: "selected" as const,
        reason: "selected" as const,
      },
    ],
    omittedQueryDecisionCount: 0,
    proposalRefs: [],
    ...overrides,
  }
}

describe("SEO experiment eligibility", () => {
  it("keeps editorial activation hashes stable across volatile row changes", () => {
    const content = {
      title: "Hope",
      description: "A story of hope",
      searchTitle: "Watch Hope",
      updatedAt: "2026-08-01T00:00:00.000Z",
      status: "DRAFT",
    }

    expect(
      seoVideoLocaleActivationHash({
        ...content,
        updatedAt: "2026-08-02T00:00:00.000Z",
        status: "PUBLISHED",
      }),
    ).toBe(seoVideoLocaleActivationHash(content))
    expect(
      seoVideoLocaleActivationHash({ ...content, title: "Hope for today" }),
    ).not.toBe(seoVideoLocaleActivationHash(content))
  })

  it("resolves video activation by the language slug when locale is absent", async () => {
    const now = new Date()
    const hashes = await new SeoTargetService().currentHashes({
      tx: {
        $queryRaw: vi.fn(async () => []),
        videoLocale: {
          findUnique: vi.fn(async () => ({
            id: "video-locale-1",
            videoId: "video-1",
            locale: null,
            languageId: "language-1",
            languageSlug: "en",
            languageCoreId: "529",
            source: "CORE",
            title: "Hope",
            description: null,
            snippet: null,
            imageAlt: null,
            searchTitle: null,
            searchDescription: null,
            socialImageAssetId: null,
            status: "PUBLISHED",
            publishedAt: now,
            syncedAt: now,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          })),
        },
      } as never,
      targetType: "VideoLocale",
      targetId: "video-locale-1",
      locale: "en",
    })

    expect(hashes).toMatchObject({
      contentHash: expect.any(String),
      activationHash: expect.any(String),
    })
  })

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
          expectedValue: "d".repeat(64),
        },
      }),
    ).toBe(true)
    expect(
      isExperimentableEngineeringBrief({
        ticketOnly: false,
        deploymentProbe: { type: "operator_confirmation" },
      }),
    ).toBe(false)
    expect(
      isExperimentableEngineeringBrief({
        ticketOnly: false,
        deploymentProbe: {
          type: "response_header",
          headerName: "bad header",
          expectedValue: "deployed",
        },
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

  it("retains descriptions while redacting actual IP-address keys", () => {
    expect(
      redactSeoJson({
        description: "A complete treatment description",
        ip: "10.0.0.1",
        ipAddress: "10.0.0.2",
        clientIp: "10.0.0.3",
        source_ip_address: "10.0.0.4",
      }),
    ).toEqual({
      description: "A complete treatment description",
      ip: "[redacted]",
      ipAddress: "[redacted]",
      clientIp: "[redacted]",
      source_ip_address: "[redacted]",
    })
  })

  it("redacts IPv6 values without changing ordinary colon-delimited text", () => {
    expect(
      redactSeoJson({
        full: "2001:0db8:0000:0000:0000:ff00:0042:8329",
        compressed: "2001:db8::1",
        mapped: "::ffff:192.0.2.128",
        url: "https://[2001:db8::1]/private",
        ordinary: "chapter 12:30 remains text",
      }),
    ).toEqual({
      full: "[redacted-ip]",
      compressed: "[redacted-ip]",
      mapped: "[redacted-ip]",
      url: "https://[redacted-ip]/private",
      ordinary: "chapter 12:30 remains text",
    })
  })

  it("stores only the bounded report when persisted mode is dry-run", async () => {
    const original = run("DRY_RUN")
    const createMany = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        findUnique: vi.fn(async () => original),
        updateMany: vi.fn(async () => ({ count: 1 })),
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
        claimGeneration: 1,
        claimToken: "run-claim-token",
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
    expect(tx.seoRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          executionClaimExpiresAt: expect.anything(),
        }),
      }),
    )
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

  it("reconstructs and redacts a v1 run report before storing it", async () => {
    const original = run("DRY_RUN")
    const report = v1Report({
      gscRequests: [
        {
          ...v1Report().gscRequests[0]!,
          firstIncompleteDate: "2026-07-27",
        },
      ],
    })
    const update = vi.fn(async ({ data }) => ({
      ...original,
      ...data,
      status: "COMPLETED",
      completedAt: new Date(),
    }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        findUnique: vi.fn(async () => original),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update,
      },
      seoEvidenceObservation: { createMany: vi.fn() },
      $queryRaw: vi.fn(async () => [{ mode: "dry_run" }]),
    }

    await serviceFor(tx).completeRun({
      assertion,
      input: {
        action: "complete_run",
        runId: "run-1",
        claimGeneration: 1,
        claimToken: "run-claim-token",
        status: "completed",
        providerCoverage: { gsc: "available" },
        report,
        eligibleCount: 1,
        selectedCount: 1,
        wouldProposeCount: 0,
        suppressedOperations: [],
        observations: [],
        proposals: [],
      },
    })

    const storedReport = update.mock.calls[0]?.[0].data.report
    expect(storedReport).toMatchObject({
      schemaVersion: 1,
      detailState: "available",
      generatedAt: "2026-08-01T00:00:00.000Z",
      gscRequests: [
        expect.objectContaining({
          startDate: "2026-07-01",
          endDate: "2026-07-28",
          firstIncompleteDate: "2026-07-27",
        }),
      ],
      queryDecisions: [
        expect.objectContaining({
          query: "hope [redacted-url] [redacted-phone]",
        }),
      ],
    })
    expect(JSON.stringify(storedReport)).not.toContain("secret-value")
    expect(JSON.stringify(storedReport)).not.toContain("902 555 0199")
  })

  it("trims canonical report detail to the durable byte budget", async () => {
    const original = run("DRY_RUN")
    const update = vi.fn(async ({ data }) => ({
      ...original,
      ...data,
      status: "COMPLETED",
      completedAt: new Date(),
    }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        findUnique: vi.fn(async () => original),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update,
      },
      seoEvidenceObservation: { createMany: vi.fn() },
      $queryRaw: vi.fn(async () => [{ mode: "dry_run" }]),
    }
    const decision = v1Report().queryDecisions[0]!
    const oversized = v1Report({
      skippedTargetIds: Array.from(
        { length: 900 },
        (_, index) =>
          `target-${String(index).padStart(4, "0")}-${"x".repeat(180)}`,
      ),
      queryDecisions: Array.from({ length: 100 }, (_, index) => ({
        ...decision,
        observationId: `gsc-${index}`,
        canonicalUrl: `https://example.com/${"a".repeat(1_950)}${index}`,
        query: "q".repeat(500),
        selectionOutcome: "not_selected" as const,
        reason: "proposal_limit_reached" as const,
      })),
    })

    await serviceFor(tx).completeRun({
      assertion,
      input: {
        action: "complete_run",
        runId: "run-1",
        claimGeneration: 1,
        claimToken: "run-claim-token",
        status: "completed",
        providerCoverage: { gsc: "available" },
        report: oversized,
        eligibleCount: 1,
        selectedCount: 1,
        wouldProposeCount: 0,
        suppressedOperations: [],
        observations: [],
        proposals: [],
      },
    })

    const storedReport = update.mock.calls[0]?.[0].data.report
    expect(
      Buffer.byteLength(JSON.stringify(storedReport), "utf8"),
    ).toBeLessThanOrEqual(220 * 1024)
    expect(storedReport).toMatchObject({
      omittedSkippedTargetCount: expect.any(Number),
      omittedQueryDecisionCount: expect.any(Number),
    })
    expect(storedReport.omittedSkippedTargetCount).toBeGreaterThan(0)
    expect(
      storedReport.omittedSkippedTargetCount +
        storedReport.omittedQueryDecisionCount +
        storedReport.omittedGscRequestCount +
        storedReport.gscRequests.reduce(
          (total: number, request: { omittedCaveatCount: number }) =>
            total + request.omittedCaveatCount,
          0,
        ),
    ).toBeGreaterThan(0)
  }, 10_000)

  it("lists cursor-stable summaries without selecting report bodies", async () => {
    const first = {
      ...run("LIVE"),
      id: "run-2",
      status: "COMPLETED",
      completedAt: new Date("2026-08-02T00:01:00.000Z"),
      startedAt: new Date("2026-08-02T00:00:00.000Z"),
      executionFenceGeneration: 1,
      reportJsonType: "object",
      reportSchemaVersion: "1",
      reportDetailState: "available",
      reportV1ShapeCompatible: true,
      reportLegacyCompatible: false,
    }
    const second = {
      ...first,
      id: "run-1",
    }
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([second])
    const service = new SeoExperimentService({
      $queryRaw: queryRaw,
    } as never)

    const page = await service.listRuns({
      user: { id: null, role: "MANAGER_BACKEND" },
      limit: 1,
    })

    expect(page).toMatchObject({
      items: [
        expect.objectContaining({
          id: "run-2",
          reportAvailability: "available",
        }),
      ],
      hasNextPage: true,
      nextCursor: expect.any(String),
    })
    expect(page.items[0]).not.toHaveProperty("report")
    const firstSql = (
      queryRaw.mock.calls[0]?.[0] as { strings: string[] }
    ).strings.join(" ")
    expect(firstSql).toContain("report ->> 'detailState'")
    expect(firstSql).not.toMatch(/SELECT\s+\*/u)
    expect(firstSql).not.toMatch(/\n\s*report\s*(?:,|AS)/u)

    const next = await service.listRuns({
      user: { id: null, role: "MANAGER_BACKEND" },
      limit: 1,
      after: page.nextCursor,
    })
    expect(next.items.map((item) => item.id)).toEqual(["run-1"])
    const secondQuery = queryRaw.mock.calls[1]?.[0] as {
      strings: string[]
      values: unknown[]
    }
    expect(secondQuery.strings.join(" ")).toMatch(/started_at = .* AND id </u)
    expect(secondQuery.values).toContain("run-2")
  })

  it("returns a compacted run tombstone without query detail", async () => {
    const row = {
      ...run("LIVE"),
      status: "COMPLETED",
      completedAt: new Date("2026-05-01T00:00:00.000Z"),
      executionFenceGeneration: 1,
      report: {
        schemaVersion: 1,
        detailState: "detail_expired",
        selectionPolicyId: "gsc-low-ctr-v1",
        eligibleCount: 1,
        selectedCount: 1,
        wouldProposeCount: 0,
        persistedProposalCount: 0,
        providerCoverage: { gsc: "available" },
        suppressedOperations: [],
        proposalRefs: [],
        detailExpiresAt: "2026-05-30T00:00:00.000Z",
        compactedAt: "2026-05-30T00:00:00.000Z",
      },
    }
    const service = new SeoExperimentService({
      seoRun: { findUnique: vi.fn(async () => row) },
    } as never)

    const detail = await service.getRun({
      user: { id: null, role: "MANAGER_BACKEND" },
      id: "run-1",
    })

    expect(detail).toMatchObject({
      reportAvailability: "detail_expired",
      report: {
        detailState: "detail_expired",
        proposalRefs: [],
      },
      proposalOutcomes: [],
    })
    expect(JSON.stringify(detail)).not.toMatch(/queryDecisions|gscRequests/)
  })

  it("rejects completion after another recovery path terminalized the run", async () => {
    const failedRun = {
      ...run("LIVE"),
      status: "FAILED",
      completedAt: new Date(),
    }
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: { findUnique: vi.fn(async () => failedRun) },
    }

    await expect(
      serviceFor(tx).completeRun({
        assertion,
        input: {
          action: "complete_run",
          runId: "run-1",
          claimGeneration: 1,
          claimToken: "run-claim-token",
          status: "completed",
          providerCoverage: {},
          report: {},
          eligibleCount: 0,
          selectedCount: 0,
          wouldProposeCount: 0,
          suppressedOperations: [],
          observations: [],
          proposals: [],
        },
      }),
    ).rejects.toMatchObject({ code: "run_fence_lost" })
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
        updateMany: vi.fn(async () => ({ count: 1 })),
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
        claimGeneration: 1,
        claimToken: "run-claim-token",
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

  it("returns an active run without duplicating provider work", async () => {
    const existing = {
      ...run("LIVE"),
      executionFenceGeneration: 1,
      executionClaimTokenHash: "a".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() + 60_000),
    }
    const updateMany = vi.fn()
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: { upsert: vi.fn(async () => existing), updateMany },
      videoLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      experienceLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      seoLesson: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    const result = await serviceFor(tx).startRun({
      assertion,
      input: {
        action: "start_run",
        idempotencyKey: "daily-1",
        mode: "live",
        targetLimit: 10,
        leaseSeconds: 900,
      },
    })

    expect(result).toMatchObject({ replayed: true, executionClaim: null })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("reclaims an expired run with a new fenced execution lease", async () => {
    const expired = {
      ...run("LIVE"),
      executionFenceGeneration: 1,
      executionClaimTokenHash: "a".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() - 60_000),
    }
    const reclaimed = {
      ...expired,
      executionFenceGeneration: 2,
      executionClaimTokenHash: "b".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() + 60_000),
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        upsert: vi.fn(async () => expired),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => reclaimed),
      },
      videoLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      experienceLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      seoLesson: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    const result = await serviceFor(tx).startRun({
      assertion,
      input: {
        action: "start_run",
        idempotencyKey: "daily-1",
        mode: "live",
        targetLimit: 10,
        leaseSeconds: 900,
      },
    })

    expect(result).toMatchObject({
      replayed: false,
      executionClaim: { generation: 2, token: expect.any(String) },
    })
    const token = result.executionClaim?.token
    expect(token).toBeTruthy()
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionFenceGeneration: { increment: 1 },
          executionClaimTokenHash: createHash("sha256")
            .update(token!)
            .digest("hex"),
        }),
      }),
    )
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(token)
  })

  it("never upgrades an expired dry-run to live during reclaim", async () => {
    const expired = {
      ...run("DRY_RUN"),
      executionFenceGeneration: 1,
      executionClaimTokenHash: "a".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() - 60_000),
    }
    const reclaimed = {
      ...expired,
      executionFenceGeneration: 2,
      executionClaimTokenHash: "b".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() + 60_000),
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        upsert: vi.fn(async () => expired),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => reclaimed),
      },
      videoLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      experienceLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      seoLesson: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    const result = await serviceFor(tx).startRun({
      assertion,
      input: {
        action: "start_run",
        idempotencyKey: "daily-1",
        mode: "live",
        targetLimit: 10,
        leaseSeconds: 900,
      },
    })

    expect(result).toMatchObject({
      mode: "DRY_RUN",
      executionClaim: { generation: 2 },
      replayed: false,
    })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mode: "DRY_RUN" }),
      }),
    )
  })

  it("terminalizes an expired live run when the Admin switch is off", async () => {
    const expired = {
      ...run("LIVE"),
      executionFenceGeneration: 1,
      executionClaimTokenHash: "a".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() - 60_000),
    }
    const terminal = {
      ...expired,
      mode: "OFF",
      status: "COMPLETED",
      executionClaimTokenHash: null,
      executionClaimExpiresAt: null,
      completedAt: new Date(),
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        upsert: vi.fn(async () => expired),
        updateMany,
        findUniqueOrThrow: vi.fn(async () => terminal),
      },
      videoLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      experienceLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      seoLesson: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [{ mode: "off" }]),
    }

    const result = await serviceFor(tx).startRun({
      assertion,
      input: {
        action: "start_run",
        idempotencyKey: "daily-1",
        mode: "live",
        targetLimit: 10,
        leaseSeconds: 900,
      },
    })

    expect(result).toMatchObject({
      mode: "OFF",
      status: "COMPLETED",
      executionClaim: null,
      replayed: true,
    })
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionFenceGeneration: { increment: 1 },
        }),
      }),
    )
  })

  it("retries serializable start conflicts before returning the run owner", async () => {
    const created = {
      ...run("LIVE"),
      id: "created-run",
      executionFenceGeneration: 1,
      executionClaimTokenHash: "a".repeat(64),
      executionClaimExpiresAt: new Date(Date.now() + 60_000),
    }
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoRun: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async ({ create }) => ({ ...created, id: create.id })),
      },
      videoLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      experienceLocale: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      seoLesson: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("write conflict", {
          code: "P2034",
          clientVersion: "test",
        }),
      )
      .mockImplementationOnce(async (callback) => callback(tx))
    const service = new SeoExperimentService({
      $transaction: transaction,
    } as never)

    const result = await service.startRun({
      assertion,
      input: {
        action: "start_run",
        idempotencyKey: "daily-retry",
        mode: "live",
        targetLimit: 10,
        leaseSeconds: 900,
      },
    })

    expect(transaction).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      runId: expect.any(String),
      executionClaim: { generation: 1 },
      replayed: false,
    })
  })

  it("activates against the stable activation hash instead of the snapshot hash", async () => {
    const token = "evaluation-token"
    const expectedActivationHash = "a".repeat(64)
    const treatmentHash = "f".repeat(64)
    const experimentUpdate = vi.fn()
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
          expectedActivationHash,
          confounders: [],
          proposalVersion: {
            proposal: {
              lane: "ENGINEERING",
              semanticConflictKey: "engineering:test",
            },
          },
        })),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: experimentUpdate,
      },
      seoEvaluationEvent: {
        create: vi.fn(async ({ data }) => ({ id: "event-1", ...data })),
      },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    await serviceFor(tx).recordEvaluation({
      assertion: { ...assertion, capability: "evaluate" },
      input: {
        action: "record_result",
        experimentId: "experiment-1",
        claimGeneration: 1,
        claimToken: token,
        kind: "activation",
        outcome: "activated",
        metrics: {},
        evidenceDigest: "c".repeat(64),
        confounders: [],
        observedAt: new Date().toISOString(),
        observedActivationHash: expectedActivationHash,
      },
    })

    expect(expectedActivationHash).not.toBe(treatmentHash)
    expect(experimentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "MEASURING",
          observedActivationHash: expectedActivationHash,
        }),
      }),
    )
  })

  it("revalidates editorial content inside Admin before activation", async () => {
    const token = "evaluation-token"
    const expectedActivationHash = "a".repeat(64)
    const experimentUpdate = vi.fn()
    const eventCreate = vi.fn(async ({ data }) => ({ id: "event-1", ...data }))
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
          expectedActivationHash,
          confounders: [],
          proposalVersion: {
            proposal: {
              lane: "EDITORIAL",
              targetType: "VideoLocale",
              targetId: "target-1",
              locale: "en",
              semanticConflictKey: "target:en:title",
            },
          },
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: experimentUpdate,
      },
      seoEvaluationEvent: { create: eventCreate },
      videoLocale: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    const result = await serviceFor(tx).recordEvaluation({
      assertion: { ...assertion, capability: "evaluate" },
      input: {
        action: "record_result",
        experimentId: "experiment-1",
        claimGeneration: 1,
        claimToken: token,
        kind: "activation",
        outcome: "activated",
        metrics: {},
        evidenceDigest: "c".repeat(64),
        confounders: [],
        observedAt: new Date().toISOString(),
        observedActivationHash: expectedActivationHash,
      },
    })

    expect(result).toMatchObject({ outcome: "awaiting_activation" })
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "awaiting_activation" }),
      }),
    )
    expect(experimentUpdate).toHaveBeenCalledWith({
      where: { id: "experiment-1" },
      data: {},
    })
  })

  it("reclaims a claimed ticket after its lease expires", async () => {
    const queries: unknown[] = []
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoTicketOutbox: {
        update: vi.fn(async () => ({
          id: "outbox-1",
          fenceGeneration: 2,
          payloadDigest: "a".repeat(64),
          payload: {},
          marker: "forge-seo:proposal-1:v1:aaaaaaaaaaaa",
          remoteId: null,
          remoteUrl: null,
        })),
      },
      $queryRaw: vi.fn(async (query) => {
        queries.push(query)
        return queries.length === 1 ? [{ mode: "live" }] : [{ id: "outbox-1" }]
      }),
    }

    await serviceFor(tx).claimTicket({
      assertion: { ...assertion, capability: "tickets" },
      input: { action: "claim", leaseSeconds: 300 },
    })

    const sql = (queries[1] as { strings: string[] }).strings.join(" ")
    expect(sql).toContain("status = 'claimed'")
    expect(sql).toContain("lease_expires_at <= NOW()")
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

  it("keeps experiments unconfounded until approved overlapping work activates", async () => {
    const payloadDigest = "a".repeat(64)
    const expectedActivationHash = "d".repeat(64)
    const version = {
      id: "version-2",
      proposalId: "proposal-1",
      version: 2,
      payloadDigest,
      payload: {},
      engineeringBrief: {
        ticketOnly: false,
        deploymentProbe: {
          type: "page_text_hash",
          expectedValue: expectedActivationHash,
        },
      },
      preChangeSnapshot: { deployed: false },
      treatmentSnapshot: { deployed: true },
      decision: null,
      materialization: null,
      ticketOutbox: null,
      proposal: {
        id: "proposal-1",
        currentVersion: 2,
        status: "PROPOSED",
        expiresAt: new Date(Date.now() + 60_000),
        semanticConflictKey: "engineering:jsonld",
        targetType: "Engineering",
      },
    }
    const experimentUpdate = vi.fn()
    const experimentCreate = vi.fn()
    const tx = {
      seoApprovalNonce: { create: vi.fn() },
      seoProposalVersion: { findUnique: vi.fn(async () => version) },
      seoProposal: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
      seoExperiment: {
        findMany: vi.fn(async () => [
          {
            id: "experiment-previous",
            confounders: [],
            proposalVersion: { proposalId: "proposal-1" },
          },
        ]),
        create: experimentCreate,
        update: experimentUpdate,
      },
      seoDecision: { create: vi.fn(async () => ({ id: "decision-1" })) },
      seoTicketOutbox: {
        create: vi.fn(async () => ({ id: "outbox-1" })),
      },
      seoProposalMaterialization: { create: vi.fn() },
    }

    const result = await serviceFor(tx).decideProposal({
      user: { id: null, role: "MANAGER_BACKEND" },
      assertion: {
        keyId: "approval-key",
        environment: "test",
        audience: "forge-admin-seo-approval",
        actorId: "manager-user",
        action: "approve",
        proposalId: "proposal-1",
        version: 2,
        payloadDigest,
        nonceHash: "b".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
      expectedAction: "approve",
      overlapAcknowledged: true,
    })

    expect(result).toMatchObject({ status: "APPROVED" })
    expect(experimentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expectedActivationHash,
          confounders: [],
        }),
      }),
    )
    expect(experimentUpdate).not.toHaveBeenCalled()
  })

  it("confounds both live treatments when overlapping work activates", async () => {
    const token = "evaluation-token"
    const expectedActivationHash = "d".repeat(64)
    const experimentUpdate = vi.fn()
    const eventCreate = vi.fn(async ({ data }) => ({ id: "event-1", ...data }))
    const tx = {
      seoWorkloadAssertion: { create: vi.fn() },
      seoExperiment: {
        findUnique: vi.fn(async () => ({
          id: "experiment-new",
          status: "AWAITING_ACTIVATION",
          evaluationFenceGeneration: 1,
          evaluationClaimTokenHash: createHash("sha256")
            .update(token)
            .digest("hex"),
          evaluationClaimExpiresAt: new Date(Date.now() + 60_000),
          expectedActivationHash,
          confounders: [],
          proposalVersion: {
            proposal: {
              lane: "ENGINEERING",
              semanticConflictKey: "engineering:jsonld",
            },
          },
        })),
        findMany: vi.fn(async () => [
          { id: "experiment-existing", confounders: ["campaign_overlap"] },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: experimentUpdate,
      },
      seoEvaluationEvent: { create: eventCreate },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    await serviceFor(tx).recordEvaluation({
      assertion: { ...assertion, capability: "evaluate" },
      input: {
        action: "record_result",
        experimentId: "experiment-new",
        claimGeneration: 1,
        claimToken: token,
        kind: "activation",
        outcome: "activated",
        metrics: {},
        evidenceDigest: "c".repeat(64),
        confounders: [],
        observedAt: new Date().toISOString(),
        observedActivationHash: expectedActivationHash,
      },
    })

    expect(experimentUpdate).toHaveBeenCalledWith({
      where: { id: "experiment-existing" },
      data: {
        confounders: ["campaign_overlap", "overlapping_change"],
      },
    })
    expect(experimentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "experiment-new" },
        data: expect.objectContaining({
          status: "MEASURING",
          confounders: ["overlapping_change"],
        }),
      }),
    )
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confounders: ["overlapping_change"],
        }),
      }),
    )
  })

  it("does not create a lesson or rollback after canonical content changes", async () => {
    const token = "evaluation-token"
    const expectedActivationHash = "a".repeat(64)
    const now = new Date()
    const experimentUpdate = vi.fn()
    const lessonUpsert = vi.fn()
    const proposalUpsert = vi.fn()
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
          expectedActivationHash,
          observedActivationHash: expectedActivationHash,
          activatedAt: new Date(now.getTime() - 40 * 86_400_000),
          finalDueAt: new Date(now.getTime() - 1_000),
          interimDueAt: null,
          confounders: [],
          proposalVersion: {
            id: "version-1",
            proposalId: "proposal-1",
            version: 1,
            runId: "run-1",
            proposal: {
              id: "proposal-1",
              lane: "EDITORIAL",
              targetType: "VideoLocale",
              targetId: "target-1",
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
      seoProposal: { upsert: proposalUpsert },
      seoProposalVersion: { upsert: vi.fn() },
      videoLocale: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn(async () => [{ mode: "live" }]),
    }

    const result = await serviceFor(tx).recordEvaluation({
      assertion: { ...assertion, capability: "evaluate" },
      input: {
        action: "record_result",
        experimentId: "experiment-1",
        claimGeneration: 1,
        claimToken: token,
        kind: "final",
        outcome: "harmful",
        metrics: {},
        evidenceDigest: "c".repeat(64),
        confounders: [],
        observedAt: now.toISOString(),
      },
    })

    expect(lessonUpsert).not.toHaveBeenCalled()
    expect(proposalUpsert).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: "inconclusive" })
    expect(tx.seoEvaluationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "inconclusive",
          confounders: ["canonical_content_changed"],
        }),
      }),
    )
    expect(experimentUpdate).toHaveBeenLastCalledWith({
      where: { id: "experiment-1" },
      data: {
        status: "INCONCLUSIVE",
        finalDueAt: null,
        confounders: ["canonical_content_changed"],
      },
    })
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
    const canonicalRow = {
      id: "target-1",
      videoId: "video-1",
      locale: "en",
      languageId: "language-1",
      languageSlug: "en",
      languageCoreId: "529",
      source: "CORE",
      title: "Hope story",
      description: null,
      snippet: null,
      imageAlt: null,
      searchTitle: null,
      searchDescription: null,
      socialImageAssetId: null,
      status: "PUBLISHED",
      publishedAt: now,
      syncedAt: now,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const canonicalSnapshot = seoVideoLocaleSnapshot(canonicalRow)
    const expectedActivationHash =
      seoVideoLocaleActivationHash(canonicalSnapshot)
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
          expectedActivationHash,
          preChangeHash: "e".repeat(64),
          observedActivationHash: expectedActivationHash,
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
              lane: "EDITORIAL",
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
      videoLocale: { findUnique: vi.fn(async () => canonicalRow) },
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
          baseContentHash: seoContentHash(canonicalSnapshot),
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
