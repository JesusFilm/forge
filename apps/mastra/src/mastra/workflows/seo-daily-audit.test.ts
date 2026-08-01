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
    expect(order).toEqual(["start", "complete"])
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
