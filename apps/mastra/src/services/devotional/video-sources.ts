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
   * Seconds of held last frame (and silence) added after the segment, for a
   * scene that ends the segment with no footage left for the card's tail and
   * fade (owner, 2026-10-14: the widow's last word was faded out).
   */
  endPadSec?: number
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
    endPadSec: 3,
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
  {
    // The paralytic lowered through the roof sits in the middle of the
    // Luke 5 segment: 5:17 ("One day Jesus was teaching") starts at 192.24
    // after "withdrew to lonely places and prayed" ends at 189.5, and "We have
    // seen remarkable things today" ends at 362.3; Levi (5:27) only starts at
    // ~373. The scene keeps long wordless stretches (the roof, the lowering,
    // the man rising), so the card runs close to three minutes (whisper word
    // times, 2026-10-16).
    key: "lumo-luke-5-paralytic",
    index: 1007,
    mediaComponentId: "6_GOLuke2605",
    title: "The Paralytic Lowered Through the Roof",
    film: "lumo",
    passage: { reference: "Luke 5:17-26", osisRef: "Luke.5.17-Luke.5.26" },
    window: { startSec: 191.6, lengthSec: 171.7 },
    // The Russian dub ends «молился» at 189.0, starts «Однажды» at ~191.9
    // and ends «видели мы сегодня» at 362.0.
    windowByLang: { ru: { startSec: 190.6, lengthSec: 172.4 } },
    // ~171.7s ×1.05 → ~164s on screen, plus a breath.
    maxVideoCardSec: 166,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-5-paralytic.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-5-paralytic.ru.vtt" },
    },
  },
  {
    // The great catch opens the Luke 5 segment: 5:1 ("One day as Jesus was
    // standing by the Lake of Gennesaret") starts at 0.7, and "left
    // everything and followed him" ends at 104.3; the leper (5:12) only
    // starts at ~116 (whisper per speech burst, 2026-10-19).
    key: "lumo-luke-5-catch",
    index: 1008,
    mediaComponentId: "6_GOLuke2605",
    title: "The Great Catch of Fish",
    film: "lumo",
    passage: { reference: "Luke 5:1-11", osisRef: "Luke.5.1-Luke.5.11" },
    window: { startSec: 0, lengthSec: 105.5 },
    // The Russian dub ends «пошли за Ним» at 103.95.
    windowByLang: { ru: { startSec: 0, lengthSec: 105.2 } },
    // ~105.5s ×1.05 → ~100.5s on screen, plus a breath.
    maxVideoCardSec: 103,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-5-catch.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-5-catch.ru.vtt" },
    },
  },
  {
    // The rich fool sits early in the Luke 12 segment: 12:13 ("Someone in the
    // crowd said to him") starts at 118.95 after "what you should say" ends at
    // 116.45, and "not rich toward God" ends at 204.0; 12:22 ("Then Jesus said
    // to his disciples") only starts at 206.9. A ~4 s wordless beat follows
    // "demanded from you" (whisper per speech burst, 2026-10-21).
    key: "lumo-luke-12-fool",
    index: 1009,
    mediaComponentId: "6_GOLuke2613",
    title: "The Rich Fool",
    film: "lumo",
    passage: { reference: "Luke 12:13-21", osisRef: "Luke.12.13-Luke.12.21" },
    window: { startSec: 118.6, lengthSec: 86.6 },
    // The Russian dub starts «Кто-то в толпе» at 119.6 and ends «богатство
    // для Бога» at 202.55; «Затем Иисус» only starts at 206.4.
    windowByLang: { ru: { startSec: 119.2, lengthSec: 84.4 } },
    // ~86.6s ×1.05 → ~82.5s on screen, plus a breath.
    maxVideoCardSec: 85,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-12-fool.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-12-fool.ru.vtt" },
    },
  },
  {
    // The woman who touched his cloak sits inside the Jairus story at the
    // start of the Luke 8:40-9:17 segment. The card starts on 8:40 ("Now when
    // Jesus returned", speech from 3.3) so the viewer sees why Jesus is in a
    // hurry: Jairus's daughter is dying. It ends after "Go in peace" (8:48,
    // ends ~90.0); the messenger from Jairus's house (8:49) starts at 93.8
    // (whisper per speech burst, 2026-10-21).
    key: "lumo-luke-8-woman",
    index: 1010,
    mediaComponentId: "6_GOLuke2609",
    title: "The Woman Who Touched His Cloak",
    film: "lumo",
    passage: { reference: "Luke 8:40-48", osisRef: "Luke.8.40-Luke.8.48" },
    window: { startSec: 2.6, lengthSec: 89.0 },
    // The Russian dub starts «Когда Иисус» at 3.15 and ends «Иди с миром» at
    // 91.3; «Иисус ещё не договорил» starts at 91.9. The cue tool placed the
    // last cue at 91.2; it was set by hand from a word-level pass (89.95).
    windowByLang: { ru: { startSec: 2.7, lengthSec: 88.9 } },
    // ~89s ×1.05 → ~85s on screen, plus a breath.
    maxVideoCardSec: 87,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-8-woman.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-8-woman.ru.vtt" },
    },
  },
  {
    key: "lumo-luke-8-jairus",
    index: 1011,
    mediaComponentId: "6_GOLuke2609",
    title: "Jairus's Daughter",
    film: "lumo",
    // The clip is 8:49-56 only: Jairus's plea (8:40-42) is the opening of the
    // lumo-luke-8-woman clip, and the woman's healing sits between the two
    // halves. The script links back to that episode instead of replaying it.
    passage: { reference: "Luke 8:49-56", osisRef: "Luke.8.49-Luke.8.56" },
    // EN «While Jesus was still speaking» starts at 93.75 ("Go in peace" ends
    // the woman clip at 91.6); «what had happened» ends at 205.9 and the next
    // line (9:1) starts at 215.0. 145.5-189.4 is the wordless raising scene.
    window: { startSec: 93.4, lengthSec: 114.0 },
    // RU «Иисус ещё не договорил» starts at 93.75 (the tail of «Иди с миром»
    // ends at 91.95); «что произошло» ends at 206.3, 9:1 starts at 214.9.
    // Cue 15 «Дитя, встань!» was set by hand (whisper missed both words).
    windowByLang: { ru: { startSec: 93.3, lengthSec: 114.5 } },
    // ~114s ×1.05 → ~109s on screen, plus a breath.
    maxVideoCardSec: 111,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-8-jairus.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-8-jairus.ru.vtt" },
    },
  },
  {
    // The Lost Sheep and the Lost Coin. The scene closes segment 2615 (Luke
    // 14:1-15:10): "Whoever has ears to hear" (14:35) ends at 346.1 and 15:1
    // starts speaking at 349.3; "over one sinner who repents" ends at 453.95.
    // The segment runs to 456.4 under a sung line (454.4-456.4) that is not
    // part of the scene, so the window stops before it (whisper per speech
    // burst, 2026-10-26). Cue 13/14 (15:7) were timed by hand from a
    // word-level pass: the burst tool lost "I tell you that".
    key: "lumo-luke-15-lost",
    index: 1012,
    mediaComponentId: "6_GOLuke2615",
    title: "The Lost Sheep and the Lost Coin",
    film: "lumo",
    passage: { reference: "Luke 15:1-10", osisRef: "Luke.15.1-Luke.15.10" },
    window: { startSec: 349.2, lengthSec: 105.4 },
    // RU «Послушать Иисуса» starts at 348.05; «грешнике» ends at 451.75 and
    // the same sung line starts at 452.2.
    windowByLang: { ru: { startSec: 347.6, lengthSec: 104.6 } },
    // ~105s ×1.05 → ~100s on screen, plus a breath.
    maxVideoCardSec: 103,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-15-lost.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-15-lost.ru.vtt" },
    },
  },
  {
    // The Transfiguration sits inside segment 2610 (Luke 9:18-62). EN «About
    // eight days» starts at 123.7 (9:27 «kingdom of God» ends at 112.85, music
    // between); «what they had seen» ends at 219.2 and 9:37 «The next day»
    // starts at 220.5 (speech bursts on the isolated dialogue, 2026-10-28).
    key: "lumo-luke-9-transfiguration",
    index: 1013,
    mediaComponentId: "6_GOLuke2610",
    title: "The Transfiguration",
    film: "lumo",
    passage: { reference: "Luke 9:28-36", osisRef: "Luke.9.28-Luke.9.36" },
    window: { startSec: 123.4, lengthSec: 96.4 },
    // RU «Примерно восемь дней» starts at 123.6; «что видели» ends at 220.1
    // and «На следующий день» starts at 220.95.
    windowByLang: { ru: { startSec: 123.3, lengthSec: 97.3 } },
    // ~97s ×1.05 → ~92s on screen, plus a breath.
    maxVideoCardSec: 94,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-9-transfiguration.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-9-transfiguration.ru.vtt" },
    },
  },
  {
    // The boy with a spirit follows the Transfiguration in segment 2610. EN
    // «The next day» starts at 220.5 («what they had seen» ends at 218.2);
    // «greatness of God» (9:43a) ends at 296.0, crowd sound follows and 9:43b
    // «While everyone was marveling» starts at 316.2. Between 263.4 and 277.3
    // the film plays the healing without words (music), so the card holds a
    // long silent stretch on purpose.
    key: "lumo-luke-9-boy",
    index: 1014,
    mediaComponentId: "6_GOLuke2610",
    title: "The Boy with a Spirit",
    film: "lumo",
    passage: { reference: "Luke 9:37-43", osisRef: "Luke.9.37-Luke.9.43" },
    window: { startSec: 220.3, lengthSec: 76.7 },
    // RU «На следующий день» starts at 220.9; «величием Бога» ends at 295.2.
    windowByLang: { ru: { startSec: 220.7, lengthSec: 76.3 } },
    // ~77s ×1.05 → ~73s on screen, plus a breath.
    maxVideoCardSec: 75,
    videoSpeed: 1.05,
    filmCaptionStyle: "scroll",
    filmMark: "lumo",
    style: "clean",
    captions: {
      kind: "file",
      path: "video-sources/lumo-luke-9-boy.en.vtt",
      byLang: { ru: "video-sources/lumo-luke-9-boy.ru.vtt" },
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
