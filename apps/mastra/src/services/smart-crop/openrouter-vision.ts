/**
 * OpenRouter vision calls for smart crop: per-shot crop intent (plan) and
 * rendered preview review (QA).
 *
 * One chat completion per call. Frames are passed as caller-provided,
 * already-allowlisted https URLs — this module never touches S3 or Mux
 * credentials. Structured outputs use `response_format: json_schema`
 * (strict) with a hand-written JSON Schema mirrored by Zod validation.
 */

import { z } from "zod"

import {
  SMART_CROP_MODES,
  type SmartCropMode,
  type SmartCropSubjectCenter,
} from "./planner"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_TIMEOUT_MS = 90_000
const OPENROUTER_REFERER = "https://mastra.jesusfilm.org"

export type SmartCropProviderFailureReason =
  | "provider_config_missing"
  | "provider_auth_failed"
  | "provider_failed"
  | "provider_invalid_output"

export class SmartCropProviderError extends Error {
  constructor(
    readonly reason: SmartCropProviderFailureReason,
    readonly retryable: boolean,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SmartCropProviderError"
  }
}

export type SmartCropTokenUsage = {
  inputTokens: number
  outputTokens: number
}

export type SmartCropPlanShot = {
  shotId: string
  start: number
  end: number
  frameUrls: readonly string[]
}

export type SmartCropPreviousSegment = {
  shotId: string
  canonicalStart: number
  canonicalEnd: number
  mode: SmartCropMode
  primarySubject: string
  secondarySubjects: string[]
  avoidCutting: string[]
  confidence: number
  cropKeyframes: Array<{
    progress: number
    x: number
    y: number
    width: number
    height: number
  }>
}

export type SmartCropRepairIssue = {
  severity: SmartCropQaIssueSeverity
  description: string
  atSeconds?: number
  shotId?: string
}

export type SmartCropRepairShot = SmartCropPlanShot & {
  previousSegment: SmartCropPreviousSegment
}

export type SmartCropShotIntent = {
  shotId: string
  mode: SmartCropMode
  primarySubject: string
  secondarySubjects: string[]
  avoidCutting: string[]
  confidence: number
  subjectCenter: SmartCropSubjectCenter
  faceVisible: boolean
  faceCenter?: SmartCropSubjectCenter | null
}

