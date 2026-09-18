/**
 * Follow the faces through the devotional's film CLIP.
 *
 * In the clip-first structure the portrait video card shows the 16:9 clip
 * FULL-FRAME, which drops 34% of the picture on each side. That crop was blind: always the
 * centre, so a two-person shot landed on the gap between the people — the
 * same fault the background had, on the one card where the footage is the
 * point.
 *
 * This produces a continuous PATH (not steps): the window's centre for every
 * quarter-second of the clip, smoothed within each shot at the smart-crop
 * planner's pan-speed cap, and free to jump at a cut, where a jump is
 * invisible. The composition interpolates linearly between points.
 *
 * Face detection is the same local script the background uses; the shot
 * boundaries come from ffmpeg's scene metric merged with the moments the faces
 * jump, since the metric misses this footage's softer cuts.
 */
import { spawn } from "node:child_process"

import {
  defaultScriptPath,
  detectShotCuts,
  type FaceSample,
} from "./face-crop-anchors"

/** Sampling interval for the clip — denser than the background, the clip is
 *  the thing being watched. */
const INTERVAL_SEC = 0.25
/**
 * Half the fraction of the source width the crop window keeps. The FULL 9:16
 * frame over a 16:9 source keeps (9/16)/(16/9) = 81/256 of the width; the old
 * square window kept 9/16. Full-frame is the only use now: the owner rejected
 * a tracked square window for the classic layout, and the clip-first structure
 * shows the film full-frame, where a blind centre crop loses 34% either side.
 */
const WINDOW_HALF = 81 / 256 / 2
/** Smart-crop planner's pan cap: 240 px/s on a 1920-wide source. */
const MAX_SPEED_PER_SEC = 240 / 1920
/** Detections smaller than this are not faces anyone would notice. */
const MIN_AREA = 0.008
const DETECT_TIMEOUT_MS = 5 * 60_000

export type FocusPoint = { atSec: number; x: number }

function capture(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ out: string; ok: boolean }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args)
    let out = ""
    const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs)
    c.stdout.on("data", (d) => (out += String(d)))
    c.on("error", () => {
      clearTimeout(timer)
      resolve({ out, ok: false })
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      resolve({ out, ok: code === 0 })
    })
  })
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The face to follow in ONE shot: cluster detections by position and take the
 * cluster with the most presence, size as a tie-break — the rule the
 * background planner arrived at. Returns per-sample x (NaN where unseen).
 */
export function dominantTrack(
  shot: ReadonlyArray<FaceSample>,
  minArea = MIN_AREA,
): number[] {
  const clusters: { xs: number[]; areas: number[] }[] = []
  for (const s of shot) {
    for (const f of s.faces) {
      if (f.area < minArea) continue
      const c = clusters.find((k) => Math.abs(median(k.xs) - f.cx) < 0.08)
      if (c) {
        c.xs.push(f.cx)
        c.areas.push(f.area)
      } else clusters.push({ xs: [f.cx], areas: [f.area] })
    }
  }
  if (clusters.length === 0) return shot.map(() => NaN)
  clusters.sort(
    (a, b) => b.xs.length - a.xs.length || median(b.areas) - median(a.areas),
  )
  const centre = median(clusters[0].xs)
  return shot.map((s) => {
    const near = s.faces
      .filter((f) => f.area >= minArea && Math.abs(f.cx - centre) < 0.1)
      .sort((a, b) => b.area - a.area)[0]
    return near ? near.cx : NaN
  })
}

/**
 * Where the picture changes inside the clip: ffmpeg's cuts, plus the moments
 * the WHOLE cast moves.
 *
 * The background planner calls it a cut when the largest face jumps. On the
 * clip that misfires: a two-person shot where the detector alternates between
 * two similar faces produced thirty "changes" in thirty seconds, the path was
 * chopped into fragments and jumped back and forth between the two people. A
 * change of picture is when nobody from the previous sample is still where
 * they were — not when a different person happens to be biggest. Changes
 * closer together than `minShotSec` are merged; nothing cuts that fast here.
 */
