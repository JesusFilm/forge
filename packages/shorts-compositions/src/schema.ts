// Pure zod schemas + constants. This module is imported by manager
// server/workflow code via the "./schema" subpath export — it must stay free
// of React/Remotion imports (guarded by module-graph.test.ts).
import { z } from "zod"

export const SHORT_COMPOSITION_ID = "short"
export const SHORT_WIDTH = 1080
export const SHORT_HEIGHT = 1920
export const SHORT_FPS = 30

// Cross-platform safe area on the 1080x1920 canvas: captions/title/waveform
// must stay >= these insets away from the respective edge (plan decision 14).
export const SHORT_SAFE_AREA = {
  top: 130,
  bottom: 320,
  side: 60,
} as const

// Clip duration guardrails enforced at job creation (plan: 5–180s).
export const SHORT_CLIP_DURATION = {
  minSec: 5,
  maxSec: 180,
} as const

export const captionTokenSchema = z.object({
  text: z.string(),
  fromMs: z.number(),
  toMs: z.number(),
})

export const captionPageSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  durationMs: z.number(),
  tokens: z.array(captionTokenSchema),
})

const accentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a 6-digit hex color")

// Operator-editable draft fields ONLY. Server-injected render fields
// (clipUrl, fps, clipDurationSec, hasAudio) are deliberately absent — the
// draft API route validates against this schema so a request body can never
// smuggle them in (plan decision 15). Strict: unknown keys are rejected.
const draftShape = {
  templateId: z.enum(["focus", "frame"]),
  accentColor: accentColorSchema,
  captionPosition: z.enum(["center", "lower"]),
  captionFont: z.enum(["montserrat", "inter"]),
  waveformStyle: z.enum(["bars", "none"]),
  title: z.string().max(80).optional(),
  showCaptions: z.boolean(),
  captionPages: z.array(captionPageSchema),
}

export const draftSchema = z.strictObject(draftShape)

// Scheme-pinned clip URL: https anywhere, or the worker's loopback static
// server (http://127.0.0.1:{port}/...). Never a bare z.string().url() —
// javascript:, data:, file: and host-suffix spoofs must all fail.
const isAllowedClipUrl = (value: string): boolean => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol === "https:") return true
  return (
    parsed.protocol === "http:" &&
    parsed.hostname === "127.0.0.1" &&
    parsed.port !== ""
  )
}

const clipUrlSchema = z
  .string()
  .refine(
    isAllowedClipUrl,
    "clipUrl must be https:// or http://127.0.0.1:{port}/",
  )

// Full composition input props = operator draft + server-injected fields,
// assembled at compose time (manager for preview, worker for render).
export const shortInputPropsSchema = z.object({
  ...draftShape,
  clipUrl: clipUrlSchema,
  fps: z.number().int(),
  clipDurationSec: z.number().positive(),
  hasAudio: z.boolean(),
})

export type CaptionToken = z.infer<typeof captionTokenSchema>
export type CaptionPage = z.infer<typeof captionPageSchema>
export type ShortDraft = z.infer<typeof draftSchema>
export type ShortInputProps = z.infer<typeof shortInputPropsSchema>
export type ShortTemplateId = ShortDraft["templateId"]
export type ShortCaptionFont = ShortDraft["captionFont"]
export type ShortCaptionPosition = ShortDraft["captionPosition"]
export type ShortWaveformStyle = ShortDraft["waveformStyle"]