export type RequestShotCropIntentsOptions = {
  shots: readonly SmartCropPlanShot[]
  source: { width: number; height: number }
  cropMode: string
  model: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type RequestShotRepairIntentsOptions = {
  shots: readonly SmartCropRepairShot[]
  issues: readonly SmartCropRepairIssue[]
  source: { width: number; height: number }
  target: { aspectRatio: "9:16"; width: number; height: number }
  attempt: { index: number; previousPlanGeneratedAt: string }
  model: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type ShotCropIntentsResult = {
  intents: SmartCropShotIntent[]
  usage: SmartCropTokenUsage
}

const NormalizedPointSchema = z
  .object({
    cx: z.number().min(0).max(1),
    cy: z.number().min(0).max(1),
  })
  .strict()

const SubjectCenterSchema = z
  .object({
    start: NormalizedPointSchema,
    end: NormalizedPointSchema,
  })
  .strict()

const ShotIntentSchema = z
  .object({
    shotId: z.string().min(1),
    mode: z.enum(SMART_CROP_MODES),
    primarySubject: z.string(),
    secondarySubjects: z.array(z.string()),
    avoidCutting: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    subjectCenter: SubjectCenterSchema,
    faceVisible: z.boolean(),
    faceCenter: SubjectCenterSchema.nullable().optional(),
  })
  .strict()
  .superRefine((intent, ctx) => {
    if (intent.faceVisible && intent.faceCenter == null) {
      ctx.addIssue({
        code: "custom",
        message: "faceCenter is required when faceVisible is true",
        path: ["faceCenter"],
      })
    }
  })

const ShotIntentsResponseSchema = z
  .object({
    shots: z.array(ShotIntentSchema),
  })
  .strict()

export const SMART_CROP_QA_VERDICTS = ["pass", "needs_repair", "fail"] as const
export type SmartCropQaVerdict = (typeof SMART_CROP_QA_VERDICTS)[number]

export const SMART_CROP_QA_ISSUE_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const
export type SmartCropQaIssueSeverity =
  (typeof SMART_CROP_QA_ISSUE_SEVERITIES)[number]

export type SmartCropQaIssue = {
  severity: SmartCropQaIssueSeverity
  description: string
  atSeconds?: number
  shotId?: string
}

export type SmartCropQaFrame = {
  atSeconds: number
  url: string
  shotId?: string
}

export type RequestRenderQaReviewOptions = {
  frames: readonly SmartCropQaFrame[]
  planSummary: { segmentCount: number; modes: Record<string, number> }
  renderMode: "preview" | "full"
  model: string
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type RenderQaReviewResult = {
  verdict: SmartCropQaVerdict
  issues: SmartCropQaIssue[]
  usage: SmartCropTokenUsage
}

const QaIssueResponseSchema = z
  .object({
    severity: z.enum(SMART_CROP_QA_ISSUE_SEVERITIES),
    description: z.string().min(1),
    atSeconds: z.number().nullable(),
    shotId: z.string().nullable(),
  })
  .strict()

const QaResponseSchema = z
  .object({
    verdict: z.enum(SMART_CROP_QA_VERDICTS),
    issues: z.array(QaIssueResponseSchema),
  })
  .strict()

const NORMALIZED_POINT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cx: { type: "number", minimum: 0, maximum: 1 },
    cy: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["cx", "cy"],
} as const

const SUBJECT_CENTER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    start: NORMALIZED_POINT_JSON_SCHEMA,
    end: NORMALIZED_POINT_JSON_SCHEMA,
  },
  required: ["start", "end"],
} as const

const SHOT_INTENTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          shotId: { type: "string" },
          mode: { type: "string", enum: [...SMART_CROP_MODES] },
          primarySubject: { type: "string" },
          secondarySubjects: { type: "array", items: { type: "string" } },
          avoidCutting: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          subjectCenter: SUBJECT_CENTER_JSON_SCHEMA,
          faceVisible: { type: "boolean" },
          faceCenter: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              start: NORMALIZED_POINT_JSON_SCHEMA,
              end: NORMALIZED_POINT_JSON_SCHEMA,
            },
            required: ["start", "end"],
          },
        },
        required: [
          "shotId",
          "mode",
          "primarySubject",
          "secondarySubjects",
          "avoidCutting",
          "confidence",
          "subjectCenter",
          "faceVisible",
          "faceCenter",
        ],
      },
    },
  },
  required: ["shots"],
} as const

const QA_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: [...SMART_CROP_QA_VERDICTS] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: {
            type: "string",
            enum: [...SMART_CROP_QA_ISSUE_SEVERITIES],
          },
          description: { type: "string", minLength: 1 },
          atSeconds: { type: ["number", "null"] },
          shotId: { type: ["string", "null"] },
        },
        required: ["severity", "description", "atSeconds", "shotId"],
      },
    },
  },
  required: ["verdict", "issues"],
} as const

type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

function extractUsage(payload: unknown): SmartCropTokenUsage {
  const usage =
    payload != null && typeof payload === "object"
      ? (payload as { usage?: unknown }).usage
      : undefined
  const record =
    usage != null && typeof usage === "object"
      ? (usage as Record<string, unknown>)
      : {}
  const inputTokens =
    typeof record.prompt_tokens === "number" ? record.prompt_tokens : 0
  const outputTokens =
    typeof record.completion_tokens === "number" ? record.completion_tokens : 0
  return { inputTokens, outputTokens }
}

