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
import { fileURLToPath } from "node:url"

const FPS = 30
const TAIL_FRAMES = 24
/** Sensitivity of ffmpeg's `scene` metric for finding cuts. */
// Low on purpose: every cut is somewhere a crop move can hide, and this
// footage's soft interior cuts do not clear a high threshold — at 0.3 ffmpeg
// reported ONE shot spanning 44s to 73s of the Parable of the Lamp's
// background, across four obviously different setups.
const SCENE_THRESHOLD = 0.08
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

/**
 * The detector script, resolved from THIS module rather than the process cwd.
 *
 * It was `path.join("apps", "mastra", "scripts", "face-anchors.py")` — a
 * repo-root-relative path — while every documented way of running the renderer
 * puts the cwd at `apps/mastra`. So it resolved to
 * `apps/mastra/apps/mastra/scripts/face-anchors.py`, the spawn failed, and the
 * feature reported "detector unavailable" and fell back to the blind centre
 * crop it exists to replace. Silently: a missing detector is a legitimate
 * state (no opencv on the machine), so nothing distinguished "not installed"
 * from "we cannot find our own script".
 */
export function defaultScriptPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "scripts",
    "face-anchors.py",
  )
}

export type FaceSample = {
  atSec: number
  faces: { cx: number; cy: number; area: number }[]
}

export type ShotAnchor = {
  startSec: number
  endSec: number
  x: number | null
  /** True when this framing begins ON a cut in the footage, where a change of
   *  crop is invisible. False means it begins mid-shot and has to be eased. */
  snapped?: boolean
}

export type BgFocusStep = {
  atSec: number
  x: number
  /** Ease into this framing instead of cutting to it — set when the move could
   *  not be placed on a cut in the footage. */
  ease?: boolean
}

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
 * How far a face may travel between two samples and still be read as the same
 * person. Samples are half a second apart, so a seated speaker moves very
 * little; two people in a widescreen frame sit well over 0.2 apart. 0.12 is
 * comfortably inside that gap and comfortably outside one person's own drift.
 */
const SAME_FACE_TOLERANCE = 0.12

type FaceTrack = {
  xs: number[]
  areas: number[]
  lastCx: number
  lastCy: number
}

/**
 * Group a shot's detections into one track per person.
 *
 * A detection joins the nearest open track within `SAME_FACE_TOLERANCE`,
 * otherwise it opens its own. Nearest-first matters: with two people close
 * together, "first track within tolerance" would merge them.
 */
function trackFaces(samples: ReadonlyArray<FaceSample>): FaceTrack[] {
  const tracks: FaceTrack[] = []
  for (const s of samples) {
    for (const f of s.faces) {
      let best: FaceTrack | null = null
      let bestDist = Infinity
      for (const t of tracks) {
        const d = Math.hypot(f.cx - t.lastCx, f.cy - t.lastCy)
        if (d <= SAME_FACE_TOLERANCE && d < bestDist) {
          best = t
          bestDist = d
        }
      }
      if (best) {
        best.xs.push(f.cx)
        best.areas.push(f.area)
        best.lastCx = f.cx
        best.lastCy = f.cy
      } else {
        tracks.push({
          xs: [f.cx],
          areas: [f.area],
          lastCx: f.cx,
          lastCy: f.cy,
        })
      }
    }
  }
  return tracks
}

/**
 * Where the crop should sit for one shot: the median horizontal position of
 * the face that is PRESENT LONGEST, not the biggest one.
 *
 * Biggest was the first rule and it framed the wrong person. In a dialogue the
 * near figure is whoever is listening -- the speaker is further from camera and
 * so smaller -- and the profile cascade is happy to lock onto a large profile
 * at the edge of frame. Both of the owner's reported frames are that: Jesus
 * speaking while the crop sat on the listener.
 *
 * Longest-present is the owner's rule and it is the steadier one. Preferring a
 * FRONTAL face was the other candidate and it is worse here: with several
 * people the anchor would hop to whoever last turned toward the lens.
 *
 * It also inherits the old median's resistance to false positives and improves
 * on it -- Haar's phantoms (a fold of cloth, a patch of wall) flicker in and
 * out, so they lose on presence as well as being median-proof. A phantom that
 * sat still for a whole shot could still win; that is the residual risk, and
 * `MIN_AREA_FRACTION` in the detector is what keeps it small.
 *
 * Every candidate here is a real detection, so the anchor can never land on the
 * back of a head: the cascades only fire on frontal faces and profiles. A shot
 * with nobody facing camera yields no track at all and falls through to null.
 */
export function dominantFaceX(
  samples: ReadonlyArray<FaceSample>,
): number | null {
  const tracks = trackFaces(samples)
  if (tracks.length === 0) return null

  // Presence first, then size: two tracks seen equally often are separated by
  // which reads as the subject, and that keeps the choice deterministic.
  const best = tracks.reduce((a, b) => {
    if (b.xs.length !== a.xs.length) return b.xs.length > a.xs.length ? b : a
    return median(b.areas) > median(a.areas) ? b : a
  })
  return median(best.xs)
}

