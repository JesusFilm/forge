/**
 * Shot-scheduled backdrop (owner, 2026-10-12, Ten Lepers).
 *
 * The uniform backdrop slows the scene's window and plays it again and again
 * until the timeline is covered. A short scene under a long reflection (67 s
 * of film under ~4.5 min) then shows every shot two or three times, and an
 * anchor can land on the shot that just played, so the same picture runs
 * twice in a row: the owner found that confusing.
 *
 * This plans the backdrop shot by shot instead:
 *   - the scene is cut into its shots (scene-change detection on the film);
 *     long shots are split into pieces so one take cannot fill a minute;
 *   - the first pass plays the scene in film order, later passes take the
 *     least-used piece, and NEVER the piece or shot that just played;
 *   - a few calm shots chosen by hand play slower, smoothly (motion
 *     interpolation, only for those seconds, so the render stays fast);
 *   - a few hand-picked frames are held as stills with a slow push-in, and
 *     they enter from the second pass on, standing in for a repeat.
 * Paragraph anchors (broll-plan.ts) still decide what is on screen when the
 * words point at a moment, unless that would repeat the shot just shown.
 *
 * Pure: the I/O (shot detection, encoding) lives in devotional-render.ts.
 */

export type Shot = { startSec: number; endSec: number }

export type ShotItem =
  | {
      kind: "clip"
      /** Film seconds. */
      startSec: number
      lengthSec: number
      /** Film seconds per screen second. */
      speed: number
      /** Interpolate in-between frames (smooth slow motion). */
      smooth: boolean
      shot: number
    }
  | { kind: "still"; atSec: number; screenSec: number; shot: number }

export const SHOT_PIECE_MAX_SEC = 6
const MIN_SHOT_SEC = 1.2
const STILL_SCREEN_SEC = 7

/** Cut times inside [start, end] → shots, merging slivers into a neighbour. */
export function shotsFromCuts(
  cuts: ReadonlyArray<number>,
  startSec: number,
  endSec: number,
): Shot[] {
  const edges = [
    startSec,
    ...cuts.filter((c) => c > startSec + 0.05 && c < endSec - 0.05),
    endSec,
  ].sort((a, b) => a - b)
  const shots: Shot[] = []
  for (let i = 0; i + 1 < edges.length; i++) {
    const s = { startSec: edges[i], endSec: edges[i + 1] }
    const prev = shots[shots.length - 1]
    if (prev && s.endSec - s.startSec < MIN_SHOT_SEC) prev.endSec = s.endSec
    else shots.push(s)
  }
  // A sliver at the very start merges forward instead.
  if (shots.length > 1 && shots[0].endSec - shots[0].startSec < MIN_SHOT_SEC) {
    shots[1].startSec = shots[0].startSec
    shots.shift()
  }
  return shots
}

type Piece = {
  id: number
  shot: number
  startSec: number
  lengthSec: number
  still?: boolean
}

function piecesOf(shots: ReadonlyArray<Shot>): Piece[] {
  const out: Piece[] = []
  shots.forEach((s, shot) => {
    const len = s.endSec - s.startSec
    const n = Math.max(1, Math.ceil(len / SHOT_PIECE_MAX_SEC))
    for (let k = 0; k < n; k++)
      out.push({
        id: out.length,
        shot,
        startSec: s.startSec + (len * k) / n,
        lengthSec: len / n,
      })
  })
  return out
}

const shotAt = (shots: ReadonlyArray<Shot>, sec: number) =>
  Math.max(
    0,
    shots.findIndex((s) => sec >= s.startSec && sec < s.endSec),
  )

