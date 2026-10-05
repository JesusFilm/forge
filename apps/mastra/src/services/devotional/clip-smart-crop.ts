/**
 * Follow the subject through a short's film clip with Smart Crop (feat-173)
 * when the local face detector is missing (owner, 2026-10-05: the film-verse
 * short was centre-cropped, faces at the edge).
 *
 * The clip is cut into its shots (ffmpeg's scene metric), each shot sends
 * three frames to the smart-crop vision call, and the deterministic
 * `smart-crop-planner-v1` turns each answer into a 9:16 window that may pan
 * slowly within the shot. The result is the `clipFocus` path the composition
 * already reads: the window's centre at each shot's start and end, jumping at
 * the cuts. A short's clip is a trimmed local file with no Mux asset behind
 * it, so the frames travel inline (base64) rather than as allowlisted URLs;
 * the vision call and the planner are the same code the workflow runs.
 */
import { spawn } from "node:child_process"

import { env } from "../../config/env"
import { requestShotCropIntents } from "../smart-crop/openrouter-vision"
import { intentToKeyframes } from "../smart-crop/planner"

import type { FocusPoint } from "./clip-focus"
import { detectShotCuts } from "./face-crop-anchors"
import { INTRO_SMART_CROP_MODEL } from "./intro-smart-crop"

export type ClipShot = { start: number; end: number }

/** Shots between cuts; a sliver under `minSec` joins the shot before it. */
export function shotsFromCuts(
  cuts: ReadonlyArray<number>,
  durationSec: number,
  minSec = 0.6,
): ClipShot[] {
  const edges = [
    0,
    ...cuts.filter((c) => c > 0 && c < durationSec),
    durationSec,
  ]
  const shots: ClipShot[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const shot = { start: edges[i], end: edges[i + 1] }
    const prev = shots.at(-1)
    if (prev && shot.end - shot.start < minSec) prev.end = shot.end
    else shots.push(shot)
  }
  return shots
}

/**
 * The focus path from each shot's two planned keyframes (x of a window of
 * `width` px, at the shot's start and end). A shot with no plan holds the
 * centre. The last point of a shot sits one frame before the next shot's
 * first, so the crop jumps on the cut instead of sliding across it.
 */
export function pathFromKeyframes(
  shots: ReadonlyArray<ClipShot>,
  plans: ReadonlyArray<ReadonlyArray<{ x: number; width: number }> | null>,
  sourceWidth: number,
  frameSec = 1 / 30,
): FocusPoint[] {
  const centre = (k: { x: number; width: number }) =>
    Number(
      Math.min(1, Math.max(0, (k.x + k.width / 2) / sourceWidth)).toFixed(4),
    )
  const out: FocusPoint[] = []
  shots.forEach((s, i) => {
    const kf = plans[i]
    const a = kf?.[0] ? centre(kf[0]) : 0.5
    const b = kf?.[1] ? centre(kf[1]) : a
    out.push({ atSec: Number(s.start.toFixed(3)), x: a })
    const endAt = Math.max(s.start, s.end - frameSec)
    out.push({ atSec: Number(endAt.toFixed(3)), x: b })
  })
  return out
}

function frameDataUrl(file: string, atSec: number): Promise<string | null> {
  return new Promise((resolve) => {
    const c = spawn("ffmpeg", [
      "-v",
      "error",
      "-ss",
      atSec.toFixed(3),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-f",
      "image2",
      "-c:v",
      "mjpeg",
      "-q:v",
      "4",
      "pipe:1",
    ])
    const chunks: Buffer[] = []
    c.stdout.on("data", (d: Buffer) => chunks.push(d))
    c.on("error", () => resolve(null))
    c.on("close", (code) =>
      resolve(
        code === 0 && chunks.length
          ? `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`
          : null,
      ),
    )
  })
}

function probe(
  file: string,
): Promise<{ width: number; height: number; durationSec: number } | null> {
  return new Promise((resolve) => {
    const c = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "default=nw=1",
      file,
    ])
    let out = ""
    c.stdout.on("data", (d) => (out += String(d)))
    c.on("error", () => resolve(null))
    c.on("close", () => {
      const get = (k: string) =>
        Number(new RegExp(`${k}=([\\d.]+)`).exec(out)?.[1])
      const width = get("width")
      const height = get("height")
      const durationSec = get("duration")
      resolve(
        width && height && durationSec ? { width, height, durationSec } : null,
      )
    })
  })
}

/**
 * The `clipFocus` path for a clip, or null when Smart Crop cannot run (no
 * OpenRouter key, unreadable clip, or the call failed). Never throws: the
 * clip then stays centre-cropped, as before.
 */
export async function smartCropClipPath(input: {
  clipFile: string
  log: (m: string) => void
}): Promise<FocusPoint[] | null> {
  const apiKey = env.OPENROUTER_API_KEY
  if (!apiKey) {
    input.log("clip smart crop: no OpenRouter key, the clip stays centred")
    return null
  }
  const dims = await probe(input.clipFile)
  if (!dims) return null
  const shots = shotsFromCuts(
    await detectShotCuts(input.clipFile),
    dims.durationSec,
  )
  const plans: Array<Array<{ x: number; width: number }> | null> = shots.map(
    () => null,
  )
  const notes: string[] = []
  try {
    for (let b = 0; b < shots.length; b += 8) {
      const batch = shots.slice(b, b + 8)
      const withFrames = await Promise.all(
        batch.map(async (s, k) => {
          const len = s.end - s.start
          const urls = await Promise.all(
            [0.2, 0.5, 0.8].map((p) =>
              frameDataUrl(input.clipFile, s.start + len * p),
            ),
          )
          return {
            shotId: `shot_${b + k}`,
            start: Number(s.start.toFixed(2)),
            end: Number(s.end.toFixed(2)),
            frameUrls: urls.filter((u): u is string => u !== null),
          }
        }),
      )
      const { intents } = await requestShotCropIntents({
        shots: withFrames.filter((s) => s.frameUrls.length > 0),
        source: { width: dims.width, height: dims.height },
        cropMode: "auto",
        model: INTRO_SMART_CROP_MODEL,
        apiKey,
      })
      for (const intent of intents) {
        const i = Number(intent.shotId.replace("shot_", ""))
        const shot = shots[i]
        if (!shot) continue
        plans[i] = intentToKeyframes(intent, shot, dims).cropKeyframes
        notes.push(
          `${shot.start.toFixed(1)}s ${intent.mode} "${intent.primarySubject}"`,
        )
      }
    }
  } catch (e) {
    input.log(
      `clip smart crop: ${e instanceof Error ? e.message : String(e)}, the clip stays centred`,
    )
    return null
  }
  input.log(
    `clip smart crop (${INTRO_SMART_CROP_MODEL}): ${shots.length} shot(s): ${notes.join("; ")}`,
  )
  return pathFromKeyframes(shots, plans, dims.width)
}
