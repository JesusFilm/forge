/**
 * Crop the background toward the faces in it.
 *
 * The text cards sit over the film clip fitted with `objectFit: cover` — a
 * blind centre crop of a widescreen frame into a vertical one. That is right
 * only when the subject happens to stand mid-frame. On a two-person shot the
 * centre lands in the GAP between them, and the card shows a shoulder and a
 * wall: the owner's complaint, reproduced on the Parable of the Lamp at 100s.
 *
 * Two things this gets right that the first attempt did not:
 *
 *  - Anchors are cut to SHOTS, not cards. A card outlives the shot it opens
 *    on — one card here spans three cuts — so one anchor per card was wrong
 *    for most of its length. Each anchor starts at a cut in the footage, so
 *    the crop moves only where the picture already moves and the change cannot
 *    be seen.
 *  - Positions come from a face detector reading the frames, not from the
 *    vision model that plans crops for the Mux pipeline. That model answers on
 *    a 0.1 grid; a tenth of a widescreen frame is about a third of the window
 *    the crop keeps, which is enough to push a face off the edge. Measured: it
 *    put a face at 0.3 that sits at 0.47, and a good frame became a worse one.
 *
 * Best-effort by contract. No detector, no faces, a shot with nobody in it —
 * every one of those returns no anchor for that stretch, and the card falls
 * back to the centre crop it has always had.
 */
import { spawn } from "node:child_process"
import path from "node:path"

const FPS = 30
const TAIL_FRAMES = 24
/** Sensitivity of ffmpeg's `scene` metric for finding cuts. */
const SCENE_THRESHOLD = 0.3
/** Seconds between sampled frames. */
const SAMPLE_INTERVAL_SEC = 0.5
/**
 * Half the width of the frame the crop actually keeps, as a fraction of the
 * source: fitting 16:9 into 9:16 by height leaves (9/16)/(16/9) of the width,
 * so the visible band is a little under a third and its half is this.
 */
const VISIBLE_BAND = 81 / 256
/**
 * ...and the background is ZOOMED on top of that: the Ken-Burns drift runs to
 * 1.16, which narrows the band by the same factor. Leaving the zoom out of this
 * was a real bug — it made "just inside the frame" a lie by about a seventh,
 * and faces placed at the edge of what this thought was reach came back cut.
 */
const MAX_KEN_BURNS = 1.16
const VISIBLE_HALF = VISIBLE_BAND / MAX_KEN_BURNS / 2
/** How far inside that band a face must sit to count as comfortably framed. */
const EDGE_MARGIN = 0.03
/** A face this far from the current anchor is no longer usefully in frame. */
const REACH = VISIBLE_HALF - EDGE_MARGIN
/**
 * After the crop moves, it holds the new framing for at least this long.
 *
 * The problem was never a move, it was the ROUND TRIP. This footage cuts
 * between two angles every three or four seconds, so re-aiming on each one sent
 * the crop out and back, out and back — and that is what reads as the picture
 * jumping. Holding through the return means the exchange settles on one framing
 * instead of swinging across it.
 *
 * Requiring shots to be LONG before moving at all was tried first and is wrong:
 * shots here run three to four seconds, so it refused nearly every move and
 * handed back the blind centre crop this feature exists to replace.
 */
const HOLD_AFTER_MOVE_SEC = 4
/** A shot shorter than this keeps the previous framing: re-aiming for a moment
 *  is a twitch, not a decision. */
const MIN_SHOT_SEC = 1.0
/** Detection is minutes of CPU at worst; well past that means something hung. */
const DETECT_TIMEOUT_MS = 5 * 60_000

export type FaceSample = {
  atSec: number
  faces: { cx: number; cy: number; area: number }[]
}

export type ShotAnchor = { startSec: number; endSec: number; x: number | null }

export type BgFocusStep = { atSec: number; x: number }

function capture(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ out: string; err: string; ok: boolean }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args)
    let out = ""
    let err = ""
    const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs)
    c.stdout.on("data", (d) => (out += String(d)))
    c.stderr.on("data", (d) => (err += String(d)))
    c.on("error", () => {
      clearTimeout(timer)
      resolve({ out, err, ok: false })
    })
    c.on("close", (code) => {
      clearTimeout(timer)
      resolve({ out, err, ok: code === 0 })
    })
  })
}

