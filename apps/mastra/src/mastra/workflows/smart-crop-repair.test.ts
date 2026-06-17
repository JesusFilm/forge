import { describe, expect, it, vi } from "vitest"

import { smartCropFailureFromUnknown } from "../../services/smart-crop/workflow-failure"
import {
  _internals,
  handleSmartCropRepairRouteRequest,
  runSmartCropRepairWorkflow,
  type SmartCropRepairResult,
} from "./smart-crop-repair"

const REPAIR_MODEL = "qwen/qwen2.5-vl-72b-instruct"

const previousSegment = {
  shotId: "shot_00421",
  canonicalStart: 120,
  canonicalEnd: 136,
  mode: "speaker",
  primarySubject: "Jesus",
  secondarySubjects: ["disciples"],
  avoidCutting: ["faces"],
  confidence: 0.7,
  cropKeyframes: [
    { progress: 0, x: 656, y: 0, width: 606, height: 1080 },
    { progress: 1, x: 656, y: 0, width: 606, height: 1080 },
  ],
} as const

const secondPreviousSegment = {
  shotId: "shot_00422",
  canonicalStart: 136,
  canonicalEnd: 141,
  mode: "group",
  primarySubject: "disciples",
  secondarySubjects: ["Jesus"],
  avoidCutting: ["faces"],
  confidence: 0.74,
  cropKeyframes: [
    { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
    { progress: 1, x: 540, y: 0, width: 606, height: 1080 },
  ],
} as const

const baseInput = {
  asset: { assetId: "asset123", playbackId: "pb_abc" },
  source: { width: 1920, height: 1080, durationSeconds: 7200 },
  target: { aspectRatio: "9:16", width: 1080, height: 1920 },
  attempt: {
    index: 1,
    previousPlanGeneratedAt: "2026-06-16T00:00:00.000Z",
  },
  issues: [
    {
      severity: "warning",
      description: "Subject drifts too far left in the repaired preview",
      atSeconds: 130,
      shotId: "shot_00421",
    },
  ],
  shots: [
    {
      shotId: "shot_00421",
      start: 124.2,
      end: 139.8,
      previousSegment,
      frameUrls: [
        "https://image.mux.com/pb_abc/thumbnail.jpg?time=125",
        "https://image.mux.com/pb_abc/thumbnail.jpg?time=132",
      ],
    },
    {
      shotId: "shot_00422",
      start: 139.8,
      end: 141.8,
      previousSegment: secondPreviousSegment,
      frameUrls: ["https://image.mux.com/pb_abc/thumbnail.jpg?time=140"],
    },
  ],
  model: REPAIR_MODEL,
} as const

const cannedRepairResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          shots: [
            {
              shotId: "shot_00422",
              mode: "center_fallback",
              primarySubject: "disciples",
              secondarySubjects: ["Jesus"],
              avoidCutting: ["faces"],
              confidence: 0.45,
              subjectCenter: {
                start: { cx: 0.52, cy: 0.5 },
                end: { cx: 0.52, cy: 0.5 },
              },
              faceVisible: false,
            },
            {
              shotId: "shot_00421",
              mode: "speaker",
              primarySubject: "Jesus",
              secondarySubjects: ["disciples"],
              avoidCutting: ["faces", "hands"],
              confidence: 0.92,
              subjectCenter: {
                start: { cx: 0.45, cy: 0.45 },
                end: { cx: 0.4, cy: 0.45 },
              },
              faceVisible: true,
              faceCenter: {
                start: { cx: 0.7, cy: 0.24 },
                end: { cx: 0.8, cy: 0.24 },
              },
            },
          ],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 678, completion_tokens: 42 },
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function intent(shotId: string) {
  return {
    shotId,
    mode: "speaker" as const,
    primarySubject: "Jesus",
    secondarySubjects: [],
    avoidCutting: ["faces"],
    confidence: 0.9,
    subjectCenter: {
      start: { cx: 0.5, cy: 0.5 },
      end: { cx: 0.5, cy: 0.5 },
    },
    faceVisible: true,
    faceCenter: {
      start: { cx: 0.5, cy: 0.25 },
      end: { cx: 0.5, cy: 0.25 },
    },
  }
}

