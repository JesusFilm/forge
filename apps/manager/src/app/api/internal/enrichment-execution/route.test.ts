import { beforeEach, describe, expect, it, vi } from "vitest"
const { execute, config } = vi.hoisted(() => ({
  execute: vi.fn(),
  config: {
    ADMIN_TRIGGER_API_KEYS: "admin-dummy",
    ENRICHMENT_CALLBACK_API_KEYS: "execution-dummy",
  },
}))
vi.mock("@/config/env", () => ({ env: config }))
vi.mock("@/lib/enrichment-execution", () => ({
  executeEnrichmentOperation: execute,
}))
import { POST } from "./route"
const body = {
  jobId: "job",
  runId: "run",
  inputDigest: "a".repeat(64),
  operation: { kind: "audio-cleanup" },
}
function request(
  value: unknown = body,
  bearer = "execution-dummy",
  headers: Record<string, string> = {},
) {
  return new Request("https://manager.test/api/internal/enrichment-execution", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(value),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  config.ADMIN_TRIGGER_API_KEYS = "admin-dummy"
  execute.mockResolvedValue({ status: 200, body: { ok: true, result: {} } })
})
describe("execution bridge HTTP authority and bounds", () => {
  it("requires service auth before parsing or claiming", async () => {
    const req = request(body, "wrong")
    const read = vi.spyOn(req.body!, "getReader")
    expect((await POST(req)).status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
  it("rejects overlapping authority lanes", async () => {
    config.ADMIN_TRIGGER_API_KEYS = "execution-dummy"
    expect((await POST(request())).status).toBe(503)
    expect(execute).not.toHaveBeenCalled()
  })
  it("limits both declared and chunked bodies before operation dispatch", async () => {
    expect(
      (await POST(request(body, undefined, { "content-length": "65537" })))
        .status,
    ).toBe(413)
    expect(
      (await POST(request({ ...body, padding: "x".repeat(65537) }))).status,
    ).toBe(413)
    expect(execute).not.toHaveBeenCalled()
  })
  it("rejects arbitrary operations, URLs, targets and unbounded candidate arrays", async () => {
    for (const invalid of [
      { ...body, operation: { kind: "fetch", url: "https://example.com" } },
      { ...body, operation: { kind: "audio-cleanup", assetId: "other" } },
      {
        ...body,
        operation: {
          kind: "mux-publication",
          languageResults: Array.from({ length: 51 }, () => ({
            lang: "fr",
            status: "completed",
          })),
        },
      },
      { ...body, inputDigest: "bad" },
    ])
      expect((await POST(request(invalid))).status).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })
  it("forwards the fixed operation and exact run fence", async () => {
    expect((await POST(request())).status).toBe(200)
    expect(execute).toHaveBeenCalledWith(body)
  })
})

it("admits only fixed stage claims and bounded token-bound completions", async () => {
  const stage = { stage: "translation", stageDigest: "b".repeat(64) }
  const claim = { ...body, operation: { kind: "mastra-stage-claim", ...stage } }
  expect((await POST(request(claim))).status).toBe(200)
  expect(execute).toHaveBeenLastCalledWith(claim)
  const complete = {
    ...body,
    operation: {
      kind: "mastra-stage-complete",
      ...stage,
      claimToken: "token",
      result: { status: "completed" },
    },
  }
  expect((await POST(request(complete))).status).toBe(200)
  for (const operation of [
    { kind: "mastra-stage-claim", ...stage, stage: "arbitrary-provider" },
    { kind: "mastra-stage-claim", ...stage, stageDigest: "invalid" },
    { kind: "mastra-stage-claim", ...stage, url: "https://unowned.invalid" },
    { ...complete.operation, claimToken: "" },
    {
      ...complete.operation,
      result: { status: "completed", data: "arbitrary" },
    },
  ])
    expect((await POST(request({ ...body, operation }))).status).toBe(400)
  expect(execute).toHaveBeenCalledTimes(2)
})
