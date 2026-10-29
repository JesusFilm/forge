import { describe, expect, it, vi } from "vitest"
import { executeEnrichmentOperation } from "./enrichment-execution"
import {
  executionDigest,
  type ExecutionRequest,
} from "./enrichment-execution-contract"
import type { JobRecord } from "@/types/job"
vi.mock("@/config/env", () => ({ env: {} }))
const request: ExecutionRequest = {
  jobId: "job",
  runId: "run",
  inputDigest: "a".repeat(64),
  operation: { kind: "audio-cleanup" },
}
const job = {
  id: "job",
  muxAssetId: "asset",
  languages: ["fr"],
  artifacts: {},
  options: { engine: "mastra", currentRunId: "run" },
  status: "running",
} as JobRecord
function deps() {
  return {
    getJob: vi.fn(async () => job),
    claim: vi.fn(async () => ({
      status: "claimed" as const,
      claimToken: "token",
    })),
    complete: vi.fn(async () => ({
      status: "replayed" as const,
      result: { artifactKeys: ["original-audio", "cleaned-audio"] },
    })),
    perform: vi.fn(async () => ({
      artifactKeys: ["original-audio", "cleaned-audio"],
    })),
  }
}
describe("fixed Manager execution operations", () => {
  it("denies stale runs without side effects", async () => {
    const d = deps()
    d.claim.mockResolvedValueOnce({ status: "stale" } as never)
    expect((await executeEnrichmentOperation(request, d)).status).toBe(409)
    expect(d.perform).not.toHaveBeenCalled()
  })
  it("claims before spending and completes after persisting the bounded result", async () => {
    const d = deps()
    const outcome = await executeEnrichmentOperation(request, d)
    expect(outcome.status).toBe(200)
    expect(d.claim).toHaveBeenCalledWith({
      jobId: request.jobId,
      runId: request.runId,
      inputDigest: request.inputDigest,
      operationId: "audio-cleanup",
      operationDigest: executionDigest(request.operation),
    })
    expect(d.claim.mock.invocationCallOrder[0]).toBeLessThan(
      d.perform.mock.invocationCallOrder[0]!,
    )
    expect(d.perform.mock.invocationCallOrder[0]).toBeLessThan(
      d.complete.mock.invocationCallOrder[0]!,
    )
  })
  it("replays completed results without repeating side effects", async () => {
    const d = deps()
    d.claim.mockResolvedValueOnce({
      status: "replayed",
      result: { saved: true },
    } as never)
    expect((await executeEnrichmentOperation(request, d)).body).toMatchObject({
      result: { saved: true },
    })
    expect(d.perform).not.toHaveBeenCalled()
  })
  it("leaves an ambiguous claim consumed", async () => {
    const d = deps()
    d.perform.mockRejectedValueOnce(new Error("lost provider response"))
    expect((await executeEnrichmentOperation(request, d)).status).toBe(503)
    expect(d.complete).not.toHaveBeenCalled()
  })
  it("rejects unowned publication languages before claiming", async () => {
    const d = deps()
    expect(
      (
        await executeEnrichmentOperation(
          {
            ...request,
            operation: {
              kind: "mux-publication",
              languageResults: [{ lang: "de", status: "completed" }],
            },
          },
          d,
        )
      ).status,
    ).toBe(400)
    expect(d.claim).not.toHaveBeenCalled()
  })
})

describe("Mastra stage ownership fencing", () => {
  const stageClaim: ExecutionRequest = {
    ...request,
    operation: {
      kind: "mastra-stage-claim",
      stage: "metadata",
      stageDigest: "b".repeat(64),
    },
  }
  it("returns a stage token without completing or running a Manager side effect", async () => {
    const d = deps()
    expect(await executeEnrichmentOperation(stageClaim, d)).toMatchObject({
      status: 200,
      body: { result: { status: "claimed", claimToken: "token" } },
    })
    expect(d.claim).toHaveBeenCalledWith({
      jobId: request.jobId,
      runId: request.runId,
      inputDigest: request.inputDigest,
      operationId: "mastra:metadata",
      operationDigest: "b".repeat(64),
    })
    expect(d.complete).not.toHaveBeenCalled()
    expect(d.perform).not.toHaveBeenCalled()
  })
  it("replays a stage receipt without granting a fresh spending token", async () => {
    const d = deps()
    d.claim.mockResolvedValueOnce({
      status: "replayed",
      result: { status: "completed" },
    } as never)
    expect(await executeEnrichmentOperation(stageClaim, d)).toMatchObject({
      status: 200,
      body: { result: { status: "replayed", result: { status: "completed" } } },
    })
    expect(d.perform).not.toHaveBeenCalled()
    expect(d.complete).not.toHaveBeenCalled()
  })
  it("completes only the same immutable stage, using the supplied claim token", async () => {
    const d = deps()
    const operation = {
      kind: "mastra-stage-complete" as const,
      stage: "metadata" as const,
      stageDigest: "b".repeat(64),
      claimToken: "token",
      result: { status: "completed" as const },
    }
    expect(
      (await executeEnrichmentOperation({ ...request, operation }, d)).status,
    ).toBe(200)
    expect(d.complete).toHaveBeenCalledWith({
      jobId: "job",
      runId: "run",
      inputDigest: "a".repeat(64),
      operationId: "mastra:metadata",
      operationDigest: "b".repeat(64),
      claimToken: "token",
      result: { status: "completed" },
    })
    expect(d.claim).not.toHaveBeenCalled()
    expect(d.perform).not.toHaveBeenCalled()
  })
  it("checks current ownership before stage completion and honors atomic stale completion", async () => {
    const operation = {
      kind: "mastra-stage-complete" as const,
      stage: "metadata" as const,
      stageDigest: "b".repeat(64),
      claimToken: "token",
      result: { status: "completed" as const },
    }
    const d = deps()
    d.getJob.mockResolvedValueOnce({
      ...job,
      options: { ...job.options, currentRunId: "replacement" },
    })
    expect(
      (await executeEnrichmentOperation({ ...request, operation }, d)).status,
    ).toBe(409)
    expect(d.complete).not.toHaveBeenCalled()
    d.complete.mockResolvedValueOnce({ status: "stale" } as never)
    expect(
      (await executeEnrichmentOperation({ ...request, operation }, d)).status,
    ).toBe(409)
  })
})