/** Cut times (seconds) where the footage itself changes shot. */
export async function detectShotCuts(video: string): Promise<number[]> {
  const { err } = await capture(
    "ffmpeg",
    [
      "-v",
      "info",
      "-i",
      video,
      "-vf",
      `select='gt(scene,${SCENE_THRESHOLD})',metadata=print`,
      "-an",
      "-f",
      "null",
      "-",
    ],
    DETECT_TIMEOUT_MS,
  )
  const cuts: number[] = []
  for (const line of err.split("\n")) {
    const m = line.match(/pts_time:([0-9.]+)/)
    if (m) cuts.push(Number(m[1]))
  }
  return cuts.sort((a, b) => a - b)
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * One anchor per shot: the median horizontal position of the LARGEST face in
 * each sample. Median rather than mean because a false positive on a fold of
 * cloth drags a mean and cannot move a median.
 */
export function anchorsForShots(
  samples: ReadonlyArray<FaceSample>,
  cuts: ReadonlyArray<number>,
  endSec: number,
): ShotAnchor[] {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < endSec), endSec]
  const shots: ShotAnchor[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const startSec = bounds[i]
    const shotEnd = bounds[i + 1]
    const xs = samples
      .filter(
        (s) => s.atSec >= startSec && s.atSec < shotEnd && s.faces.length > 0,
      )
      .map((s) => s.faces[0].cx)
    // No face anywhere in the shot means no anchor: a landscape, or a crowd
    // seen from behind, has none to find, and inventing one is worse than
    // centring.
    shots.push({
      startSec,
      endSec: shotEnd,
      x: xs.length > 0 ? median(xs) : null,
    })
  }
  return shots
}

/**
 * Decide, shot by shot, where the crop should actually sit — and leave it where
 * it is unless the face would otherwise be out of frame.
 *
 * The first version re-aimed on every shot that had a face anywhere off centre.
 * On a dialogue, where the cutting alternates between two angles, that swung
 * the crop back and forth every few seconds: twenty moves in a three-minute
 * devotional, and the owner read the result as the picture jumping about. Each
 * move sat on a real cut, which is necessary but not sufficient — a cut hides a
 * move, it does not justify one.
 *
 * So the rule is the one a camera operator uses: hold the frame, and move only
 * when the subject would leave it. Centre is preferred whenever centre works,
 * so the picture returns to rest rather than drifting wherever the last face
 * happened to be.
 */
export function stabiliseAnchors(
  shots: ReadonlyArray<ShotAnchor>,
): ShotAnchor[] {
  let current: number | null = null
  let lastMoveSec = Number.NEGATIVE_INFINITY
  return shots.map((shot) => {
    if (shot.x == null) return { ...shot, x: current }
    const framedBy = (anchor: number | null) =>
      Math.abs(shot.x! - (anchor ?? 0.5)) <= REACH
    if (framedBy(current)) return { ...shot, x: current }
    if (shot.startSec - lastMoveSec < HOLD_AFTER_MOVE_SEC) {
      return { ...shot, x: current }
    }
    // Must move. Land ON the face rather than just barely including it: the
    // background is zoomed and drifting, so a face parked at the edge of the
    // frame does not stay there. Centre still wins when centre works, which is
    // where the picture should rest.
    current = framedBy(null) ? null : shot.x
    lastMoveSec = shot.startSec
    return { ...shot, x: current }
  })
}

/**
 * Walk the cards the way the composition does and hand each one the anchors
 * that fall inside its window, in seconds from ITS own start.
 *
 * A video card plays its own clip, so it neither starts nor advances the shared
 * background take — mirroring `bgStartFrames` in DevotionalVideo.
 */