describe("smart crop repair workflow", () => {
  it("repairs selected shots from a canned OpenRouter response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(cannedRepairResponse))

    const result = await runSmartCropRepairWorkflow(baseInput, {
      runId: "run-repair",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: true,
      segments: [
        {
          shotId: "shot_00421",
          canonicalStart: 120,
          canonicalEnd: 136,
          mode: "speaker",
          primarySubject: "Jesus",
          secondarySubjects: ["disciples"],
          avoidCutting: ["faces", "hands"],
          confidence: 0.92,
          faceVisible: true,
          faceCenter: {
            start: { cx: 0.7, cy: 0.24 },
            end: { cx: 0.8, cy: 0.24 },
          },
          cropKeyframes: [
            { progress: 0, x: 1040, y: 0, width: 606, height: 1080 },
            { progress: 1, x: 1232, y: 0, width: 606, height: 1080 },
          ],
        },
        {
          shotId: "shot_00422",
          canonicalStart: 136,
          canonicalEnd: 141,
          mode: "center_fallback",
          primarySubject: "disciples",
          secondarySubjects: ["Jesus"],
          avoidCutting: ["faces"],
          confidence: 0.45,
          faceVisible: false,
          cropKeyframes: [
            { progress: 0, x: 656, y: 0, width: 606, height: 1080 },
            { progress: 1, x: 656, y: 0, width: 606, height: 1080 },
          ],
        },
      ],
      usage: { inputTokens: 678, outputTokens: 42 },
      model: REPAIR_MODEL,
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
    expect((init.headers as Record<string, string>)["X-OpenRouter-Title"]).toBe(
      "Forge Mastra Smart Crop Repair",
    )

    const body = JSON.parse(String(init.body)) as {
      model: string
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
      response_format: { type: string; json_schema: { strict: boolean } }
    }
    expect(body.model).toBe(REPAIR_MODEL)
    expect(body.response_format.type).toBe("json_schema")
    expect(body.response_format.json_schema.strict).toBe(true)
    const text = body.messages[0]!.content.filter(
      (part) => part.type === "text",
    )
      .map((part) => String(part.text))
      .join("\n")
    expect(text).toContain("Return one replacement crop intent")
    expect(text).toContain("faceCenter")
    expect(text).toContain("Subject drifts too far left")
    expect(text).toContain("previousSegment:")
    const imageParts = body.messages[0]!.content.filter(
      (part) => part.type === "image_url",
    )
    expect(imageParts).toHaveLength(3)
  })

  it("rejects invalid issue and shot payloads before any provider call", async () => {
    const requestRepairIntents = vi.fn()

    const result = await runSmartCropRepairWorkflow(
      {
        ...baseInput,
        issues: [
          {
            severity: "warning",
            description: "Linked to a shot that was not requested",
            shotId: "shot_missing",
          },
        ],
      },
      {
        runId: "run-invalid-repair",
        requestRepairIntents,
      },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "smart crop repair input failed validation",
      mastraRunId: "run-invalid-repair",
    })
    expect(requestRepairIntents).not.toHaveBeenCalled()
  })

  it("rejects frame URLs outside the allowlist before any provider call", async () => {
    const requestRepairIntents = vi.fn()

    const result = await runSmartCropRepairWorkflow(
      {
        ...baseInput,
        shots: [
          {
            ...baseInput.shots[0],
            frameUrls: ["https://evil.example.com/frame.jpg"],
          },
        ],
      },
      {
        runId: "run-repair-bad-host",
        requestRepairIntents,
      },
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "frame_host_not_allowed",
      retryable: false,
      mastraRunId: "run-repair-bad-host",
    })
    expect(requestRepairIntents).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", [intent("shot_00421")]],
    ["unknown", [intent("shot_00421"), intent("shot_00422"), intent("extra")]],
    ["duplicate", [intent("shot_00421"), intent("shot_00421")]],
  ])(
    "fails with provider_invalid_output when provider output has %s shot ids",
    async (_caseName, intents) => {
      const result = await runSmartCropRepairWorkflow(baseInput, {
        runId: `run-repair-${_caseName}`,
        requestRepairIntents: async () => ({
          intents,
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      })

      expect(result).toMatchObject({
        ok: false,
        reason: "provider_invalid_output",
        retryable: false,
        mastraRunId: `run-repair-${_caseName}`,
      })
    },
  )

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSmartCropRepairRouteRequest({
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
    const outcome = await handleSmartCropRepairRouteRequest({
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
    const result: SmartCropRepairResult = {
      ok: true,
      segments: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      model: REPAIR_MODEL,
    }
    const launch = vi.fn(async () => result)

    const outcome = await handleSmartCropRepairRouteRequest({
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

    expect(_internals.WORKFLOW_FAILURE_ERROR_PREFIX).toBe(
      "SMART_CROP_REPAIR_WORKFLOW_FAILED:",
    )
    expect(
      smartCropFailureFromUnknown(
        _internals.WORKFLOW_FAILURE_ERROR_PREFIX,
        wrapped,
      ),
    ).toEqual(failure)
  })
})
