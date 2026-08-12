import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../../config/seo"
import { toAdminSeoProposal } from "../../services/admin-seo-client"
import { SeoProposalSchema } from "../tools/seo-analysis"
import { runSeoDailyAudit, seoDailyAuditWorkflow } from "./seo-daily-audit"

const deterministicProposal = SeoProposalSchema.parse({
  proposalId: "seo-proposal-1",
  payloadDigest: "a".repeat(64),
  semanticConflictKey: "video-1:en:editorial:title",
  lane: "editorial",
  canonicalUrl: "https://example.com/watch/jesus.html",
  locale: "en",
  targetId: "video-1",
  targetType: "watch",
  query: "watch jesus",
  intent: "Deterministic intent",
  persona: "Deterministic persona",
  evidenceObservationIds: ["gsc-1"],
  caveats: ["Deterministic caveat"],
  expectedOutcome: "Deterministic outcome",
  risk: "Deterministic risk",
  verificationPlan: ["Deterministic verification"],
  baseHash: "b".repeat(64),
  canonicalIdentityDigest: "c".repeat(64),
  preChangeSnapshot: { v: 1, data: { title: "Before" } },
  fieldDiff: [{ field: "title", before: "Before", after: "After" }],
  rollbackSnapshot: { title: "Before" },
})

function interpretationDeps(overrides: Parameters<typeof runSeoDailyAudit>[1]) {
  return {
    config: getSeoConfig({
      SEO_AUTOMATION_MODE: "dry_run",
      SEO_MAX_PROPOSALS: "1",
    }),
    capabilities: {
      gsc: false,
      ga4: false,
      firecrawl: false,
      groundedSearch: false,
      adminLedger: true,
      linearDispatch: false,
    },
    startRun: vi.fn(async () => ({
      ok: true,
      result: {
        run: {
          id: "run-1",
          mode: "dry_run" as const,
          deduplicated: false,
          status: "RUNNING",
          executionClaim: {
            generation: 1,
            token: "run-claim-token",
            expiresAt: "2026-08-01T02:15:00.000Z",
          },
        },
        targets: [],
        reviewedLessons: [{ id: "lesson-1", status: "ACTIVE" }],
      },
    })),
    completeRun: vi.fn(async () => ({ ok: true, result: {} })),
    analyze: vi.fn(() => ({
      proposals: [deterministicProposal],
      coverage: {
        targetCount: 0,
        observedTargetCount: 0,
        gscRowCount: 0,
        skippedTargetIds: [],
      },
    })),
    ...overrides,
  }
}

