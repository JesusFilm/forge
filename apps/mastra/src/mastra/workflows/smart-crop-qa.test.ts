import { describe, expect, it, vi } from "vitest"

import {
  handleSmartCropQaRouteRequest,
  runSmartCropQaWorkflow,
  type SmartCropQaResult,
} from "./smart-crop-qa"

const QA_MODEL = "google/gemini-2.5-flash"

const baseInput = {
  asset: { assetId: "asset123" },
  renderMode: "preview",
  planSummary: { segmentCount: 412, modes: { speaker: 250, group: 100 } },
  frames: [
    {
      atSeconds: 4,
      url: "https://image.mux.com/pb_abc/frame-001.jpg",
      shotId: "shot_00421",
    },
    { atSeconds: 44, url: "https://image.mux.com/pb_abc/frame-002.jpg" },
  ],
  model: QA_MODEL,
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const cannedQaResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          verdict: "pass",
          issues: [
            {
              severity: "warning",
              description: "Subject slightly off-center in opening shot",
              atSeconds: 4,
              shotId: null,
            },
            {
              severity: "info",
              description: "Slight motion blur",
              atSeconds: null,
              shotId: "shot_00421",
            },
          ],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 900, completion_tokens: 40 },
}

describe("smart crop qa workflow", () => {
  it("reviews frames end-to-end from a canned OpenRouter response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cannedQaResponse))

    const result = await runSmartCropQaWorkflow(baseInput, {
      runId: "run-qa",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: true,
      verdict: "pass",
      issues: [
        {
          severity: "warning",
          description: "Subject slightly off-center in opening shot",
          atSeconds: 4,
        },
        {
          severity: "info",
          description: "Slight motion blur",
          shotId: "shot_00421",
        },
      ],
      usage: { inputTokens: 900, outputTokens: 40 },
      model: QA_MODEL,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    const body = JSON.parse(String(init.body)) as {
      model: string
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
      response_format: { type: string; json_schema: { strict: boolean } }
    }
    expect(body.model).toBe(QA_MODEL)
    expect(body.response_format.json_schema.strict).toBe(true)
    const textParts = body.messages[0]!.content.filter(
      (part) => part.type === "text",
    )
    expect(textParts.map((part) => part.text)).toContain(
      "frame at 4s (shotId shot_00421):",
    )
    expect(textParts.map((part) => part.text)).toContain("frame at 44s:")
    expect(String(textParts[0]!.text)).toContain('"segmentCount":412')
    const imageParts = body.messages[0]!.content.filter(
      (part) => part.type === "image_url",
    )
    expect(imageParts).toHaveLength(2)
  })

  it("defaults usage tokens to zero when the provider omits usage", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ verdict: "needs_repair", issues: [] }),
            },
          },
        ],
      }),
    )

    const result = await runSmartCropQaWorkflow(baseInput, {
      runId: "run-qa-no-usage",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: true,
      verdict: "needs_repair",
      issues: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      model: QA_MODEL,
    })
  })

  it("fails with provider_invalid_output for an unknown verdict", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({ verdict: "maybe", issues: [] }),
            },
          },
        ],
      }),
    )

    const result = await runSmartCropQaWorkflow(baseInput, {
      runId: "run-qa-bad-verdict",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_invalid_output",
      retryable: false,
      mastraRunId: "run-qa-bad-verdict",
    })
  })

  it("rejects frame URLs outside the allowlist before any provider call", async () => {
    const fetchImpl = vi.fn()

    const result = await runSmartCropQaWorkflow(
      {
        ...baseInput,
        frames: [{ atSeconds: 4, url: "http://image.mux.com/frame.jpg" }],
      },
      {
        runId: "run-qa-bad-host",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "frame_host_not_allowed",
      retryable: false,
      mastraRunId: "run-qa-bad-host",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns invalid_input when more than 8 frames are provided", async () => {
    const result = await runSmartCropQaWorkflow(
      {
        ...baseInput,
        frames: Array.from({ length: 9 }, (_, index) => ({
          atSeconds: index,
          url: `https://image.mux.com/pb_abc/frame-${index}.jpg`,
        })),
      },
      { runId: "run-qa-too-many" },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "smart crop qa input failed validation",
      mastraRunId: "run-qa-too-many",
    })
  })

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSmartCropQaRouteRequest({
      authHeader: "Bearer wrong-key",
      serviceKeys: ["service-key"],
      readJson: async () => baseInput,
    })

    expect(outcome).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
  })

  it("maps invalid route input to 400", async () => {
    const outcome = await handleSmartCropQaRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ asset: { assetId: "asset123" } }),
    })

    expect(outcome.status).toBe(400)
    expect(outcome.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
  })

  it("launches the workflow from a valid route request", async () => {
    const result: SmartCropQaResult = {
      ok: true,
      verdict: "pass",
      issues: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      model: QA_MODEL,
    }
    const launch = vi.fn(async () => result)

    const outcome = await handleSmartCropQaRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => baseInput,
      launch,
    })

    expect(outcome).toEqual({ status: 200, body: { result } })
    expect(launch).toHaveBeenCalledWith(baseInput, {
      runId: expect.any(String),
    })
  })
})
