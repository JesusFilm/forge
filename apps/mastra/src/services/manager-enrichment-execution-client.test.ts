import { describe, expect, it, vi } from "vitest"
import {
  executeManagerEnrichmentOperation,
  ManagerEnrichmentExecutionError,
} from "./manager-enrichment-execution-client"
const input = {
  jobId: "job",
  runId: "run",
  inputDigest: "a".repeat(64),
  operation: { kind: "audio-cleanup" as const },
}
const config = {
  callbackUrl: "https://manager.test/api/internal/enrichment-callback",
  bearer: "dummy",
}
describe("Manager execution client", () => {
  it("uses the fixed service URL, exact fence and redirect rejection", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true, result: { artifactKeys: ["cleaned-audio"] } }),
    )
    expect(
      await executeManagerEnrichmentOperation(input, { ...config, fetchImpl }),
    ).toEqual({ artifactKeys: ["cleaned-audio"] })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe(
      "https://manager.test/api/internal/enrichment-execution",
    )
    expect(init?.redirect).toBe("error")
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })
  it("does not automatically retry an ambiguous external operation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 503 }),
    )
    await expect(
      executeManagerEnrichmentOperation(input, { ...config, fetchImpl }),
    ).rejects.toBeInstanceOf(ManagerEnrichmentExecutionError)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it("bounds both request and response bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("x".repeat(65537)),
    )
    await expect(
      executeManagerEnrichmentOperation(
        { ...input, jobId: "x".repeat(65537) },
        { ...config, fetchImpl },
      ),
    ).rejects.toMatchObject({ status: 413 })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(
      executeManagerEnrichmentOperation(input, { ...config, fetchImpl }),
    ).rejects.toMatchObject({ status: 502 })
  })
})

it("carries fixed per-stage claim/completion fences without replay retries", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const operation = JSON.parse(String(init?.body)).operation
    return Response.json({
      ok: true,
      result:
        operation.kind === "mastra-stage-claim"
          ? { status: "claimed", claimToken: "stage-token" }
          : { status: "replayed", result: { status: "completed" } },
    })
  })
  const stage = { stage: "translation" as const, stageDigest: "b".repeat(64) }
  expect(
    await executeManagerEnrichmentOperation(
      { ...input, operation: { kind: "mastra-stage-claim", ...stage } },
      { ...config, fetchImpl },
    ),
  ).toEqual({ status: "claimed", claimToken: "stage-token" })
  expect(
    await executeManagerEnrichmentOperation(
      {
        ...input,
        operation: {
          kind: "mastra-stage-complete",
          ...stage,
          claimToken: "stage-token",
          result: { status: "completed" },
        },
      },
      { ...config, fetchImpl },
    ),
  ).toEqual({ status: "replayed", result: { status: "completed" } })
  expect(fetchImpl).toHaveBeenCalledTimes(2)
})