describe("SEO daily audit workflow", () => {
  it("defaults off without touching Admin or any provider", async () => {
    const startRun = vi.fn()
    const queryGsc = vi.fn()
    const result = await runSeoDailyAudit(
      {},
      {
        config: getSeoConfig({}),
        startRun: startRun as never,
        queryGsc: queryGsc as never,
        workflowRunId: "workflow-1",
      },
    )
    expect(result).toMatchObject({ ok: true, mode: "off", reason: "off" })
    expect(startRun).not.toHaveBeenCalled()
    expect(queryGsc).not.toHaveBeenCalled()
  })

  it("creates the Admin run first and persists no proposals in dry_run", async () => {
    const order: string[] = []
    const completeRun = vi.fn(async (input) => {
      order.push("complete")
      expect(input.proposals).toEqual([])
      expect(input.action).toBe("complete_run")
      return { ok: true, result: { ok: true, result: {} } }
    })
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "dry_run" }),
        capabilities: {
          gsc: false,
          ga4: false,
          firecrawl: false,
          groundedSearch: false,
          adminLedger: true,
          linearDispatch: false,
        },
        startRun: vi.fn(async (input) => {
          order.push("start")
          expect(input).toMatchObject({
            action: "start_run",
            idempotencyKey: "seo-daily:2026-08-01",
            mode: "dry_run",
          })
          return {
            ok: true,
            result: {
              run: {
                id: "run-1",
                mode: "dry_run",
                deduplicated: false,
                status: "RUNNING",
                executionClaim: {
                  generation: 1,
                  token: "run-claim-token",
                  expiresAt: "2026-08-01T02:15:00.000Z",
                },
              },
              targets: [],
              reviewedLessons: [],
            },
          }
        }) as never,
        completeRun: completeRun as never,
        workflowRunId: "workflow-1",
        now: () => new Date("2026-08-01T02:00:00.000Z"),
      },
    )
    expect(result.mode).toBe("dry_run")
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        claimGeneration: 1,
        claimToken: "run-claim-token",
      }),
    )
    expect(order).toEqual(["start", "complete"])
  })

  it("does not recollect providers while the same run key is already claimed", async () => {
    const queryGsc = vi.fn()
    const completeRun = vi.fn()
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "live" }),
        startRun: vi.fn(async () => ({
          ok: true,
          result: {
            run: {
              id: "run-1",
              mode: "live",
              deduplicated: true,
              status: "RUNNING",
              executionClaim: null,
            },
            targets: [],
            reviewedLessons: [],
          },
        })) as never,
        queryGsc: queryGsc as never,
        completeRun: completeRun as never,
        workflowRunId: "workflow-2",
      },
    )

    expect(result).toMatchObject({ ok: true, reason: "in_progress" })
    expect(queryGsc).not.toHaveBeenCalled()
    expect(completeRun).not.toHaveBeenCalled()
  })

  it("does not recollect providers for a terminal replayed Admin run", async () => {
    const queryGsc = vi.fn()
    const completeRun = vi.fn()
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "live" }),
        startRun: vi.fn(async () => ({
          ok: true,
          result: {
            run: {
              id: "run-1",
              mode: "live",
              deduplicated: true,
              status: "COMPLETED",
              executionClaim: null,
            },
            targets: [],
            reviewedLessons: [],
          },
        })) as never,
        queryGsc: queryGsc as never,
        completeRun: completeRun as never,
        workflowRunId: "workflow-1",
      },
    )

    expect(result).toMatchObject({ ok: true, reason: "completed" })
    expect(queryGsc).not.toHaveBeenCalled()
    expect(completeRun).not.toHaveBeenCalled()
  })

  it("best-effort terminalizes an unexpected post-claim failure", async () => {
    const completeRun = vi.fn(async () => ({ ok: true, result: {} }))
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      {
        config: getSeoConfig({
          SEO_AUTOMATION_MODE: "live",
          SEO_GSC_PROPERTY_IDS: "sc-domain:example.com",
        }),
        capabilities: {
          gsc: true,
          ga4: false,
          firecrawl: false,
          groundedSearch: false,
          adminLedger: true,
          linearDispatch: false,
        },
        startRun: vi.fn(async () => ({
          ok: true,
          result: {
            run: {
              id: "run-failed",
              mode: "live",
              deduplicated: false,
              status: "RUNNING",
              executionClaim: {
                generation: 2,
                token: "claim-failed",
                expiresAt: "2026-08-01T02:15:00.000Z",
              },
            },
            targets: [],
            reviewedLessons: [],
          },
        })) as never,
        queryGsc: vi.fn(async () => {
          throw new Error("raw provider body token=must-not-escape")
        }) as never,
        completeRun: completeRun as never,
        workflowRunId: "workflow-failed",
        now: () => new Date("2026-08-01T02:00:00.000Z"),
      },
    )

    expect(result).toMatchObject({ ok: false, reason: "admin_unavailable" })
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-failed",
        claimGeneration: 2,
        status: "failed",
        observations: [],
        proposals: [],
      }),
    )
    expect(JSON.stringify(completeRun.mock.calls)).not.toContain(
      "must-not-escape",
    )
  })

  it("terminalizes a resolved completion rejection with a sanitized failed report", async () => {
    const completeRun = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "rejected",
        retryable: false,
        status: 400,
      })
      .mockResolvedValueOnce({ ok: true, result: {} })

    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      interpretationDeps({ completeRun: completeRun as never }) as never,
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "admin_unavailable",
      report: {
        providerCoverage: { workflow: "unavailable" },
        suppressedOperations: expect.arrayContaining(["run_failed"]),
      },
    })
    expect(completeRun).toHaveBeenCalledTimes(2)
    expect(completeRun.mock.calls[0]?.[0]).toMatchObject({ status: "partial" })
    expect(completeRun.mock.calls[1]?.[0]).toMatchObject({
      status: "failed",
      observations: [],
      proposals: [],
    })
  })

  it("replays the identical completion when the committed response is lost", async () => {
    const completeRun = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "timeout",
        retryable: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { status: "PARTIAL", replayed: true },
      })

    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      interpretationDeps({ completeRun: completeRun as never }) as never,
    )

    expect(result).toMatchObject({ ok: true, reason: "partial" })
    expect(completeRun).toHaveBeenCalledTimes(2)
    expect(completeRun.mock.calls[1]?.[0]).toEqual(
      completeRun.mock.calls[0]?.[0],
    )
    expect(
      completeRun.mock.calls.map(([completion]) => completion.status),
    ).toEqual(["partial", "partial"])
  })

  it("invokes the registered agent and merges only its bounded interpretation", async () => {
    const generate = vi.fn(async () => ({
      object: {
        proposals: [
          {
            proposalId: deterministicProposal.proposalId,
            intent: "Refined intent",
            persona: "Refined persona",
            expectedOutcome: "Refined outcome",
            caveats: ["Refined caveat"],
          },
        ],
      },
    }))
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      interpretationDeps({
        resolveAgent: () => ({ generate }),
      }) as never,
    )

    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        maxOutputTokens: 2_000,
        toolChoice: "none",
        structuredOutput: expect.objectContaining({
          schema: expect.anything(),
        }),
      }),
    )
    const proposal = result.proposals[0]!
    if (
      proposal.lane !== "editorial" ||
      deterministicProposal.lane !== "editorial"
    ) {
      throw new Error("expected editorial proposal")
    }
    expect(proposal.proposalId).toBe(deterministicProposal.proposalId)
    expect(proposal.canonicalUrl).toBe(deterministicProposal.canonicalUrl)
    expect(proposal.fieldDiff).toEqual(deterministicProposal.fieldDiff)
    expect(proposal.intent).not.toBe(deterministicProposal.intent)
    expect(proposal.payloadDigest).not.toBe(deterministicProposal.payloadDigest)
    expect(toAdminSeoProposal(proposal).payloadDigest).toBe(
      proposal.payloadDigest,
    )
    expect(proposal.caveats).toEqual(
      expect.arrayContaining(deterministicProposal.caveats),
    )
  })

  it("falls back to deterministic proposals when interpretation IDs are invalid", async () => {
    const interpret = vi.fn(async () => ({
      proposals: [
        {
          proposalId: "unexpected-proposal",
          intent: "Changed",
          persona: "Changed",
          expectedOutcome: "Changed",
          caveats: [],
        },
      ],
    }))
    const result = await runSeoDailyAudit(
      { scheduledFor: "2026-08-01T02:00:00.000Z" },
      interpretationDeps({ interpret }) as never,
    )

    expect(interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: [
          expect.objectContaining({
            proposalId: deterministicProposal.proposalId,
          }),
        ],
        reviewedLessons: [expect.objectContaining({ id: "lesson-1" })],
      }),
    )
    expect(result.proposals).toEqual([deterministicProposal])
  })

  it("is registered for 02:00 UTC with empty scheduled input", () => {
    expect(seoDailyAuditWorkflow.committed).toBe(true)
    const schedules = (
      seoDailyAuditWorkflow as typeof seoDailyAuditWorkflow & {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()
    expect(schedules).toEqual([
      expect.objectContaining({ cron: "0 2 * * *", timezone: "UTC" }),
    ])
  })
})
