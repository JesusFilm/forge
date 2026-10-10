/**
 * Deterministic smart-crop planner (`smart-crop-planner-v1`).
 *
 * Pure functions only: vision-LLM crop intents in, crop keyframes out.
 * No I/O, no env reads — keep this module trivially property-testable.
 */

export const SMART_CROP_PLANNER_VERSION = "smart-crop-planner-v1"

export const SMART_CROP_MODES = [
  "speaker",
  "group",
  "object",
  "slide_aware",
  "action",
  "center_fallback",
] as const

export type SmartCropMode = (typeof SMART_CROP_MODES)[number]

export type SmartCropSourceDimensions = {
  width: number
  height: number
}

export type SmartCropWindow = {
  width: number
  height: number
  y: 0
}

export type SmartCropKeyframe = {
  progress: number
  x: number
  y: number
  width: number
  height: number
}

export type SmartCropSubjectCenter = {
  start: { cx: number; cy: number }
  end: { cx: number; cy: number }
}

export type SmartCropPlannerIntent = {
  mode: SmartCropMode
  confidence: number
  subjectCenter: SmartCropSubjectCenter
  faceVisible?: boolean
  faceCenter?: SmartCropSubjectCenter | null
}

export type SmartCropPlannedKeyframes = {
  mode: SmartCropMode
  cropKeyframes: [SmartCropKeyframe, SmartCropKeyframe]
}

/** Maximum horizontal pan speed in pixels/second at 1920px source width. */
const MAX_PAN_PX_PER_SECOND_AT_1920 = 240
/** Pan deltas below this fraction of the crop width collapse to static. */
const DEAD_ZONE_CROP_WIDTH_FRACTION = 0.08
/** Intents below this confidence fall back to a static centered crop. */
const CENTER_FALLBACK_CONFIDENCE_THRESHOLD = 0.5

function floorEven(value: number): number {
  return 2 * Math.floor(value / 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 9:16 crop window for a horizontal-only MVP pan: full source height,
 * largest even width that fits both `height * 9/16` and the source width.
 */
export function computeCropWindow(
  source: SmartCropSourceDimensions,
): SmartCropWindow {
  const width = floorEven(Math.min((source.height * 9) / 16, source.width))
  return { width, height: source.height, y: 0 }
}

function xForSubjectCenter(
  cx: number,
  source: SmartCropSourceDimensions,
  cropWidth: number,
): number {
  const maxX = Math.max(0, source.width - cropWidth)
  return floorEven(
    clamp(Math.round(cx * source.width - cropWidth / 2), 0, maxX),
  )
}

function staticKeyframes(
  x: number,
  window: SmartCropWindow,
): [SmartCropKeyframe, SmartCropKeyframe] {
  return [
    { progress: 0, x, y: 0, width: window.width, height: window.height },
    { progress: 1, x, y: 0, width: window.width, height: window.height },
  ]
}

function cropAnchorCenter(
  intent: SmartCropPlannerIntent,
): SmartCropSubjectCenter {
  return intent.faceVisible === true && intent.faceCenter
    ? intent.faceCenter
    : intent.subjectCenter
}

/**
 * Convert one shot's crop intent into exactly two crop keyframes.
 *
 * Rules, applied in order:
 * (a) confidence < 0.5 or mode `center_fallback` → static centered crop,
 *     reported mode `center_fallback`.
 * (b) dead zone: pans below 8% of the crop width collapse to static.
 * (c) max pan speed: 240 px/s scaled by `source.width / 1920`; faster pans
 *     are shortened to the even-floored maximum displacement.
 * (d) `slide_aware` in MVP → static centered crop (full text safety), mode
 *     stays `slide_aware` in the plan segment.
 */
export function intentToKeyframes(
  intent: SmartCropPlannerIntent,
  shot: { start: number; end: number },
  source: SmartCropSourceDimensions,
): SmartCropPlannedKeyframes {
  const window = computeCropWindow(source)
  const centeredX = xForSubjectCenter(0.5, source, window.width)

  if (
    intent.confidence < CENTER_FALLBACK_CONFIDENCE_THRESHOLD ||
    intent.mode === "center_fallback"
  ) {
    return {
      mode: "center_fallback",
      cropKeyframes: staticKeyframes(centeredX, window),
    }
  }

  const anchorCenter = cropAnchorCenter(intent)
  const x0 = xForSubjectCenter(anchorCenter.start.cx, source, window.width)
  let x1 = xForSubjectCenter(anchorCenter.end.cx, source, window.width)

  if (Math.abs(x1 - x0) < DEAD_ZONE_CROP_WIDTH_FRACTION * window.width) {
    x1 = x0
  }

  const shotDuration = shot.end - shot.start
  const maxPanPxPerSecond =
    MAX_PAN_PX_PER_SECOND_AT_1920 * (source.width / 1920)
  if (Math.abs(x1 - x0) / shotDuration > maxPanPxPerSecond) {
    x1 = x0 + Math.sign(x1 - x0) * floorEven(maxPanPxPerSecond * shotDuration)
  }

  if (intent.mode === "slide_aware") {
    return {
      mode: "slide_aware",
      cropKeyframes: staticKeyframes(centeredX, window),
    }
  }

  return {
    mode: intent.mode,
    cropKeyframes: [
      { progress: 0, x: x0, y: 0, width: window.width, height: window.height },
      { progress: 1, x: x1, y: 0, width: window.width, height: window.height },
    ],
  }
}