export function bgFocusForCards(
  cards: ReadonlyArray<{
    kind?: string
    durationSec?: number
    holdSec?: number
  }>,
  shots: ReadonlyArray<ShotAnchor>,
  opts: { introHoldSec: number; outroHoldSec: number },
): Array<BgFocusStep[] | null> {
  const out: Array<BgFocusStep[] | null> = cards.map(() => null)
  let acc = 0
  cards.forEach((c, i) => {
    const frames =
      Math.round((c.durationSec ?? 0) * FPS) +
      Math.round((c.holdSec ?? 0) * FPS) +
      TAIL_FRAMES +
      (i === 0 ? Math.round(opts.introHoldSec * FPS) : 0) +
      (i === cards.length - 1 ? Math.round(opts.outroHoldSec * FPS) : 0)
    if (c.kind === "video") return
    const startSec = acc / FPS
    const endSec = (acc + frames) / FPS
    acc += frames

    const steps: BgFocusStep[] = []
    let last: number | null = null
    let movedOffCentre = false
    for (const shot of shots) {
      if (shot.endSec <= startSec || shot.startSec >= endSec) continue
      if (shot.endSec - shot.startSec < MIN_SHOT_SEC) continue
      // `null` from the stabiliser means "centre is fine here", which still has
      // to be SAID when the card was anchored a moment ago — otherwise the card
      // holds the old framing into a shot that was judged not to need it.
      const x = shot.x ?? 0.5
      if (last != null && Math.abs(x - last) < 0.001) continue
      steps.push({
        atSec: Math.max(0, Number((shot.startSec - startSec).toFixed(3))),
        x: Number(x.toFixed(4)),
      })
      last = x
      if (Math.abs(x - 0.5) >= 0.001) movedOffCentre = true
    }
    // A card that never leaves centre is left alone: writing 0.5 everywhere is
    // the same picture with more moving parts, and it would hide the fact that
    // nothing here needed correcting.
    out[i] = movedOffCentre ? steps : null
  })
  return out
}

/**
 * Run the detector over a staged background and return per-card focus steps.
 * Returns nulls throughout when detection is unavailable — the caller then
 * writes no anchors and the render is byte-identical to before this existed.
 */
export async function planFaceCropAnchors(opts: {
  bgFile: string
  cards: ReadonlyArray<{
    kind?: string
    durationSec?: number
    holdSec?: number
  }>
  introHoldSec: number
  outroHoldSec: number
  /** Interpreter with opencv available. Defaults to DEVO_FACE_PYTHON, else python3. */
  python?: string
  scriptPath?: string
  log?: (line: string) => void
}): Promise<Array<BgFocusStep[] | null>> {
  const log = opts.log ?? (() => {})
  const none = opts.cards.map(() => null)
  const python = opts.python ?? process.env.DEVO_FACE_PYTHON ?? "python3"
  const script =
    opts.scriptPath ?? path.join("apps", "mastra", "scripts", "face-anchors.py")

  const { out, ok } = await capture(
    python,
    [script, `--video=${opts.bgFile}`, `--interval=${SAMPLE_INTERVAL_SEC}`],
    DETECT_TIMEOUT_MS,
  )
  if (!ok) {
    log("face crop: detector unavailable — backgrounds stay centre-cropped")
    return none
  }
  let parsed: { samples?: FaceSample[]; error?: string }
  try {
    parsed = JSON.parse(out)
  } catch {
    log(
      "face crop: detector returned unreadable output — staying centre-cropped",
    )
    return none
  }
  if (!parsed.samples || parsed.samples.length === 0) {
    log(
      `face crop: no samples (${parsed.error ?? "empty"}) — staying centre-cropped`,
    )
    return none
  }

  const cuts = await detectShotCuts(opts.bgFile)
  const samples = parsed.samples
  const endSec = samples[samples.length - 1].atSec + SAMPLE_INTERVAL_SEC
  const shots = stabiliseAnchors(anchorsForShots(samples, cuts, endSec))
  const withFace = samples.filter((s) => s.faces.length > 0).length
  const anchored = shots.filter((s) => s.x != null).length
  log(
    `face crop: ${withFace}/${samples.length} samples with a face, ` +
      `${anchored}/${shots.length} shot(s) moved off centre`,
  )
  return bgFocusForCards(opts.cards, shots, {
    introHoldSec: opts.introHoldSec,
    outroHoldSec: opts.outroHoldSec,
  })
}