export function scheduleShots(input: {
  shots: ReadonlyArray<Shot>
  /** Screen seconds to cover. */
  coverSec: number
  /** Default film seconds per screen second. */
  speed: number
  /** Film seconds inside the shots to slow smoothly, and how slow. */
  slowShotsAt?: ReadonlyArray<number>
  slowSpeed?: number
  /** Film seconds of frames to hold as stills. */
  stillsAt?: ReadonlyArray<number>
  /** Backdrop moments the words point at (broll-plan anchors). */
  anchors?: ReadonlyArray<{ atSec: number; sourceSec: number }>
}): ShotItem[] {
  const { shots, coverSec, speed } = input
  if (!shots.length) return []
  const slowSpeed = input.slowSpeed ?? 0.5
  const slow = new Set((input.slowShotsAt ?? []).map((s) => shotAt(shots, s)))
  const pieces = piecesOf(shots)
  const stills: Piece[] = (input.stillsAt ?? []).map((at, k) => ({
    id: pieces.length + k,
    shot: shotAt(shots, at),
    startSec: at,
    lengthSec: 0,
    still: true,
  }))
  const pool = [...pieces, ...stills]
  // Stills stand in for a repeat: they start as if already used once.
  const uses = new Map(pool.map((p) => [p.id, p.still ? 1 : 0]))
  const lastAt = new Map<number, number>()
  const anchors = [...(input.anchors ?? [])].sort((a, b) => a.atSec - b.atSec)
  const out: ShotItem[] = []
  let t = 0
  let prev: Piece | undefined
  let a = 0

  const screenOf = (p: Piece) =>
    p.still
      ? STILL_SCREEN_SEC
      : p.lengthSec / (slow.has(p.shot) ? slowSpeed : speed)

  while (t < coverSec + 2) {
    let pick: Piece | undefined
    while (a < anchors.length && anchors[a].atSec <= t + 1.5) {
      const want = anchors[a++]
      const cand = pieces.find(
        (p) =>
          want.sourceSec >= p.startSec &&
          want.sourceSec < p.startSec + p.lengthSec,
      )
      // An anchor never repeats the shot just shown, nor a piece seen in the
      // last 40 s: the words pointing back is not worth a visible rerun.
      if (
        cand &&
        cand.shot !== prev?.shot &&
        t - (lastAt.get(cand.id) ?? -Infinity) > 40
      )
        pick = cand
    }
    if (!pick) {
      // The next piece of the same take is not a repeat, just the shot
      // playing on; any other piece of the shot that just played is.
      const continues = (p: Piece) =>
        !!prev &&
        !p.still &&
        !prev.still &&
        Math.abs(p.startSec - (prev.startSec + prev.lengthSec)) < 0.05
      const others = pool.filter(
        (p) => p.id !== prev?.id && (p.shot !== prev?.shot || continues(p)),
      )
      const choices = others.length ? others : pool.filter((p) => p !== prev)
      // Two stills in a row read as a slideshow.
      const pickable = prev?.still ? choices.filter((p) => !p.still) : choices
      const fresh = pickable.filter((p) => (uses.get(p.id) ?? 0) === 0)
      // First pass: film order, continuing after the piece that just played.
      const after = prev ? prev.startSec : -Infinity
      pick =
        fresh
          .filter((p) => p.startSec > after)
          .sort((x, y) => x.startSec - y.startSec)[0] ??
        fresh.sort((x, y) => x.startSec - y.startSec)[0] ??
        // After that: the piece seen longest ago, so a repeat sits as far
        // from its last showing as the pool allows.
        [...pickable].sort(
          (x, y) =>
            (lastAt.get(x.id) ?? -Infinity) - (lastAt.get(y.id) ?? -Infinity) ||
            x.startSec - y.startSec,
        )[0]
    }
    if (!pick) break
    uses.set(pick.id, (uses.get(pick.id) ?? 0) + 1)
    lastAt.set(pick.id, t)
    const screen = Math.min(screenOf(pick), coverSec + 2 - t)
    if (pick.still) {
      out.push({
        kind: "still",
        atSec: pick.startSec,
        screenSec: screen,
        shot: pick.shot,
      })
    } else {
      const sp = slow.has(pick.shot) ? slowSpeed : speed
      out.push({
        kind: "clip",
        startSec: pick.startSec,
        lengthSec: screen * sp,
        speed: sp,
        smooth: slow.has(pick.shot),
        shot: pick.shot,
      })
    }
    t += screen
    prev = pick
  }
  return out
}

/** Screen seconds an item fills. */
export const itemScreenSec = (i: ShotItem) =>
  i.kind === "still" ? i.screenSec : i.lengthSec / i.speed
