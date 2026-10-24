// Pure decision layer for the in-player moments panel (no render harness in
// apps/tv — the panelState.ts convention). The server sends chunks as stored;
// every display rule lives HERE, deliberately: the Step 0 probe showed timing
// is real but patchy, so "how much do we trust these numbers" is a client
// decision the server must not pre-bake.

export type VideoMoment = {
  startSeconds: number | null
  endSeconds: number | null
  summary: string | null
  bibleVerses: readonly string[]
}

/** A moment the timeline may trust: a finite, non-negative anchor. */
export type TimedMoment = VideoMoment & { startSeconds: number }

/**
 * How the panel should treat a film's moments.
 *
 * - `timed`   — enough distinct anchors to follow the playhead and offer
 *               jump-to-scene.
 * - `untimed` — content exists but the anchors don't: render summaries as a
 *               plain list, no "this moment", no seeking.
 * - `empty`   — nothing renderable at all; the moments sections are omitted
 *               (the panel still shows study questions / citations).
 */
export type MomentsClassification =
  | { kind: "timed"; timeline: TimedMoment[] }
  | { kind: "untimed"; list: VideoMoment[] }
  | { kind: "empty" }

/** A moment is worth SHOWING (in either mode) if it says something. */
function isRenderable(moment: VideoMoment): boolean {
  return moment.summary != null || moment.bibleVerses.length > 0
}

function isTimed(moment: VideoMoment): moment is TimedMoment {
  return (
    moment.startSeconds != null &&
    Number.isFinite(moment.startSeconds) &&
    moment.startSeconds >= 0
  )
}

/**
 * Decide the panel's mode for one film.
 *
 * The degeneracy rule is the load-bearing part: upstream systems COALESCE
 * missing timecodes to 0, so a film can arrive with every "anchor" equal to
 * zero. Requiring at least two DISTINCT start values rejects that shape —
 * otherwise every jump-to-scene row would seek to 0:00 and "this moment"
 * would pin the whole film to its opening frame, which is worse than
 * offering no timing at all.
 */
export function classifyMoments(
  moments: readonly VideoMoment[],
): MomentsClassification {
  const renderable = moments.filter(isRenderable)
  if (renderable.length === 0) return { kind: "empty" }

  const timed = renderable.filter(isTimed)
  const distinctStarts = new Set(timed.map((m) => m.startSeconds))
  if (timed.length >= 2 && distinctStarts.size >= 2) {
    return {
      kind: "timed",
      timeline: [...timed].sort((a, b) => a.startSeconds - b.startSeconds),
    }
  }
  return { kind: "untimed", list: renderable }
}

/**
 * The moment the playhead is inside: last timeline entry with
 * `startSeconds <= t` (same lookup shape as parseVtt's findActiveCue).
 * Returns undefined before the first anchor. When the moment carries an
 * `endSeconds` and the playhead has passed it, the moment still holds until
 * the NEXT anchor — a gap with no active moment flickers the panel empty,
 * and chunk boundaries are approximate.
 */
export function findActiveMoment(
  timeline: readonly TimedMoment[],
  currentTimeSeconds: number,
): TimedMoment | undefined {
  if (timeline.length === 0) return undefined
  if (!Number.isFinite(currentTimeSeconds)) return undefined
  let low = 0
  let high = timeline.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (timeline[mid]!.startSeconds <= currentTimeSeconds) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found >= 0 ? timeline[found] : undefined
}
