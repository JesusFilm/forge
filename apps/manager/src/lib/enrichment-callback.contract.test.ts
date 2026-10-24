import steps from "../../../../docs/fixtures/manager-enrichment-steps.json"
import { FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"
import { describe, expect, it } from "vitest"

import callbackFixtures from "../../../../docs/fixtures/manager-enrichment-callbacks.json"
import { EnrichmentCallbackSchema } from "@/lib/enrichment-callback"

describe("EnrichmentCallbackSchema shared fixtures", () => {
  it.each(Object.entries(callbackFixtures))("accepts %s", (_name, callback) => {
    expect(EnrichmentCallbackSchema.safeParse(callback).success).toBe(true)
  })
})

// Shared data fixtures keep app-local schemas aligned without app imports.
describe("complete callback inventory", () => {
  it("matches every current Manager enrichment step", () => {
    expect(FORGE_WORKFLOW_STEPS).toEqual(steps)
  })
  it.each(steps)(
    "validates all callback statuses and strict fields for %s",
    (step) => {
      const base = {
        jobId: "dummy-job",
        engine: "mastra",
        runId: "dummy-run",
        sequence: 1,
        step,
      }
      for (const status of ["running", "completed", "failed", "skipped"]) {
        const callback = {
          ...base,
          status,
          ...(status === "failed" ? { error: "dummy failure" } : {}),
        }
        expect(EnrichmentCallbackSchema.safeParse(callback).success).toBe(true)
        expect(
          EnrichmentCallbackSchema.safeParse({ ...callback, unexpected: true })
            .success,
        ).toBe(false)
      }
      for (const invalid of [
        { ...base, status: "pending" },
        { ...base, status: "failed" },
        { ...base, status: "running", artifactsDelta: ["transcript"] },
        {
          ...base,
          status: "completed",
          artifactsDelta: [{ kind: "downloadable" }],
        },
        { ...base, status: "completed", artifactsDelta: ["x".repeat(129)] },
        {
          ...base,
          status: "completed",
          artifactsDelta: Array(101).fill("transcript"),
        },
        {
          ...base,
          status: "completed",
          languageResults: [{ lang: "fr", status: "running" }],
        },
        { ...base, status: "completed", sequence: -1 },
      ])
        expect(EnrichmentCallbackSchema.safeParse(invalid).success).toBe(false)
    },
  )
})