export function clipPictureChanges(
  samples: ReadonlyArray<FaceSample>,
  cuts: ReadonlyArray<number>,
  minArea = MIN_AREA,
  minShotSec = 1.0,
): number[] {
  const out = [...cuts]
  const cast = (s: FaceSample) =>
    s.faces.filter((f) => f.area >= minArea).map((f) => f.cx)
  const near = (a: number[], b: number[]) =>
    a.some((x) => b.some((y) => Math.abs(x - y) <= 0.12))
  for (let i = 1; i < samples.length; i++) {
    // Who was on screen just before: the last three samples, because the
    // detector drops a face for a frame at a time and a single previous
    // sample is not a reliable roll call.
    const before = samples.slice(Math.max(0, i - 3), i).flatMap(cast)
    const now = cast(samples[i])
    if (before.length === 0 || now.length === 0) continue
    if (near(now, before)) continue
    // ...and it has to STICK: the next sample must also show nobody from
    // before. One frame where the detector sees only the other person, then
    // the first again, is flicker — a cut does not come back.
    const after = i + 1 < samples.length ? cast(samples[i + 1]) : now
    if (after.length > 0 && near(after, before)) continue
    out.push(samples[i].atSec)
  }
  const sorted = [...new Set(out.map((t) => Number(t.toFixed(3))))].sort(
    (a, b) => a - b,
  )
  const merged: number[] = []
  for (const t of sorted) {
    if (merged.length === 0 || t - merged[merged.length - 1] >= minShotSec)
      merged.push(t)
  }
  return merged
}

/** Interpolate inside, hold at the edges. */
function fill(a: number[]): number[] {
  const idx = a.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0)
  if (idx.length === 0) return a.map(() => 0.5)
  return a.map((v, i) => {
    if (!Number.isNaN(v)) return v
    const lo = [...idx].reverse().find((j) => j < i)
    const hi = idx.find((j) => j > i)
    if (lo == null) return a[hi!]
    if (hi == null) return a[lo]
    const p = (i - lo) / (hi - lo)
    return a[lo] + (a[hi] - a[lo]) * p
  })
}

/**
 * Smooth one shot's targets into a path: median against phantoms, the pan-speed
 * cap in both directions so a late-arriving target is approached rather than
 * snapped to, then a light low-pass. Clamped so the window stays on the frame.
 */
export function smoothShot(
  targets: number[],
  intervalSec: number,
  maxSpeed = MAX_SPEED_PER_SEC,
): number[] {
  const n = targets.length
  if (n === 0) return []
  const med = targets.map((_, i) => {
    const w = targets.slice(Math.max(0, i - 2), Math.min(n, i + 3))
    return median(w)
  })
  const step = maxSpeed * intervalSec
  const x = [...med]
  for (let i = 1; i < n; i++)
    x[i] = x[i - 1] + Math.max(-step, Math.min(step, x[i] - x[i - 1]))
  for (let i = n - 2; i >= 0; i--)
    x[i] = x[i + 1] + Math.max(-step, Math.min(step, x[i] - x[i + 1]))
  const k = [0.06, 0.24, 0.4, 0.24, 0.06]
  return x.map((_, i) => {
    let acc = 0
    for (let j = -2; j <= 2; j++)
      acc += k[j + 2] * x[Math.max(0, Math.min(n - 1, i + j))]
    return Math.max(WINDOW_HALF, Math.min(1 - WINDOW_HALF, acc))
  })
}

/**
 * Build the path for a whole clip from its samples and picture changes.
 * Exported for the test; `planClipFocus` runs the detector and calls this.
 */
