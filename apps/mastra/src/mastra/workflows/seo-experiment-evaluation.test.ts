import { createHash } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../../config/seo"
import {
  runSeoExperimentEvaluation,
  seoExperimentEvaluationWorkflow,
} from "./seo-experiment-evaluation"

const digest = createHash("sha256").update("treatment").digest("hex")
const config = getSeoConfig({
  SEO_AUTOMATION_MODE: "live",
  SEO_GSC_PROPERTY_IDS: "gsc-1",
  SEO_GA4_PROPERTY_IDS: "ga4-1",
  SEO_ALLOWED_PAGE_HOSTS: "example.com",
  SEO_EVALUATION_MIN_IMPRESSIONS: "10",
})

function claim(stage: "activation" | "final") {
  return {
    id: "experiment-1",
    claimGeneration: 1,
    claimToken: "claim-token",
    stage,
    status: stage === "activation" ? "AWAITING_ACTIVATION" : "MEASURING",
    lane: "editorial" as const,
    canonicalUrl: "https://example.com/watch/jesus.html",
    treatmentHash: digest,
    expectedActivationHash: digest,
    currentCanonicalActivationHash: digest,
    preChangeHash: "b".repeat(64),
    preChangeSnapshot: {},
    activatedAt: "2026-07-01T00:00:00.000Z",
    gscPropertyId: "gsc-1",
    ga4PropertyId: "ga4-1",
    baselineWindow: { startDate: "2026-06-03", endDate: "2026-06-30" },
    treatmentWindow: { startDate: "2026-07-01", endDate: "2026-07-28" },
    confounders: [],
    deploymentProbe: null,
  }
}

describe("SEO experiment evaluation workflow", () => {
  it("makes no claims while automation is off", async () => {
    const claim = vi.fn()
    const result = await runSeoExperimentEvaluation(
      {},
      { config: getSeoConfig({}), claim: claim as never },
    )
    expect(result).toMatchObject({
      ok: true,
      mode: "off",
      claimed: 0,
      recorded: 0,
    })
    expect(claim).not.toHaveBeenCalled()
  })

  it("makes no claims while automation is dry-run", async () => {
    const claimDue = vi.fn()
    const result = await runSeoExperimentEvaluation(
      {},
      {
        config: getSeoConfig({ SEO_AUTOMATION_MODE: "dry_run" }),
        claim: claimDue as never,
      },
    )
    expect(result).toMatchObject({ ok: true, mode: "dry_run", claimed: 0 })
    expect(claimDue).not.toHaveBeenCalled()
  })

  it("is registered for the daily 02:30 UTC sweep", () => {
    const schedules = (
      seoExperimentEvaluationWorkflow as typeof seoExperimentEvaluationWorkflow & {
        getScheduleConfigs: () => Array<{ cron: string; timezone?: string }>
      }
    ).getScheduleConfigs()
    expect(schedules).toEqual([
      expect.objectContaining({ cron: "30 2 * * *", timezone: "UTC" }),
    ])
  })

  it("records activation only after the objective treatment hash matches", async () => {
    const record = vi.fn(async () => ({ ok: true, result: {} }))
    const result = await runSeoExperimentEvaluation(
      {},
      {
        config,
        claim: vi.fn(async () => ({
          ok: true,
          result: { experiments: [claim("activation")] },
        })) as never,
        record: record as never,
      },
    )

    expect(result).toMatchObject({ recorded: 1, awaitingActivation: 0 })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "activation",
        outcome: "activated",
        observedActivationHash: digest,
        activatedAt: expect.any(String),
      }),
    )
  })

  it("hashes a hex-shaped response header as a raw value", async () => {
    const headerValue = "d".repeat(64)
    const expectedActivationHash = createHash("sha256")
      .update(headerValue)
      .digest("hex")
    const record = vi.fn(async () => ({ ok: true, result: {} }))
    const experiment = {
      ...claim("activation"),
      lane: "engineering" as const,
      expectedActivationHash,
      currentCanonicalActivationHash: null,
      deploymentProbe: {
        type: "response_header",
        headerName: "x-forge-deployment",
        expectedValue: headerValue,
      },
    }

    const result = await runSeoExperimentEvaluation(
      {},
      {
        config,
        claim: vi.fn(async () => ({
          ok: true,
          result: { experiments: [experiment] },
        })) as never,
        record: record as never,
        fetchImpl: vi.fn(
          async () =>
            new Response("ok", {
              headers: { "x-forge-deployment": headerValue },
            }),
        ) as never,
        resolveHost: async () => [{ address: "93.184.216.34" }],
      },
    )

    expect(result).toMatchObject({ recorded: 1, failed: 0 })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "activated",
        observedActivationHash: expectedActivationHash,
      }),
    )
  })

  it("isolates a malformed legacy probe from later experiment claims", async () => {
    const record = vi.fn(async () => ({ ok: true, result: {} }))
    const malformed = {
      ...claim("activation"),
      id: "experiment-malformed",
      lane: "engineering" as const,
      currentCanonicalActivationHash: null,
      deploymentProbe: {
        type: "response_header",
        headerName: "bad header",
        expectedValue: "deployed",
      },
    }

    const result = await runSeoExperimentEvaluation(
      {},
      {
        config,
        claim: vi.fn(async () => ({
          ok: true,
          result: { experiments: [malformed, claim("activation")] },
        })) as never,
        record: record as never,
        fetchImpl: vi.fn(async () => new Response("ok")) as never,
        resolveHost: async () => [{ address: "93.184.216.34" }],
      },
    )

    expect(result).toMatchObject({ claimed: 2, recorded: 1, failed: 1 })
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: "experiment-1" }),
    )
  })

  it("records a harmful final result when the exact landing-page GA4 guardrail regresses", async () => {
    const record = vi.fn(async () => ({ ok: true, result: {} }))
    const queryGa4 = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        rows: [{ metrics: { sessions: 100 } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        rows: [{ metrics: { sessions: 50 } }],
      })
    const queryGsc = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        rows: [{ clicks: 10, impressions: 100 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        rows: [{ clicks: 11, impressions: 100 }],
      })

    const result = await runSeoExperimentEvaluation(
      {},
      {
        config,
        claim: vi.fn(async () => ({
          ok: true,
          result: { experiments: [claim("final")] },
        })) as never,
        record: record as never,
        queryGsc: queryGsc as never,
        queryGa4: queryGa4 as never,
      },
    )

    expect(result).toMatchObject({ recorded: 1, failed: 0 })
    expect(queryGa4).toHaveBeenCalledTimes(2)
    expect(queryGa4).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        landingPage: "https://example.com/watch/jesus.html",
      }),
    )
    expect(queryGa4).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        landingPage: "https://example.com/watch/jesus.html",
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "final", outcome: "harmful" }),
    )
  })
})
