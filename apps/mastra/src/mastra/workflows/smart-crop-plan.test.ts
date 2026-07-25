import { describe, expect, it, vi } from "vitest"

import {
  requestShotCropIntents,
  SmartCropProviderError,
} from "../../services/smart-crop/openrouter-vision"
import { smartCropFailureFromUnknown } from "../../services/smart-crop/workflow-failure"
import {
  _internals,
  handleSmartCropPlanRouteRequest,
  launchSmartCropPlanWorkflow,
  runSmartCropPlanWorkflow,
  smartCropPlanWorkflow,
  type SmartCropPlanResult,
} from "./smart-crop-plan"

const PLAN_MODEL = "qwen/qwen2.5-vl-72b-instruct"

const baseInput = {
  asset: { assetId: "asset123", playbackId: "pb_abc" },
  source: { width: 1920, height: 1080, durationSeconds: 7200 },
  target: { aspectRatio: "9:16", width: 1080, height: 1920 },
  cropMode: "auto",
  shots: [
    {
      shotId: "shot_00421",
      start: 124.2,
      end: 139.8,
      frameUrls: [
        "https://image.mux.com/pb_abc/thumbnail.jpg?time=125",
        "https://image.mux.com/pb_abc/thumbnail.jpg?time=132",
      ],
    },
    {
      shotId: "shot_00422",
      start: 139.8,
      end: 141.8,
      frameUrls: ["https://image.mux.com/pb_abc/thumbnail.jpg?time=140"],
    },
  ],
  model: PLAN_MODEL,
}