export function buildClipPath(
  samples: ReadonlyArray<FaceSample>,
  changes: ReadonlyArray<number>,
  intervalSec = INTERVAL_SEC,
): FocusPoint[] {
  if (samples.length === 0) return []
  const bounds = [
    samples[0].atSec,
    ...changes.filter(
      (c) => c > samples[0].atSec && c < samples[samples.length - 1].atSec,
    ),
    Number.POSITIVE_INFINITY,
  ]
  const points: FocusPoint[] = []
  for (let b = 0; b < bounds.length - 1; b++) {
    const shot = samples.filter(
      (s) => s.atSec >= bounds[b] && s.atSec < bounds[b + 1],
    )
    if (shot.length === 0) continue
    const targets = fill(dominantTrack(shot))
    const x = smoothShot(targets, intervalSec)
    // A jump at the cut: the previous shot's last point and this shot's first
    // sit a frame apart, so the linear interpolation between them is instant.
    shot.forEach((s, i) =>
      points.push({ atSec: s.atSec, x: Number(x[i].toFixed(4)) }),
    )
  }
  return points
}

/**
 * Run the detector over a staged clip and return its focus path. Empty when
 * detection is unavailable, so the render is unchanged.
 */
export type ClipFocusPlan = {
  path: FocusPoint[]
  /** Wide stretches to show as two panels; see `planClipSplits`. */
  splits: Array<{ fromSec: number; toSec: number }>
}

export async function planClipFocus(opts: {
  clipFile: string
  python?: string
  scriptPath?: string
  /** Plan the two-panel stretches as well (clip-first only). */
  splitPanels?: boolean
  log?: (line: string) => void
}): Promise<ClipFocusPlan> {
  const log = opts.log ?? (() => {})
  const python = opts.python ?? process.env.DEVO_FACE_PYTHON ?? "python3"
  const script = opts.scriptPath ?? defaultScriptPath()
  const { out, ok } = await capture(
    python,
    [script, `--video=${opts.clipFile}`, `--interval=${INTERVAL_SEC}`],
    DETECT_TIMEOUT_MS,
  )
  if (!ok) {
    log("clip crop: detector unavailable — the clip stays centre-cropped")
    return { path: [], splits: [] }
  }
  let parsed: { samples?: FaceSample[] }
  try {
    parsed = JSON.parse(out)
  } catch {
    log("clip crop: detector output unreadable — staying centre-cropped")
    return { path: [], splits: [] }
  }
  const samples = parsed.samples ?? []
  if (samples.length === 0) return { path: [], splits: [] }
  const cuts = await detectShotCuts(opts.clipFile)
  const changes = clipPictureChanges(samples, cuts)
  const path = buildClipPath(samples, changes)
  const seen = samples.filter((s) =>
    s.faces.some((f) => f.area >= MIN_AREA),
  ).length
  const endSec =
    samples.length > 0 ? samples[samples.length - 1].atSec + INTERVAL_SEC : 0
  const splits = opts.splitPanels
    ? planClipSplits(samples, changes, endSec)
    : []
  log(
    `clip crop: ${seen}/${samples.length} samples with a face, ` +
      `${changes.length} picture change(s), ${path.length} path point(s)` +
      (splits.length
        ? `, ${splits.length} two-panel stretch(es): ` +
          splits
            .map((w) => `${w.fromSec.toFixed(1)}-${w.toSec.toFixed(1)}s`)
            .join(", ")
        : ""),
  )
  return { path, splits }
}

/**
 * Where the film is a WIDE shot and the portrait crop has to throw most of the
 * picture away. Those stretches read better as two panels: the whole frame on
 * top, a close crop following the face underneath.
 *
 * Deliberately sparse: at most two stretches per clip and never shorter than
 * `minSec`, because a panel that comes and goes every second flickers (owner).
 * A stretch is wide when the biggest face in it stays under `maxFaceArea` of
 * the frame, and it is cut at the film's own shot boundaries so the layout
 * never changes mid-shot.
 */
export type ClipSplit = {
  fromSec: number
  toSec: number
  /** Where the CLOSE panel looks: the nearest face in the shot, over time. */
  path: Array<{ atSec: number; x: number; y: number }>
}

