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
  /** A dub that reads the same scene on a different clock (the Russian
   *  narrator of LUMO Luke 17 starts 2.5 s earlier than the English). */
  windowByLang?: Partial<
    Record<"ru" | "es", { startSec: number; lengthSec: number }>
  >
  /**
   * Ceiling on the film card, seconds on screen. The default (60) is sized for
   * the JESUS film's short scenes; a whole parable is longer, and the owner
   * asked for all of it (2026-09-25: "show the whole parable, cut the pauses,
   * speed it up a little").
   */
  maxVideoCardSec?: number
  /**
   * Playback speed of the film card. LUMO is shot at a natural pace; the
   * JESUS film's 1.12 made its actors look jerky (owner, 2026-09-30), so
   * LUMO plays at 1.05. `--video-speed` still wins.
   */
  videoSpeed?: number
  /**
   * How the film's own captions are shown. LUMO reads the Bible word for word
   * over its pictures, so its narration is set as scrolling, numbered Scripture
   * (owner, 2026-09-30). Every other film keeps the typewriter reveal (a
   * letter lands gold, then turns white). `--film-caption-style` still wins.
   */
  filmCaptionStyle?: "scroll"
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
  captions:
    | { kind: "none" }
    | {
        kind: "file"
        /** The English cue file. */
        path: string
        /** Cue files for other languages' dubs, e.g. the Spanish (21028). */
        byLang?: Partial<Record<"ru" | "es", string>>
      }
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
    // 141s kept after the dead air is cut: ×1.12 → ~126s on screen, ×1.05
    // (the LUMO speed since 2026-09-30) → ~134s.
    maxVideoCardSec: 145,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: { kind: "file", path: "video-sources/lumo-matt-20.en.vtt" },
  },
  {
    // The Prodigal Son, the first run of the message-first path (feat-572).
    // The segment opens on 15:11 at 0.0s ("Jesus continued. There was a man
    // who had two sons") and the parable's last line ends at 226.4s; the
    // unjust manager starts speaking at 230.0s (whisper transcript,
    // 2026-09-29). Captions: the narration as spoken (NIV), whisper timings.
    key: "lumo-luke-15",
    index: 1002,
    mediaComponentId: "6_GOLuke2616",
    title: "The Prodigal Son",
    film: "lumo",
    passage: { reference: "Luke 15:11-32", osisRef: "Luke.15.11-Luke.15.32" },
    window: { startSec: 0, lengthSec: 228 },
    // ×1.05 (not 1.12) keeps the whole parable ~213s on screen plus the tail.
    maxVideoCardSec: 232,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-15.en.vtt",
      // The Latin American dub reads the NVI word for word (whisper small,
      // corrected against the NVI text, 2026-09-30).
      byLang: {
        es: "video-sources/lumo-luke-15.es.vtt",
        // The Russian dub (3934) reads a modern Russian translation; parable
        // 0.8s to 220.1s, the next story speaks at 223.6s (2026-10-08).
        ru: "video-sources/lumo-luke-15.ru.vtt",
      },
    },
  },
  {
    // Martha and Mary. The scene follows the Good Samaritan in the same
    // segment: "Go and do likewise" ends, the music runs, and 10:38 starts
    // speaking at 419.1s; the last line ends at 467.3s and the segment (and
    // Luke 10) ends at 471.3s (whisper transcript, 2026-10-01).
    key: "lumo-luke-10",
    index: 1003,
    mediaComponentId: "6_GOLuke2611",
    title: "Martha and Mary",
    film: "lumo",
    passage: { reference: "Luke 10:38-42", osisRef: "Luke.10.38-Luke.10.42" },
    // Seeded wide enough for the Russian dub, whose 10:38 starts at 414.7s
    // (English 419.1s); each language snaps to its own first cue.
    window: { startSec: 412, lengthSec: 57 },
    // ~49s of speech ×1.05 → ~47s on screen, plus the closing hold.
    maxVideoCardSec: 52,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-10.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-10.ru.vtt" },
    },
  },
  {
    key: "lumo-luke-18",
    index: 1004,
    mediaComponentId: "6_GOLuke2618",
    title: "Healing of the Blind Man",
    film: "lumo",
    passage: { reference: "Luke 18:35-43", osisRef: "Luke.18.35-Luke.18.43" },
    window: { startSec: 260.6, lengthSec: 76 },
    // ~75s of speech ×1.05 → ~72s on screen, plus the closing hold.
    maxVideoCardSec: 76,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: { kind: "file", path: "video-sources/lumo-luke-18.en.vtt" },
  },
  {
    key: "lumo-luke-17",
    index: 1005,
    mediaComponentId: "6_GOLuke2617",
    title: "Jesus Heals Ten Men with Leprosy",
    film: "lumo",
    passage: { reference: "Luke 17:11-19", osisRef: "Luke.17.11-Luke.17.19" },
    // The narrator's last word ("well") ends at 183.0; after it the segment
    // runs 9 s of landscape into the next scene, which read as a stall.
    window: { startSec: 117.2, lengthSec: 67 },
    // The Russian narrator begins "По пути в Иерусалим" at 114.9 and ends
    // "спасла тебя" at 179.0.
    windowByLang: { ru: { startSec: 114.6, lengthSec: 66 } },
    maxVideoCardSec: 67,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-17.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-17.ru.vtt" },
    },
  },
  {
    // The persistent widow closes the same segment as the ten lepers: 18:1
    // ("Then Jesus told his disciples a parable") starts at 359.05 after 17
    // wordless seconds that follow "the vultures will gather", and "will he
    // find faith on the earth?" ends at 425.65, half a second before the
    // segment does (whisper per speech burst on the isolated dialogue,
    // 2026-10-13).
    key: "lumo-luke-18-widow",
    index: 1006,
    mediaComponentId: "6_GOLuke2617",
    title: "The Persistent Widow",
    film: "lumo",
    passage: { reference: "Luke 18:1-8", osisRef: "Luke.18.1-Luke.18.8" },
    window: { startSec: 358.7, lengthSec: 67.1 },
    // The Russian dub starts 18:1 at 358.3 and ends "веру на земле?" at
    // 424.55, 0.4 s before the segment does.
    windowByLang: { ru: { startSec: 358.0, lengthSec: 66.7 } },
    // ~66.6s of speech ×1.05 → ~64s on screen, plus the closing hold.
    maxVideoCardSec: 67,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-18-widow.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-18-widow.ru.vtt" },
    },
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