function extractMessageContent(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null
  const choices = (payload as Record<string, unknown>).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as Record<string, unknown>).message
  if (message == null || typeof message !== "object") return null
  const content = (message as Record<string, unknown>).content
  return typeof content === "string" ? content : null
}

async function postChatCompletion({
  apiKey,
  title,
  body,
  fetchImpl,
  timeoutMs,
}: {
  apiKey?: string
  title: string
  body: unknown
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<{ content: string; usage: SmartCropTokenUsage }> {
  if (!apiKey) {
    throw new SmartCropProviderError(
      "provider_config_missing",
      false,
      "OPENROUTER_API_KEY is required for smart crop vision calls",
    )
  }

  const resolvedTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-OpenRouter-Title": title,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(resolvedTimeoutMs),
    })
  } catch (cause) {
    throw new SmartCropProviderError(
      "provider_failed",
      true,
      cause instanceof Error ? cause.message : String(cause),
      cause,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new SmartCropProviderError(
      "provider_auth_failed",
      false,
      `smart crop vision call rejected with status ${response.status}`,
    )
  }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new SmartCropProviderError(
      "provider_failed",
      retryable,
      `smart crop vision call failed with status ${response.status}`,
    )
  }

  const payload = await response.json().catch((cause) => {
    throw new SmartCropProviderError(
      "provider_invalid_output",
      false,
      "smart crop vision response was not valid JSON",
      cause,
    )
  })
  const content = extractMessageContent(payload)
  if (content == null) {
    throw new SmartCropProviderError(
      "provider_invalid_output",
      false,
      "smart crop vision response did not include text output",
    )
  }

  return { content, usage: extractUsage(payload) }
}

function parseStructuredContent<T>(
  content: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(content)
  } catch (cause) {
    throw new SmartCropProviderError(
      "provider_invalid_output",
      false,
      `${context} response text was not valid JSON`,
      cause,
    )
  }
  const parsed = schema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new SmartCropProviderError(
      "provider_invalid_output",
      false,
      `${context} response failed schema validation`,
      parsed.error,
    )
  }
  return parsed.data
}

function buildPlanInstruction(cropMode: string): string {
  const modeInstruction =
    cropMode === "auto"
      ? "Choose the best mode for each shot."
      : `The requested crop mode is "${cropMode}"; honor it for every shot unless the shot clearly cannot support it.`
  return [
    "You plan 9:16 vertical crops for widescreen video shots.",
    "For EACH shot below, decide:",
    `- mode: one of ${SMART_CROP_MODES.join(" | ")}. ${modeInstruction}`,
    "- primarySubject: short string naming the main subject to keep in frame.",
    "- secondarySubjects: array of short strings for other notable subjects.",
    "- avoidCutting: array of elements the crop must not cut (faces, on-screen text, ...).",
    "- confidence: 0..1 for how certain you are about the subject placement.",
    "- subjectCenter: start and end position of the primary subject/body as NORMALIZED cx, cy in [0,1] (cx from left, cy from top). Only horizontal panning matters for the crop, but cy is still required.",
    "- faceVisible: true when the primary human subject's face/head is visible in the shot frames; otherwise false.",
    "- faceCenter: start and end NORMALIZED cx, cy of the visible face/head when faceVisible is true; otherwise null. Do not use the torso/body center as faceCenter.",
    "Use the shot's frames in order (start to end). Return JSON only.",
  ].join("\n")
}

