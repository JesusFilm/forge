/**
 * Frame the 9:16 intro teaser's shots with Smart Crop (feat-173) instead of a
 * blind centre crop (owner, 2026-10-05: the local face detector is often
 * missing, and Mary sat at the frame's edge, cut away).
 *
 * Goes through the same `smart-crop-plan` workflow manager calls remotely, so
 * the contract stays the one the deployed service enforces: frames are Mux
 * thumbnails of the film's own asset (`image.mux.com`, allowlisted), up to
 * eight shots, three frames each. The vision model names each shot's subject
 * (a face, the group, the hands kneading dough) and the planner turns it into
 * a 9:16 window; the window's centre is the shot's focus.
 */
import {
  runSmartCropPlanWorkflow,
  type SmartCropPlanSegment,
} from "../../mastra/workflows/smart-crop-plan"

export type IntroShot = { startSec: number; lengthSec: number }

/**
 * Vision model for intro framing. Tried on Martha (2026-10-05) against the
 * owner-approved hand framing: the service default (Qwen 2.5 VL 72B) parked
 * three shots on one stock value and left a face at the frame edge; Gemini
 * 2.5 Flash centred every face and matched or beat the hand framing on four
 * of five shots. Passed per call, so manager's crops keep their own default.
 */
export const INTRO_SMART_CROP_MODEL = "google/gemini-2.5-flash"

/** The Mux playback id in a `stream.mux.com/<id>/...` rendition URL. */
export function muxPlaybackId(url: string): string | null {
  return /^https:\/\/stream\.mux\.com\/([A-Za-z0-9]+)\//.exec(url)?.[1] ?? null
}

/** Three moments inside a shot (20/50/80%) as Mux thumbnail URLs. */
export function shotFrameUrls(playbackId: string, shot: IntroShot): string[] {
  const at = [0.2, 0.5, 0.8].map((p) => shot.startSec + shot.lengthSec * p)
  return at.map(
    (t) =>
      `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${t.toFixed(2)}&width=640`,
  )
}

/**
 * Each shot's horizontal focus (0..1 of the source width): the centre of the
 * planned 9:16 window, averaged over its two keyframes (the intro holds one
 * framing per shot). A shot the model left out, or framed as a centre
 * fallback, keeps the centre.
 */
export function focusFromSegments(
  segments: ReadonlyArray<SmartCropPlanSegment>,
  count: number,
  sourceWidth: number,
): number[] {
  return Array.from({ length: count }, (_, k) => {
    const seg = segments.find((s) => s.shotId === `shot_${k}`)
    if (!seg || seg.mode === "center_fallback") return 0.5
    const centres = seg.cropKeyframes.map(
      (f) => (f.x + f.width / 2) / sourceWidth,
    )
    const mid = centres.reduce((a, b) => a + b, 0) / centres.length
    return Number(Math.min(1, Math.max(0, mid)).toFixed(3))
  })
}

/**
 * Focus per shot from Smart Crop, or null when it cannot run (no Mux asset,
 * no OpenRouter key, or the plan failed). Never throws: the intro then keeps
 * the centre crop, as before.
 */
export async function smartCropIntroFocus(input: {
  downloadUrl: string
  shots: ReadonlyArray<IntroShot>
  source: { width: number; height: number; durationSec: number }
  log: (m: string) => void
}): Promise<number[] | null> {
  const playbackId = muxPlaybackId(input.downloadUrl)
  if (!playbackId) {
    input.log(`smart crop: the film is not a Mux asset, intro stays centred`)
    return null
  }
  const shots = input.shots.slice(0, 8).map((s, k) => ({
    shotId: `shot_${k}`,
    start: Number(s.startSec.toFixed(2)),
    end: Number((s.startSec + Math.max(0.1, s.lengthSec)).toFixed(2)),
    frameUrls: shotFrameUrls(playbackId, s),
  }))
  try {
    const result = await runSmartCropPlanWorkflow({
      asset: { assetId: playbackId, playbackId },
      source: {
        width: input.source.width,
        height: input.source.height,
        durationSeconds: input.source.durationSec,
      },
      cropMode: "auto",
      shots,
      model: INTRO_SMART_CROP_MODEL,
    })
    if (!result.ok) {
      input.log(
        `smart crop: plan failed (${result.reason}: ${result.message}), intro stays centred`,
      )
      return null
    }
    const focus = focusFromSegments(
      result.segments,
      shots.length,
      input.source.width,
    )
    input.log(
      `smart crop (${result.model}): ` +
        result.segments
          .map((s) => `${s.shotId} ${s.mode} "${s.primarySubject}"`)
          .join("; ") +
        ` → focus ${focus.join(",")}`,
    )
    return focus
  } catch (e) {
    input.log(
      `smart crop: ${e instanceof Error ? e.message : String(e)}, intro stays centred`,
    )
    return null
  }
}