// Producer-exact OpenRouter chat-completion payload; shots intentionally out
// of input order to prove the workflow maps by shotId.
const cannedIntentResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          shots: [
            {
              shotId: "shot_00422",
              mode: "action",
              primarySubject: "runner",
              secondarySubjects: [],
              avoidCutting: [],
              confidence: 0.9,
              subjectCenter: {
                start: { cx: 0.1, cy: 0.5 },
                end: { cx: 0.9, cy: 0.5 },
              },
              faceVisible: false,
            },
            {
              shotId: "shot_00421",
              mode: "group",
              primarySubject: "Jesus",
              secondarySubjects: ["disciples"],
              avoidCutting: ["faces"],
              confidence: 0.94,
              subjectCenter: {
                start: { cx: 0.5, cy: 0.4 },
                end: { cx: 0.52, cy: 0.4 },
              },
              faceVisible: true,
              faceCenter: {
                start: { cx: 0.75, cy: 0.22 },
                end: { cx: 0.76, cy: 0.22 },
              },
            },
          ],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 1234, completion_tokens: 56 },
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("smart crop plan workflow", () => {
  it("plans segments end-to-end from a canned OpenRouter response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cannedIntentResponse))

    const result = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-plan",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: true,
      segments: [
        {
          shotId: "shot_00421",
          canonicalStart: 124.2,
          canonicalEnd: 139.8,
          mode: "group",
          primarySubject: "Jesus",
          secondarySubjects: ["disciples"],
          avoidCutting: ["faces"],
          confidence: 0.94,
          faceVisible: true,
          faceCenter: {
            start: { cx: 0.75, cy: 0.22 },
            end: { cx: 0.76, cy: 0.22 },
          },
          cropKeyframes: [
            { progress: 0, x: 1136, y: 0, width: 606, height: 1080 },
            { progress: 1, x: 1136, y: 0, width: 606, height: 1080 },
          ],
        },
        {
          shotId: "shot_00422",
          canonicalStart: 139.8,
          canonicalEnd: 141.8,
          mode: "action",
          primarySubject: "runner",
          secondarySubjects: [],
          avoidCutting: [],
          confidence: 0.9,
          faceVisible: false,
          cropKeyframes: [
            { progress: 0, x: 0, y: 0, width: 606, height: 1080 },
            { progress: 1, x: 480, y: 0, width: 606, height: 1080 },
          ],
        },
      ],
      usage: { inputTokens: 1234, outputTokens: 56 },
      model: PLAN_MODEL,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    )
    const body = JSON.parse(String(init.body)) as {
      model: string
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
      response_format: { type: string; json_schema: { strict: boolean } }
    }
    expect(body.model).toBe(PLAN_MODEL)
    expect(body.response_format.type).toBe("json_schema")
    expect(body.response_format.json_schema.strict).toBe(true)
    const textParts = body.messages[0]!.content.filter(
      (part) => part.type === "text",
    )
    expect(textParts.map((part) => part.text)).toContain(
      "shotId shot_00421 (124.2s-139.8s):",
    )
    expect(textParts.map((part) => String(part.text)).join("\n")).toContain(
      "faceCenter",
    )
    const imageParts = body.messages[0]!.content.filter(
      (part) => part.type === "image_url",
    )
    expect(imageParts).toHaveLength(3)
  })

  it("fails with provider_invalid_output when a shotId is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                shots: [
                  {
                    shotId: "shot_00421",
                    mode: "group",
                    primarySubject: "Jesus",
                    secondarySubjects: [],
                    avoidCutting: [],
                    confidence: 0.94,
                    subjectCenter: {
                      start: { cx: 0.5, cy: 0.4 },
                      end: { cx: 0.5, cy: 0.4 },
                    },
                    faceVisible: true,
                    faceCenter: {
                      start: { cx: 0.5, cy: 0.25 },
                      end: { cx: 0.5, cy: 0.25 },
                    },
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )

    const result = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-missing-shot",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_invalid_output",
      retryable: false,
      mastraRunId: "run-missing-shot",
    })
  })

  it("fails with provider_invalid_output when a visible face center is malformed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                shots: [
                  {
                    shotId: "shot_00421",
                    mode: "speaker",
                    primarySubject: "Jesus",
                    secondarySubjects: [],
                    avoidCutting: ["faces"],
                    confidence: 0.94,
                    subjectCenter: {
                      start: { cx: 0.5, cy: 0.4 },
                      end: { cx: 0.5, cy: 0.4 },
                    },
                    faceVisible: true,
                    faceCenter: {
                      start: { cx: 1.2, cy: 0.25 },
                      end: { cx: 0.5, cy: 0.25 },
                    },
                  },
                  {
                    shotId: "shot_00422",
                    mode: "action",
                    primarySubject: "runner",
                    secondarySubjects: [],
                    avoidCutting: [],
                    confidence: 0.9,
                    subjectCenter: {
                      start: { cx: 0.1, cy: 0.5 },
                      end: { cx: 0.9, cy: 0.5 },
                    },
                    faceVisible: false,
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )

    const result = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-malformed-face-center",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "provider_invalid_output",
      retryable: false,
      mastraRunId: "run-malformed-face-center",
    })
  })

  it("rejects frame URLs outside the allowlist before any provider call", async () => {
    const fetchImpl = vi.fn()

    const result = await runSmartCropPlanWorkflow(
      {
        ...baseInput,
        shots: [
          {
            shotId: "shot_00421",
            start: 0,
            end: 5,
            frameUrls: ["https://evil.example.com/frame.jpg"],
          },
        ],
      },
      {
        runId: "run-bad-host",
        apiKey: "test-key",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "frame_host_not_allowed",
      retryable: false,
      mastraRunId: "run-bad-host",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns invalid_input for malformed input without calling the provider", async () => {
    const fetchImpl = vi.fn()

    const result = await runSmartCropPlanWorkflow(
      { ...baseInput, shots: [] },
      { runId: "run-invalid", fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "smart crop plan input failed validation",
      mastraRunId: "run-invalid",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps provider transport failures onto typed reasons", async () => {
    const auth = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-auth",
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse(
          { error: "unauthorized" },
          401,
        )) as unknown as typeof fetch,
    })
    expect(auth).toMatchObject({
      ok: false,
      reason: "provider_auth_failed",
      retryable: false,
    })

    const upstream = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-upstream",
      apiKey: "test-key",
      fetchImpl: (async () =>
        jsonResponse({ error: "boom" }, 500)) as unknown as typeof fetch,
    })
    expect(upstream).toMatchObject({
      ok: false,
      reason: "provider_failed",
      retryable: false,
    })
  })

  it("preserves terminal provider rate limits from the plan boundary", async () => {
    const result = await runSmartCropPlanWorkflow(baseInput, {
      runId: "run-rate-limited",
      requestIntents: async () => {
        throw new SmartCropProviderError(
          "provider_rate_limited",
          false,
          "smart crop vision rate limited after 3 attempts (status 429)",
        )
      },
    })

    expect(result).toEqual({
      ok: false,
      reason: "provider_rate_limited",
      retryable: false,
      message: "smart crop vision rate limited after 3 attempts (status 429)",
      mastraRunId: "run-rate-limited",
    })
  })

  it("recovers the typed failure from an actual launcher failed-step result", async () => {
    const failure = {
      ok: false as const,
      reason: "provider_rate_limited" as const,
      retryable: false,
      message: "smart crop vision rate limited after 3 attempts (status 429)",
      mastraRunId: "run-launch-rate-limited",
    }
    const createRun = vi.spyOn(smartCropPlanWorkflow, "createRun")
    createRun.mockResolvedValueOnce({
      start: vi.fn(async () => ({
        status: "failed",
        input: baseInput,
        error: new Error("Workflow execution failed"),
        steps: {
          "plan-smart-crop-segments": {
            status: "failed",
            error: {
              name: "SmartCropWorkflowFailureError",
              message: `SMART_CROP_PLAN_WORKFLOW_FAILED:${JSON.stringify(failure)}`,
            },
          },
        },
      })),
    } as never)

    await expect(
      launchSmartCropPlanWorkflow(baseInput, {
        runId: "run-launch-rate-limited",
      }),
    ).resolves.toEqual(failure)
    createRun.mockRestore()
  })

  it("requires an OpenRouter key at the vision service boundary", async () => {
    await expect(
      requestShotCropIntents({
        shots: [
          {
            shotId: "shot_00001",
            start: 0,
            end: 5,
            frameUrls: ["https://image.mux.com/frame.jpg"],
          },
        ],
        source: { width: 1920, height: 1080 },
        cropMode: "auto",
        model: PLAN_MODEL,
        apiKey: undefined,
      }),
    ).rejects.toMatchObject({
      name: "SmartCropProviderError",
      reason: "provider_config_missing",
      retryable: false,
    })
  })

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSmartCropPlanRouteRequest({
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
    const outcome = await handleSmartCropPlanRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ nope: true }),
    })

    expect(outcome.status).toBe(400)
    expect(outcome.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
  })

  it("maps terminal provider rate limits to 503", async () => {
    const result: SmartCropPlanResult = {
      ok: false,
      reason: "provider_rate_limited",
      retryable: false,
      message: "smart crop vision rate limited after 3 attempts (status 429)",
      mastraRunId: "run-rate-limited",
    }
    const outcome = await handleSmartCropPlanRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => baseInput,
      launch: async () => result,
    })

    expect(outcome).toEqual({ status: 503, body: { result } })
  })

  it("launches the workflow from a valid route request", async () => {
    const result: SmartCropPlanResult = {
      ok: true,
      segments: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      model: PLAN_MODEL,
    }
    const launch = vi.fn(async () => result)

    const outcome = await handleSmartCropPlanRouteRequest({
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

  it("extracts prefixed workflow failures from wrapped run errors", () => {
    const failure = {
      ok: false as const,
      reason: "provider_failed" as const,
      retryable: true,
      message: "upstream blew up",
      mastraRunId: "run-x",
    }
    const wrapped = new Error(
      `Step failed: ${_internals.WORKFLOW_FAILURE_ERROR_PREFIX}${JSON.stringify(failure)}`,
    )

    expect(
      smartCropFailureFromUnknown(
        _internals.WORKFLOW_FAILURE_ERROR_PREFIX,
        wrapped,
      ),
    ).toEqual(failure)
  })
})