function buildRepairInstruction(): string {
  return [
    "You repair 9:16 vertical crop decisions for ONLY the selected video shots.",
    "Use each shot's previousSegment as the baseline and address the bounded QA issues.",
    "Return one replacement crop intent for every requested shotId and no other shotIds.",
    "Do not change shot timing. Do not mention credentials, URLs, or implementation details.",
    `For each shot, return mode as one of ${SMART_CROP_MODES.join(" | ")}.`,
    "- primarySubject: short string naming the main subject to keep in frame.",
    "- secondarySubjects: array of short strings for other notable subjects.",
    "- avoidCutting: array of elements the crop must not cut (faces, on-screen text, ...).",
    "- confidence: 0..1 for how certain you are about the repaired subject placement.",
    "- subjectCenter: repaired start/end position of the primary subject/body as NORMALIZED cx, cy in [0,1] (cx from left, cy from top).",
    "- faceVisible: true when the primary human subject's face/head is visible in the shot frames; otherwise false.",
    "- faceCenter: repaired start/end NORMALIZED cx, cy of the visible face/head when faceVisible is true; otherwise null. Do not use the torso/body center as faceCenter.",
    "Return JSON only.",
  ].join("\n")
}

function validateShotIntents(
  intents: readonly SmartCropShotIntent[],
  expectedShotIds: readonly string[],
  context: string,
): SmartCropShotIntent[] {
  const intentsByShotId = new Map<string, SmartCropShotIntent>()
  for (const intent of intents) {
    if (intentsByShotId.has(intent.shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `${context} response repeated shotId ${intent.shotId}`,
      )
    }
    intentsByShotId.set(intent.shotId, intent)
  }

  const expected = new Set(expectedShotIds)
  for (const shotId of expectedShotIds) {
    if (!intentsByShotId.has(shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `${context} response is missing shotId ${shotId}`,
      )
    }
  }
  for (const shotId of intentsByShotId.keys()) {
    if (!expected.has(shotId)) {
      throw new SmartCropProviderError(
        "provider_invalid_output",
        false,
        `${context} response includes unknown shotId ${shotId}`,
      )
    }
  }

  return expectedShotIds.map((shotId) => intentsByShotId.get(shotId)!)
}

/**
 * One chat completion covering ALL provided shots (callers batch <= 8 shots,
 * <= 3 frame URLs each). Every input shotId must appear exactly once in the
 * structured response or the call fails with `provider_invalid_output`.
 */
export async function requestShotCropIntents({
  shots,
  source,
  cropMode,
  model,
  apiKey,
  fetchImpl,
  timeoutMs,
}: RequestShotCropIntentsOptions): Promise<ShotCropIntentsResult> {
  const content: UserContentPart[] = [
    {
      type: "text",
      text: `${buildPlanInstruction(cropMode)}\nSource video is ${source.width}x${source.height} pixels.`,
    },
  ]
  for (const shot of shots) {
    content.push({
      type: "text",
      text: `shotId ${shot.shotId} (${shot.start}s-${shot.end}s):`,
    })
    for (const frameUrl of shot.frameUrls) {
      content.push({ type: "image_url", image_url: { url: frameUrl } })
    }
  }

  const { content: responseText, usage } = await postChatCompletion({
    apiKey,
    title: "Forge Mastra Smart Crop Plan",
    fetchImpl,
    timeoutMs,
    body: {
      model,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "smart_crop_shot_intents",
          strict: true,
          schema: SHOT_INTENTS_JSON_SCHEMA,
        },
      },
      max_tokens: 4000,
      temperature: 0,
    },
  })

  const parsed = parseStructuredContent(
    responseText,
    ShotIntentsResponseSchema,
    "smart crop plan",
  )

  return {
    intents: validateShotIntents(
      parsed.shots,
      shots.map((shot) => shot.shotId),
      "smart crop plan",
    ),
    usage,
  }
}

/**
 * One chat completion repairing only selected shots. The model sees selected
 * frames, bounded QA issues, and previous segment metadata; output remains
 * untrusted until exact shot-id validation and deterministic planning.
 */
