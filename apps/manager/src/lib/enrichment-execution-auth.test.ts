import { afterEach, expect, it, vi } from "vitest"
const { bearer, job } = vi.hoisted(() => ({
  bearer: vi.fn(async () => "oauth-only-bearer"),
  job: {
    id: "auth-job",
    muxAssetId: "auth-asset",
    options: {
      engine: "mastra",
      currentRunId: "auth-run",
      enrichmentArtifacts: {
        assetId:
          "enrichment-job-" +
          "c772ad5acbcfb0c06467b4cac9bf1e8934f507b1a7a2c6052e638849ebfbbd78",
        status: "ready",
        sourceVerified: false,
      },
    },
    status: "running",
  },
}))
vi.mock("@/lib/admin-manager-session", () => ({
  getAdminManagerServiceBearer: bearer,
}))
vi.mock("@/config/env", () => ({
  env: { ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql" },
}))
vi.mock("@/lib/state", () => ({ getJob: async () => job }))
import { executeEnrichmentOperation } from "./enrichment-execution"
afterEach(() => vi.unstubAllGlobals())
it("authenticates bridge claims and completion without a legacy Admin key", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer oauth-only-bearer",
    )
    const { query } = JSON.parse(String(init?.body))
    return query.includes("mutation ClaimManagerExecutionOperation")
      ? Response.json({
          data: {
            claimManagerExecutionOperation: {
              status: "claimed",
              claimToken: "b167d474-57c0-413f-8894-7484f69a2c04",
            },
          },
        })
      : Response.json({
          data: {
            completeManagerExecutionOperation: {
              status: "replayed",
              result: { admitted: true },
            },
          },
        })
  })
  vi.stubGlobal("fetch", fetchImpl)
  const response = await executeEnrichmentOperation({
    jobId: "auth-job",
    runId: "auth-run",
    inputDigest: "a".repeat(64),
    operation: {
      kind: "run-admission",
      assetId: job.options.enrichmentArtifacts.assetId,
      sourceReuse: "none",
      muxAssetId: "auth-asset",
    },
  })
  expect(response).toMatchObject({
    status: 200,
    body: { ok: true, result: { admitted: true } },
  })
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(bearer).toHaveBeenCalledTimes(2)
})
