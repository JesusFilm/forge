import type { MusicMood } from "./elevenlabs-music"
import { JESUS_FILM_CHAPTERS } from "./jesus-film-catalog"

/**
 * Clip → Bible-passage table for the video-first pipeline.
 *
 * Each JESUS-film chapter is mapped to the canonical passage that best anchors
 * the scene. The film follows Luke, so Luke is primary wherever the chapter is
 * a Gospel scene. Chapter 1 is the catalog's creation/fall montage and therefore
 * uses its official Genesis citation instead of inventing a Luke reference.
 *
 * Sources checked 2026-07-21:
 * - Official JESUS Film Project Arclight metadata, `bibleCitations` on
 *   `https://api.arclight.org/v2/media-components/1_jf61NN-0-0`
 * - ESV Bible text/reference headings for the uncited lamp scene (Luke 8:16-18)
 *   and the invitation's thematic Gospel anchor (Luke 24:46-49).
 *
 * OWNER DOCTRINAL REVIEW REQUIRED BEFORE PRODUCTION ENABLEMENT. Arclight has no
 * Bible citation for chapters 18 or 61, and chapter 61 is an application/invitation
 * rather than a depicted Bible scene. Its Luke 24:46-49 mapping is deliberately
 * marked here as a thematic anchor, not as an official catalog citation.
 */

export type ChapterPassage = {
  /** JESUS-film chapter index (1..61), keyed to JESUS_FILM_CHAPTERS. */
  index: number
  /** Canonical passage in OSIS form (matches reflection-corpus routing). */
  osisRef: string
  /** Human reference, e.g. "Luke 8:22-25". */
  reference: string
  /** Suggested music mood; the writer may override per devotional. */
  mood: MusicMood
  /** Theme keywords used for thematic reflection matching. */
  themes: string[]
  /** Curated clip window (s) pointing at the scene's meaningful moment. */
  clipStartSec?: number
  clipLengthSec?: number
}

type ClipWindow = Pick<ChapterPassage, "clipStartSec" | "clipLengthSec">

function passage(
  index: number,
  osisRef: string,
  reference: string,
  mood: MusicMood,
  themes: string[],
  clipWindow?: ClipWindow,
): ChapterPassage {
  return { index, osisRef, reference, mood, themes, ...clipWindow }
}