/** One anchor per shot -- see `dominantFaceX` for how the face is chosen. */
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
    const inShot = samples.filter(
      (s) => s.atSec >= startSec && s.atSec < shotEnd && s.faces.length > 0,
    )
    // No face anywhere in the shot means no anchor: a landscape, or a crowd
    // seen from behind, has none to find, and inventing one is worse than
    // centring.
    shots.push({
      startSec,
      endSec: shotEnd,
      x: dominantFaceX(inShot),
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
export type StabiliserTuning = {
  /** How far a face may sit from the anchor and still count as in frame. */
  reach?: number
  /** Seconds a new framing is held before another move is allowed. */
  holdSec?: number
}

export function stabiliseAnchors(
  shots: ReadonlyArray<ShotAnchor>,
  tuning: StabiliserTuning = {},
): ShotAnchor[] {
  const reach = tuning.reach ?? REACH
  const holdSec = tuning.holdSec ?? HOLD_AFTER_MOVE_SEC
  let current: number | null = null
  let lastMoveSec = Number.NEGATIVE_INFINITY
  return shots.map((shot) => {
    if (shot.x == null) return { ...shot, x: current }
    const framedBy = (anchor: number | null) =>
      Math.abs(shot.x! - (anchor ?? 0.5)) <= reach
    if (framedBy(current)) return { ...shot, x: current }
    if (shot.startSec - lastMoveSec < holdSec) {
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
export type TrackTuning = {
  /** How far a face may sit from the anchor and still count as in frame. */
  reach?: number
  /** Consecutive sampled seconds with nobody in frame before the crop moves. */
  patienceSec?: number
  /** Minimum time a framing is kept once taken. */
  dwellSec?: number
  /** Ignore detections smaller than this share of the frame. */
  minArea?: number
  /** A move lands on a cut this close, so the change hides inside it. */
  snapSec?: number
  /** Window used to decide WHERE to aim, so one flickering detection cannot. */
  decideOverSec?: number
  /** How long a needed move will wait for a cut to hide in. */
  waitForCutSec?: number
}

/**
 * Follow the faces through the footage and move the crop only when whoever it
 * is holding leaves the frame.
 *
 * This replaces "segment by shot, one anchor per shot". Shot segmentation was
 * the weak link: ffmpeg's scene metric reported ONE shot from 44s to 73s of the
 * Parable of the Lamp's background, where the faces plainly move between four
 * different setups, and lowering the threshold to 0.04 did not split it. Every
 * anchor inside that stretch was therefore chosen for a different moment than
 * the one it served, and the crop sat on a wall for seconds at a time.
 *
 * Cuts are still used, but only to HIDE a move: when the crop has to change,
 * the change is snapped onto a nearby cut so it happens where the picture is
 * already changing.
 */
export function trackFaceAnchors(
  samples: ReadonlyArray<FaceSample>,
  cuts: ReadonlyArray<number>,
  endSec: number,
  tuning: TrackTuning = {},
): ShotAnchor[] {
  const reach = tuning.reach ?? REACH
  // Move as soon as the frame is empty: waiting a second only means a second
  // of wall. Measured across the reflection of the Parable of the Lamp,
  // patience of 1s cost five points of face-in-frame and bought nothing, since
  // the moves it saved were moves that needed making.
  const patience = tuning.patienceSec ?? 0
  // Moves must not land on top of each other. An eased move takes about a
  // second on screen, and with no spacing the planner put ten of forty-three
  // steps less than 1.2s apart — one pair 0.06s apart — so glides were being
  // cut off mid-way and the crop snapped out of them. That, not the speed of
  // any single move, is what read as jerky.
  const dwell = tuning.dwellSec ?? 1.6
  // A detection smaller than this is not a face anyone would notice, and
  // treating one as a subject is how the crop ended up on a wall: Haar's
  // phantoms run 0.2-1% of the frame while the real faces here run 2-13%.
  const minArea = tuning.minArea ?? 0.02
  const snap = tuning.snapSec ?? 0.7
  const decideOverSec = tuning.decideOverSec ?? 1.5
  const waitForCut = tuning.waitForCutSec ?? 2.5

  const framed = (x: number | null, cx: number) =>
    Math.abs(cx - (x ?? 0.5)) <= reach
  /** The biggest face in one sample that is large enough to be real. */
  const biggest = (s: FaceSample) =>
    s.faces.filter((f) => f.area >= minArea).sort((a, b) => b.area - a.area)[0]
  /**
   * Where to aim, decided over the next second and a half rather than off one
   * frame. Haar's phantoms flicker — a fold of cloth is there for a frame and
   * gone — and aiming at a single sample let one of them throw the crop to 0.82
   * while a real face sat at 0.43. A median over a window cannot be moved by
   * something that only appears once.
   */
  const aimFrom = (from: number): number | undefined => {
    const xs = samples
      .filter((s) => s.atSec >= from && s.atSec <= from + decideOverSec)
      .map(biggest)
      .filter((f): f is NonNullable<typeof f> => f != null)
      .map((f) => f.cx)
      .sort((a, b) => a - b)
    if (xs.length === 0) return undefined
    return xs[Math.floor(xs.length / 2)]
  }

  const segments: ShotAnchor[] = []
  let current: number | null = null
  let since = 0
  let missingSince: number | null = null
  let lastMove = Number.NEGATIVE_INFINITY

  let snapped = true
  const close = (at: number, next: number | null, onCut: boolean) => {
    if (at > since)
      segments.push({ startSec: since, endSec: at, x: current, snapped })
    current = next
    since = at
    lastMove = at
    snapped = onCut
  }

  for (const s of samples) {
    const hasSomeone = s.faces.some(
      (f) => f.area >= minArea && framed(current, f.cx),
    )
    if (hasSomeone) {
      missingSince = null
      continue
    }
    // Nobody to aim at — a landscape, or a crowd from behind. Hold what we
    // have; inventing a position would be worse than keeping a steady frame.
    if (!biggest(s)) {
      missingSince = null
      continue
    }
    if (missingSince == null) missingSince = s.atSec
    if (s.atSec - missingSince < patience) continue
    if (s.atSec - lastMove < dwell) continue

    const aim = aimFrom(missingSince)
    if (aim == null) {
      missingSince = null
      continue
    }
    // Move. Prefer centre when centre frames this face: the picture should
    // spend its time at rest rather than parked wherever a face last was.
    const next = framed(null, aim) ? null : aim
    // Put the change ON a cut wherever possible: the picture is already
    // changing there, so the crop moving with it cannot be seen. A move in the
    // middle of a held shot is the one the eye catches, and nineteen of
    // twenty-seven moves were landing mid-shot before this.
    const at = missingSince as number
    const behind = cuts
      .filter((c) => c <= at && at - c <= snap)
      .sort((a, b) => b - a)[0]
    const ahead = cuts
      .filter((c) => c > at && c - at <= waitForCut)
      .sort((a, b) => a - b)[0]
    // Prefer the cut just BEHIND: that is where this shot began, so the new
    // framing belongs from its first frame and the half-second of wall before
    // the miss was noticed never reaches the screen. Nine of the ten remaining
    // bad samples were exactly that lag. Only when no cut started this shot
    // does it wait for the next one.
    const when = behind ?? ahead ?? at
    // Spacing is checked against the time the move ACTUALLY lands on, not the
    // moment the miss was noticed. Snapping can pull a move up to a second
    // backwards or push it two forwards, and checking the wrong one let moves
    // land on top of each other anyway — which is how glides kept getting cut
    // off after the spacing rule was added.
    if (when - lastMove < dwell) {
      missingSince = null
      continue
    }
    close(when, next, when !== at)
    missingSince = null
  }
  if (endSec > since)
    segments.push({ startSec: since, endSec, x: current, snapped })
  return segments
}

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
      // Does this framing BEGIN inside this card, or was it already in force
      // when the card opened? Only a beginning is a move.
      const begins = shot.startSec >= startSec
      steps.push({
        atSec: Math.max(0, Number((shot.startSec - startSec).toFixed(3))),
        x: Number(x.toFixed(4)),
        // A move that could not be put on a cut is eased instead. Snapping it
        // would be a jump in a held shot, which is the one the eye catches.
        //
        // A framing carried over from before this card is NOT eased: its move
        // already happened, on the previous card. Marking it would replay the
        // glide from the card's first frame — the same movement over and over
        // at every card boundary, which is what the owner was seeing get worse
        // the longer the glide was made.
        ...(begins && shot.snapped === false ? { ease: true } : {}),
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
  const script = opts.scriptPath ?? defaultScriptPath()

  const { out, err, ok } = await capture(
    python,
    [script, `--video=${opts.bgFile}`, `--interval=${SAMPLE_INTERVAL_SEC}`],
    DETECT_TIMEOUT_MS,
  )
  if (!ok) {
    // Say WHY. "Unavailable" read as "opencv is not installed" for as long as
    // the script path was wrong, so a broken feature looked like an absent
    // dependency and nobody looked further.
    const why = (err || out).trim().split("\n").pop() ?? "no output"
    log(
      `face crop: detector unavailable (${python} ${script}: ${why}) — backgrounds stay centre-cropped`,
    )
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
  const shots = trackFaceAnchors(samples, cuts, endSec)
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