/** Median of a list, for the split planner's grouping. */
const med = (xs: readonly number[]): number => {
  const a = [...xs].sort((p, q) => p - q)
  return a[Math.floor(a.length / 2)]
}

export function planClipSplits(
  samples: ReadonlyArray<FaceSample>,
  changes: ReadonlyArray<number>,
  endSec: number,
  opts: { maxFaceArea?: number; minSec?: number; max?: number } = {},
): ClipSplit[] {
  const maxFaceArea = opts.maxFaceArea ?? 0.02
  const minSec = opts.minSec ?? 3
  const max = opts.max ?? 2
  const bounds = [0, ...changes.filter((c) => c > 0 && c < endSec), endSec]
  const shots: Array<{ fromSec: number; toSec: number; biggest: number }> = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i]
    const to = bounds[i + 1]
    const inShot = samples.filter((x) => x.atSec >= from && x.atSec < to)
    if (inShot.length === 0) continue
    const biggest = Math.max(
      0,
      ...inShot.flatMap((x) => x.faces.map((f) => f.area)),
    )
    shots.push({ fromSec: from, toSec: to, biggest })
  }
  // Merge neighbouring wide shots so a scene cut inside a crowd sequence does
  // not split one stretch into two short ones.
  const wide: Array<{ fromSec: number; toSec: number }> = []
  for (const sh of shots) {
    if (sh.biggest > maxFaceArea) continue
    const last = wide[wide.length - 1]
    if (last && Math.abs(last.toSec - sh.fromSec) < 0.01) last.toSec = sh.toSec
    else wide.push({ fromSec: sh.fromSec, toSec: sh.toSec })
  }
  /**
   * The close panel follows the NEAREST person, not the smoothed path the
   * full-frame crop uses: in a crowd the smoothed path sits between people and
   * the panel fills with whoever is standing in the middle (owner: "there's
   * still a half-naked man in the shot"). Largest face = closest to camera.
   */
  const closePath = (fromSec: number, toSec: number) => {
    const inShot = samples.filter((s) => s.atSec >= fromSec && s.atSec <= toSec)
    if (inShot.length === 0) return []
    // Group the detections into people, then take the one CLOSEST to camera:
    // the biggest face, not the one the detector happens to see most often.
    // In this crowd the most-seen face was a bystander at the frame's edge
    // while the man the scene is about, nearer and larger, was passed over.
    const groups: Array<{ xs: number[]; ys: number[]; areas: number[] }> = []
    for (const s of inShot) {
      for (const f of s.faces) {
        if (f.area < MIN_AREA / 2) continue
        const g = groups.find((k) => Math.abs(med(k.xs) - f.cx) < 0.06)
        if (g) {
          g.xs.push(f.cx)
          g.ys.push(f.cy)
          g.areas.push(f.area)
        } else groups.push({ xs: [f.cx], ys: [f.cy], areas: [f.area] })
      }
    }
    // ...but only among people who are really in the shot, not a face the
    // detector flashed once.
    const present = groups.filter((g) => g.xs.length >= inShot.length * 0.15)
    const pool = present.length > 0 ? present : groups
    if (pool.length === 0) return []
    const best = pool.sort(
      (a, b) => med(b.areas) - med(a.areas) || b.xs.length - a.xs.length,
    )[0]
    const x = med(best.xs)
    const y = med(best.ys)
    return [
      { atSec: fromSec, x, y },
      { atSec: toSec, x, y },
    ]
  }
  return wide
    .filter((w) => w.toSec - w.fromSec >= minSec)
    .sort((a, b) => b.toSec - b.fromSec - (a.toSec - a.fromSec))
    .slice(0, max)
    .sort((a, b) => a.fromSec - b.fromSec)
    .map((w) => ({ ...w, path: closePath(w.fromSec, w.toSec) }))
}