export const JESUS_FILM_PASSAGES: ChapterPassage[] = [
  passage(1, "Gen.1.26-Gen.3.24", "Genesis 1:26-3:24", "lament", [
    "creation",
    "fall",
    "sin",
    "separation",
    "redemption",
  ]),
  passage(2, "Luke.1.1-Luke.2.20", "Luke 1:1-2:20", "awe", [
    "incarnation",
    "promise",
    "birth",
    "joy",
    "salvation",
  ]),
  passage(3, "Luke.2.21-Luke.2.52", "Luke 2:21-52", "peace", [
    "childhood",
    "wisdom",
    "obedience",
    "growth",
    "calling",
  ]),
  passage(4, "Luke.3.21-Luke.3.22", "Luke 3:21-22", "awe", [
    "baptism",
    "identity",
    "beloved",
    "spirit",
    "prayer",
  ]),
  passage(
    5,
    "Luke.4.1-Luke.4.13",
    "Luke 4:1-13",
    "hope",
    ["temptation", "trust", "faith", "obedience", "victory"],
    { clipStartSec: 52, clipLengthSec: 46 },
  ),
  passage(6, "Luke.4.16-Luke.4.30", "Luke 4:16-30", "awe", [
    "fulfillment",
    "good news",
    "freedom",
    "mission",
    "rejection",
  ]),
  passage(7, "Luke.18.9-Luke.18.14", "Luke 18:9-14", "peace", [
    "humility",
    "prayer",
    "mercy",
    "repentance",
    "justification",
  ]),
  passage(8, "Luke.5.1-Luke.5.11", "Luke 5:1-11", "hope", [
    "calling",
    "obedience",
    "abundance",
    "trust",
    "discipleship",
  ]),
  passage(9, "Luke.8.40-Luke.8.56", "Luke 8:40-56", "hope", [
    "healing",
    "resurrection",
    "faith",
    "compassion",
    "hope",
  ]),
  passage(10, "Luke.5.27-Luke.5.28", "Luke 5:27-28", "hope", [
    "calling",
    "discipleship",
    "response",
    "change",
    "obedience",
  ]),
  passage(11, "Luke.6.20-Luke.6.23", "Luke 6:20-23", "hope", [
    "blessing",
    "kingdom",
    "poverty",
    "perseverance",
    "reward",
  ]),
  passage(12, "Luke.6.24-Luke.6.42", "Luke 6:24-42", "peace", [
    "love",
    "enemies",
    "mercy",
    "generosity",
    "judgment",
  ]),
  passage(13, "Luke.11.27-Luke.11.28", "Luke 11:27-28", "peace", [
    "hearing",
    "obedience",
    "blessing",
    "word",
    "faithfulness",
  ]),
  passage(
    14,
    "Luke.7.36-Luke.7.50",
    "Luke 7:36-50",
    "hope",
    ["forgiveness", "grace", "love", "mercy", "repentance"],
    { clipStartSec: 91.5, clipLengthSec: 40 },
  ),
  passage(15, "Luke.8.1-Luke.8.3", "Luke 8:1-3", "hope", [
    "discipleship",
    "service",
    "women",
    "generosity",
    "mission",
  ]),
  passage(16, "Luke.7.18-Luke.7.23", "Luke 7:18-23", "hope", [
    "doubt",
    "evidence",
    "healing",
    "good news",
    "faith",
  ]),
  passage(17, "Luke.8.4-Luke.8.15", "Luke 8:4-15", "peace", [
    "word",
    "heart",
    "growth",
    "perseverance",
    "fruitfulness",
  ]),
  passage(18, "Luke.8.16-Luke.8.18", "Luke 8:16-18", "hope", [
    "light",
    "witness",
    "truth",
    "hearing",
    "faithfulness",
  ]),
  passage(
    19,
    "Luke.8.22-Luke.8.25",
    "Luke 8:22-25",
    "peace",
    ["storm", "fear", "peace", "trust", "faith"],
    { clipStartSec: 52, clipLengthSec: 56 },
  ),
  passage(20, "Luke.8.26-Luke.8.39", "Luke 8:26-39", "hope", [
    "deliverance",
    "freedom",
    "restoration",
    "testimony",
    "authority",
  ]),
  passage(
    21,
    "Luke.9.10-Luke.9.17",
    "Luke 9:10-17",
    "peace",
    ["provision", "compassion", "thanksgiving", "trust", "need"],
    { clipStartSec: 94, clipLengthSec: 40 },
  ),
  passage(22, "Luke.9.18-Luke.9.22", "Luke 9:18-22", "awe", [
    "identity",
    "messiah",
    "confession",
    "suffering",
    "discipleship",
  ]),
  passage(23, "Luke.9.28-Luke.9.36", "Luke 9:28-36", "awe", [
    "glory",
    "prayer",
    "transfiguration",
    "beloved",
    "listen",
  ]),
  passage(24, "Luke.9.37-Luke.9.43", "Luke 9:37-43", "hope", [
    "healing",
    "deliverance",
    "compassion",
    "faith",
    "majesty",
  ]),
  passage(25, "Luke.11.1-Luke.11.4", "Luke 11:1-4", "peace", [
    "prayer",
    "father",
    "kingdom",
    "forgiveness",
    "dependence",
  ]),
  passage(26, "Luke.11.9-Luke.11.13", "Luke 11:9-13", "hope", [
    "prayer",
    "asking",
    "seeking",
    "trust",
    "holy spirit",
  ]),
  passage(27, "Luke.17.1-Luke.17.3", "Luke 17:1-3", "lament", [
    "temptation",
    "responsibility",
    "sin",
    "warning",
    "repentance",
  ]),
  passage(28, "Luke.13.18-Luke.13.19", "Luke 13:18-19", "hope", [
    "kingdom",
    "mustard seed",
    "growth",
    "small beginnings",
    "hope",
  ]),
  passage(29, "Luke.5.29-Luke.5.32", "Luke 5:29-32", "hope", [
    "sinners",
    "welcome",
    "repentance",
    "mercy",
    "calling",
  ]),
  passage(30, "Luke.13.10-Luke.13.17", "Luke 13:10-17", "hope", [
    "healing",
    "sabbath",
    "freedom",
    "compassion",
    "dignity",
  ]),
  passage(
    31,
    "Luke.10.25-Luke.10.37",
    "Luke 10:25-37",
    "hope",
    ["mercy", "love", "compassion", "kindness", "neighbour"],
    { clipStartSec: 36, clipLengthSec: 41 },
  ),
  passage(32, "Luke.18.35-Luke.18.43", "Luke 18:35-43", "hope", [
    "healing",
    "persistence",
    "mercy",
    "faith",
    "sight",
  ]),
  passage(
    33,
    "Luke.19.1-Luke.19.10",
    "Luke 19:1-10",
    "hope",
    ["grace", "repentance", "salvation", "seeking", "mercy"],
    { clipStartSec: 44, clipLengthSec: 48 },
  ),
  passage(34, "Luke.18.31-Luke.18.34", "Luke 18:31-34", "lament", [
    "prophecy",
    "suffering",
    "death",
    "resurrection",
    "purpose",
  ]),
  passage(35, "Luke.19.28-Luke.19.40", "Luke 19:28-40", "awe", [
    "king",
    "praise",
    "peace",
    "triumph",
    "worship",
  ]),
  passage(36, "Luke.19.41-Luke.19.44", "Luke 19:41-44", "lament", [
    "lament",
    "peace",
    "Jerusalem",
    "judgment",
    "compassion",
  ]),
  passage(37, "Luke.19.45-Luke.19.46", "Luke 19:45-46", "lament", [
    "worship",
    "justice",
    "prayer",
    "temple",
    "holiness",
  ]),
  passage(38, "Luke.21.1-Luke.21.4", "Luke 21:1-4", "peace", [
    "generosity",
    "sacrifice",
    "widow",
    "trust",
    "offering",
  ]),
  passage(39, "Luke.20.1-Luke.20.8", "Luke 20:1-8", "lament", [
    "authority",
    "truth",
    "fear",
    "integrity",
    "wisdom",
  ]),
  passage(40, "Luke.20.9-Luke.20.18", "Luke 20:9-18", "lament", [
    "rejection",
    "faithfulness",
    "judgment",
    "son",
    "cornerstone",
  ]),
  passage(41, "Luke.20.20-Luke.20.26", "Luke 20:20-26", "peace", [
    "wisdom",
    "integrity",
    "stewardship",
    "God",
    "government",
  ]),
  passage(42, "Luke.22.14-Luke.22.23", "Luke 22:14-23", "awe", [
    "covenant",
    "communion",
    "sacrifice",
    "remembrance",
    "betrayal",
  ]),
  passage(43, "Luke.22.24-Luke.22.38", "Luke 22:24-38", "peace", [
    "service",
    "humility",
    "leadership",
    "kingdom",
    "faithfulness",
  ]),
  passage(44, "Luke.22.39-Luke.22.53", "Luke 22:39-53", "lament", [
    "prayer",
    "surrender",
    "betrayal",
    "temptation",
    "arrest",
  ]),
  passage(45, "Luke.22.54-Luke.22.62", "Luke 22:54-62", "lament", [
    "denial",
    "failure",
    "repentance",
    "sorrow",
    "grace",
  ]),
  passage(46, "Luke.22.63-Luke.22.71", "Luke 22:63-71", "lament", [
    "mockery",
    "suffering",
    "identity",
    "injustice",
    "truth",
  ]),
  passage(47, "Luke.23.1-Luke.23.7", "Luke 23:1-7", "lament", [
    "accusation",
    "injustice",
    "kingdom",
    "truth",
    "suffering",
  ]),
  passage(48, "Luke.23.8-Luke.23.11", "Luke 23:8-11", "lament", [
    "mockery",
    "silence",
    "injustice",
    "power",
    "suffering",
  ]),
  passage(49, "Luke.23.13-Luke.23.25", "Luke 23:13-25", "lament", [
    "injustice",
    "condemnation",
    "innocence",
    "rejection",
    "sacrifice",
  ]),
  passage(50, "Luke.23.26-Luke.23.32", "Luke 23:26-32", "lament", [
    "cross",
    "suffering",
    "discipleship",
    "compassion",
    "warning",
  ]),
  passage(51, "Luke.23.33-Luke.23.35", "Luke 23:33-35", "lament", [
    "crucifixion",
    "forgiveness",
    "sacrifice",
    "mockery",
    "salvation",
  ]),
  passage(52, "Luke.23.34", "Luke 23:34", "lament", [
    "forgiveness",
    "crucifixion",
    "clothing",
    "prophecy",
    "mercy",
  ]),
  passage(53, "Luke.23.36-Luke.23.38", "Luke 23:36-38", "lament", [
    "mockery",
    "king",
    "cross",
    "suffering",
    "identity",
  ]),
  passage(54, "Luke.23.39-Luke.23.43", "Luke 23:39-43", "hope", [
    "mercy",
    "paradise",
    "faith",
    "salvation",
    "repentance",
  ]),
  passage(
    55,
    "Luke.23.44-Luke.23.49",
    "Luke 23:44-49",
    "lament",
    ["cross", "sacrifice", "redemption", "sorrow", "forgiveness"],
    { clipStartSec: 44, clipLengthSec: 50 },
  ),
  passage(56, "Luke.23.50-Luke.23.56", "Luke 23:50-56", "lament", [
    "burial",
    "courage",
    "faithfulness",
    "rest",
    "grief",
  ]),
  passage(57, "Luke.24.1-Luke.24.7", "Luke 24:1-7", "awe", [
    "resurrection",
    "promise",
    "angels",
    "remembrance",
    "hope",
  ]),
  passage(58, "Luke.24.8-Luke.24.12", "Luke 24:8-12", "hope", [
    "empty tomb",
    "witness",
    "belief",
    "resurrection",
    "wonder",
  ]),
  passage(
    59,
    "Luke.24.36-Luke.24.49",
    "Luke 24:36-49",
    "awe",
    ["resurrection", "hope", "joy", "peace", "victory"],
    { clipStartSec: 30, clipLengthSec: 36 },
  ),
  passage(60, "Luke.24.50-Luke.24.53", "Luke 24:50-53", "awe", [
    "ascension",
    "blessing",
    "worship",
    "joy",
    "mission",
  ]),
  // The official chapter metadata has no citation; this is a thematic anchor.
  passage(61, "Luke.24.46-Luke.24.49", "Luke 24:46-49", "hope", [
    "invitation",
    "repentance",
    "forgiveness",
    "salvation",
    "witness",
  ]),
]

const BY_INDEX = new Map(JESUS_FILM_PASSAGES.map((p) => [p.index, p]))

export function passageForChapter(index: number): ChapterPassage | null {
  return BY_INDEX.get(index) ?? null
}

export type ChapterWithPassage = ChapterPassage & {
  id: string
  title: string
  start: string
}

/** Join a passage entry with its catalog chapter (title + Arclight id). */
export function chapterWithPassage(index: number): ChapterWithPassage | null {
  const passageEntry = BY_INDEX.get(index)
  const chapter = JESUS_FILM_CHAPTERS[index - 1]
  if (!passageEntry || !chapter || chapter.index !== index) return null
  return {
    ...passageEntry,
    id: chapter.id,
    title: chapter.title,
    start: chapter.start,
  }
}

/** The catalog chapter indices with a passage mapping. */
export function mappedChapterIndices(): number[] {
  return JESUS_FILM_PASSAGES.map((p) => p.index)
}