export async function requestShotRepairIntents({
  shots,
  issues,
  source,
  target,
  attempt,
  model,
  apiKey,
  fetchImpl,
  timeoutMs,
}: RequestShotRepairIntentsOptions): Promise<ShotCropIntentsResult> {
  const content: UserContentPart[] = [
    {
      type: "text",
      text: [
        buildRepairInstruction(),
        `Source video is ${source.width}x${source.height} pixels.`,
        `Target crop is ${target.aspectRatio} at ${target.width}x${target.height}.`,
        `Repair attempt index: ${attempt.index}. Previous plan generated at: ${attempt.previousPlanGeneratedAt}.`,
        `QA issues: ${JSON.stringify(issues)}`,
      ].join("\n"),
    },
  ]

  for (const shot of shots) {
    content.push({
      type: "text",
      text: [
        `shotId ${shot.shotId} (${shot.start}s-${shot.end}s):`,
        `previousSegment: ${JSON.stringify(shot.previousSegment)}`,
      ].join("\n"),
    })
    for (const frameUrl of shot.frameUrls) {
      content.push({ type: "image_url", image_url: { url: frameUrl } })
    }
  }

  const { content: responseText, usage } = await postChatCompletion({
    apiKey,
    title: "Forge Mastra Smart Crop Repair",
    fetchImpl,
    timeoutMs,
    body: {
      model,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "smart_crop_repair_intents",
          strict: true,
          schema: SHOT_INTENTS_JSON_SCHEMA,
        },
      },
      max_tokens: 4000,
      temperature: 0,
    },
  })

  const parsed = parseStructuredContent(
    responseText,
    ShotIntentsResponseSchema,
    "smart crop repair",
  )

  return {
    intents: validateShotIntents(
      parsed.shots,
      shots.map((shot) => shot.shotId),
      "smart crop repair",
    ),
    usage,
  }
}

/**
 * One chat completion reviewing rendered preview frames against the plan
 * summary, returning a verdict plus structured issues.
 */
export async function requestRenderQaReview({
  frames,
  planSummary,
  renderMode,
  model,
  apiKey,
  fetchImpl,
  timeoutMs,
}: RequestRenderQaReviewOptions): Promise<RenderQaReviewResult> {
  const instruction = [
    `You review ${renderMode} frames rendered from a 9:16 smart-crop plan.`,
    'Decide a verdict: "pass" (subjects well framed), "needs_repair" (fixable framing problems), or "fail" (subjects or critical content cut off, unusable framing).',
    'List issues with severity "info" | "warning" | "critical" and a short description.',
    "When you can tie an issue to a frame time or shot, set atSeconds and/or shotId; otherwise use null.",
    `Plan summary: ${JSON.stringify(planSummary)}`,
    "Return JSON only.",
  ].join("\n")

  const content: UserContentPart[] = [{ type: "text", text: instruction }]
  for (const frame of frames) {
    const shotIdLabel = frame.shotId ? ` (shotId ${frame.shotId})` : ""
    content.push({
      type: "text",
      text: `frame at ${frame.atSeconds}s${shotIdLabel}:`,
    })
    content.push({ type: "image_url", image_url: { url: frame.url } })
  }

  const { content: responseText, usage } = await postChatCompletion({
    apiKey,
    title: "Forge Mastra Smart Crop QA",
    fetchImpl,
    timeoutMs,
    body: {
      model,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "smart_crop_qa_review",
          strict: true,
          schema: QA_REVIEW_JSON_SCHEMA,
        },
      },
      max_tokens: 2000,
      temperature: 0,
    },
  })

  const parsed = parseStructuredContent(
    responseText,
    QaResponseSchema,
    "smart crop qa",
  )

  return {
    verdict: parsed.verdict,
    issues: parsed.issues.map((issue) => ({
      severity: issue.severity,
      description: issue.description,
      ...(issue.atSeconds == null ? {} : { atSeconds: issue.atSeconds }),
      ...(issue.shotId == null ? {} : { shotId: issue.shotId }),
    })),
    usage,
  }
}

export const _internals = {
  buildPlanInstruction,
  buildRepairInstruction,
  extractUsage,
  extractMessageContent,
  SHOT_INTENTS_JSON_SCHEMA,
  QA_REVIEW_JSON_SCHEMA,
}
