/**
 * Films a devotional can be cut from, beyond the JESUS film (owner, 2026-09-25:
 * "we planned to start with the JESUS film and add more later — now we are
 * adding more").
 *
 * The JESUS film's 61 chapters keep their own table (`jesus-film-passages.ts`)
 * because the generator picks a passage BY chapter. A source here is different:
 * it names one scene of another film together with everything the render needs
 * to play it — the Arclight id, the passage it carries, the window, whose mark
 * goes in the corner, the grade, and where its captions come from.
 *
 * Each source gets a chapter index ABOVE the JESUS film's range. That keeps the
 * cache layout (`devo/cache/ch<index>-seq<n>`) and every index-keyed lookup
 * working unchanged: `passageForChapter` simply finds nothing for 1001, and the
 * render takes the window from here instead.
 */
export type VideoSource = {
  /** Stable handle for `--source=`. */
  key: string
  /** Synthetic chapter index, >= 1000. Also the cache directory's number. */
  index: number
  /** Arclight media-component id. */
  mediaComponentId: string
  /** Human title, used for the output file name and logs. */
  title: string
  film: "lumo"
  passage: { reference: string; osisRef: string }
  /** The scene inside the component, in seconds. */
  window: { startSec: number; lengthSec: number }
  /**
   * Ceiling on the film card, seconds on screen. The default (60) is sized for
   * the JESUS film's short scenes; a whole parable is longer, and the owner
   * asked for all of it (2026-09-25: "show the whole parable, cut the pauses,
   * speed it up a little").
   */
  maxVideoCardSec?: number
  /** Mark drawn in the top-left while the clip plays. */
  filmMark: "lumo"
  /** LUMO's own photography needs no grade at all (owner). */
  style: "clean" | "restored"
  /**
   * Where the clip's captions come from. LUMO has no subtitle track in the
   * Arclight API, but its narration is Scripture read word for word — so the
   * cue file is made ONCE (whisper timings, BSB words) and checked in beside
   * this table, then reused by every render.
   */
  captions: { kind: "none" } | { kind: "file"; path: string }
}

const SOURCES: VideoSource[] = [
  {
    key: "lumo-matt-20",
    index: 1001,
    mediaComponentId: "6_GOMatt2515",
    title: "The Workers in the Vineyard",
    film: "lumo",
    passage: { reference: "Matthew 20:1-16", osisRef: "Matt.20.1-Matt.20.16" },
    // The parable's last line ("So the last will be first…") ends at 147.0s
    // and the road to Jerusalem starts speaking at 151s — both read off the
    // whisper transcript, not guessed from pictures (the first cut, 155s, let
    // "Now Jesus was going up to Jerusalem" into the card).
    window: { startSec: 0, lengthSec: 149 },
    // 141s kept after the dead air is cut, ×1.12 → ~126s on screen.
    maxVideoCardSec: 135,
    filmMark: "lumo",
    style: "clean",
    captions: { kind: "file", path: "video-sources/lumo-matt-20.en.vtt" },
  },
  {
    // The Prodigal Son, the first run of the message-first path (feat-572).
    // The segment opens on 15:11 at 0.0s ("Jesus continued. There was a man
    // who had two sons") and the parable's last line ends at 226.4s; the
    // unjust manager starts speaking at 230.0s (whisper transcript,
    // 2026-09-29). Captions are still to be made from that transcript.
    key: "lumo-luke-15",
    index: 1002,
    mediaComponentId: "6_GOLuke2616",
    title: "The Prodigal Son",
    film: "lumo",
    passage: { reference: "Luke 15:11-32", osisRef: "Luke.15.11-Luke.15.32" },
    window: { startSec: 0, lengthSec: 228 },
    maxVideoCardSec: 215,
    filmMark: "lumo",
    style: "clean",
    captions: { kind: "none" },
  },
]

const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]))
const BY_INDEX = new Map(SOURCES.map((s) => [s.index, s]))

export function videoSource(key: string): VideoSource | undefined {
  return BY_KEY.get(key)
}

export function videoSourceForIndex(index: number): VideoSource | undefined {
  return BY_INDEX.get(index)
}

export function listVideoSources(): readonly VideoSource[] {
  return SOURCES
}
