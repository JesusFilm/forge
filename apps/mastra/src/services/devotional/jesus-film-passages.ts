import type { MusicMood } from "./elevenlabs-music"
import { JESUS_FILM_CHAPTERS } from "./jesus-film-catalog"
import type { CommentaryPreference } from "./reflection-corpus"

/**
 * Clip → Bible-passage table for the video-first pipeline.
 *
 * Each JESUS-film chapter is mapped to the Gospel passage it depicts. The
 * pipeline picks an unused chapter, then this table gives the passage that
 * anchors the scripture AND routes the reflection (see reflection-corpus.ts).
 *
 * IMPORTANT: the JESUS film (1979) follows the Gospel of LUKE, so passages are
 * Luke-primary → reflections come from Matthew Henry's Luke commentary. (Ryle's
 * Matthew volume is for future Matthew-based films, e.g. LUMO.)
 *
 * This is a STARTER subset for the end-to-end slice. Expand to all 61 chapters
 * after review — every entry's passage should be checked for accuracy.
 */

export type ChapterPassage = {
  /** JESUS-film chapter index (1..61), keyed to JESUS_FILM_CHAPTERS. */
  index: number
  /** Canonical passage in osis form (matches reflection-corpus routing). */
  osisRef: string
  /** Human reference, e.g. "Luke 8:22-25". */
  reference: string
  /** Suggested music mood; the writer may override per devotional. */
  mood: MusicMood
  /** Theme keywords — used to theme-match a Spurgeon devotional (which is keyed
   *  to its own verses, not this passage). See reflection-corpus selectReflection. */
  themes: string[]
  /** Curated clip window (s) pointing at the scene's MEANINGFUL moment — the
   *  render trims to this instead of a blind head-slice. Omit → whole clip. */
  clipStartSec?: number
  clipLengthSec?: number
  /** Override for `removeInternalGaps`' default 10s dead-air threshold
   *  (subtitle-align.ts). Most silent stretches between lines really are dead
   *  air and should get cut — but some scenes carry the drama VISUALLY with no
   *  dialogue (a storm building, a crowd reacting), and cutting that gap on
   *  the default threshold guts the scene instead of tightening it. Set this
   *  only for a chapter where that's confirmed true; it's a per-video-track
   *  fact (roughly language-independent), not a per-language tuning knob. */
  minGapSec?: number
  /** Ceiling (s) on how much of a qualifying gap survives — see
   *  `GapRemovalOptions.maxGapSec` (subtitle-align.ts). Use when the FULL gap
   *  (kept via a high `minGapSec`) plays too long, but cutting all the way
   *  down to the default tiny bridge would recreate an abrupt jump-cut. */
  maxGapSec?: number
  /** EXPERIMENTAL (owner is reviewing this on ch33 before any rollout).
   *  Split the clip into TWO acts at its longest internal silence and
   *  interleave them with the two halves of the reflection:
   *    video act 1 → reflection on point A → video act 2 → reflection on point B
   *  Each half then comments on what the viewer has JUST seen, instead of one
   *  long text after one long clip. Only takes effect when the point picker
   *  actually chose two points and the clip really contains an act break. */
  splitActs?: boolean
  /** Split this scene into a SERIES of standalone devotionals, one per beat.
   *
   *  Different from `splitActs`, which interleaves two acts inside ONE video.
   *  Owner feedback on that shape: viewers found the back-and-forth harder to
   *  follow than seeing a stretch of story whole. An episode instead gets its
   *  own clip window, its own on-screen verse, and its own reflection, and can
   *  be watched without the others.
   *
   *  The verse is what does the work. The point picker chooses the
   *  commentator's points by what the QUOTED VERSE says, so narrowing the verse
   *  to the beat on screen makes it select that beat's points on its own —
   *  nothing forces its hand. */
  episodes?: ChapterEpisode[]
}

/** One standalone devotional cut from a longer scene. See `episodes`. */
export type ChapterEpisode = {
  /** Shown on screen and handed to the point picker. */
  osisRef: string
  reference: string
  /** This beat's window, in the same coordinates as `clipStartSec`. */
  clipStartSec: number
  clipLengthSec: number
  /** What happens here, for whoever reads this file next. */
  note: string
  /** Read this beat with a named commentator instead of the book's default.
   *  See SelectReflectionInput.commentary for why this is a data decision. */
  commentary?: CommentaryPreference
}

export const JESUS_FILM_PASSAGES: ChapterPassage[] = [
  {
    index: 5,
    osisRef: "Luke.4.1-Luke.4.13",
    reference: "Luke 4:1-13",
    mood: "hope",
    themes: ["temptation", "trust", "faith", "obedience", "victory"],
    // Owner rule (established on "Jesus Feeds 5,000"): seed WIDE from the
    // setup, not just the reply — the old 52s start skipped the devil's own
    // offer ("If you are God's Son, order this stone to turn into bread,"
    // 40.6-47.5) and opened on Jesus's ANSWER only. `removeInternalGaps`
    // auto-trims any dead air this seed picks up per language.
    clipStartSec: 40,
    clipLengthSec: 58,
  }, // The Devil Tempts Jesus. Opens on the devil's offer (40.6s), through Jesus "It is written, man shall not live by bread alone," the kingdoms offer, ends on "him only shall you serve" (~98s). (whisper-verified)
  {
    index: 14,
    osisRef: "Luke.7.36-Luke.7.50",
    reference: "Luke 7:36-50",
    mood: "hope",
    themes: ["forgiveness", "grace", "love", "mercy", "repentance"],
    // Owner rule: seed WIDE. The old 91.5s start opened on the APPLICATION
    // ("You see this woman?") and skipped the actual parable Jesus tells
    // (the two debtors, 68-91s) and Simon's silent doubt that provokes it
    // (56.1s). The old end (131.5s) also cut the scene's own resolution,
    // "Your faith has saved you. Go in peace." (146.8-149.7s).
    // `removeInternalGaps` trims the ~12s dead gap around 129-142s.
    clipStartSec: 56,
    clipLengthSec: 94,
  }, // Sinful Woman Forgiven. Opens on Simon's doubt (56.1s) → the parable of the two debtors → "You see this woman" → ends on "Your faith has saved you. Go in peace." (~150s). (whisper-verified)
  {
    index: 19,
    osisRef: "Luke.8.22-Luke.8.25",
    reference: "Luke 8:22-25",
    mood: "peace",
    themes: ["storm", "fear", "peace", "trust", "faith"],
    // Owner rule: seed WIDE — include the narrated setup ("One day Jesus got
    // into a boat with His disciples... let us go to the other side," 2.1s)
    // instead of opening cold on the panic.
    clipStartSec: 2,
    clipLengthSec: 106,
    // The ~38s gap between "he fell asleep" (16.96s) and "Master! Master!"
    // (55.23s) is NOT dead air — it's the storm actually rising, shown
    // silently. At the default 10s threshold, `removeInternalGaps` cut that
    // down to a ~4.5s bridge, so the edited clip jump-cut straight from a calm
    // sea to the disciples already screaming (owner feedback: "он начался и
    // не успев развиться, ученики уже закричали"). The ~22s gap after the cry
    // (69.5s → 91.19s — Jesus rebuking the storm and it going calm) is real
    // content too.
    // First fix (minGapSec: 45) kept BOTH gaps in full — but that then ran
    // too long (owner: "я осознала, что шторм слишком длинный"). `maxGapSec`
    // caps each qualifying gap at 15s of kept buildup instead of all-or-
    // nothing: enough to feel the storm rising / the calm settling, without
    // either the abrupt old jump-cut or the full ~38s/~22s of silence.
    maxGapSec: 15,
  }, // Jesus Calms the Storm — "let us go to the other side" → storm/panic → disciples' cry → rebuke → calm → "where is your faith?"
  {
    index: 21,
    // Tightened from 9:10-17: verses 10-11 (apostles' return, Herod's guilty
    // conscience) aren't part of THIS scene and, worse, fall inside Ryle's
    // PRECEDING section ("The Apostles Return, Luke 9:7-11") — so the old
    // start point made Ryle-Luke routing pick that section instead of "Jesus
    // Feeds the Five Thousand, Luke 9:12-17". 9:12 is where the feeding itself
    // (and the clip, whisper-verified below) actually begins.
    osisRef: "Luke.9.12-Luke.9.17",
    reference: "Luke 9:12-17",
    mood: "peace",
    themes: ["provision", "compassion", "thanksgiving", "trust", "need"],
    // Owner rule (the scene this rule was ESTABLISHED on): the old 94s start
    // opened on the blessing and skipped the entire setup — Peter's request
    // ("Master, send the people away... so they can find food," 47.5s) and
    // the "you yourselves give them something to eat" exchange (74.2s).
    // Verified end-to-end (RU + EN dubs) with `removeInternalGaps`: cuts the
    // two real dead-air gaps (10.9s, 15.0s) around a 6.2s gap that stays
    // (< the 10s floor), landing at ~48-50s on-screen either language. Ends
    // right after "It's a miracle! Unbelievable!" (~114s).
    clipStartSec: 47,
    clipLengthSec: 67,
  }, // Jesus Feeds 5,000. Opens on Peter's request (47.5s) → "you give them to eat" → the blessing → the miracle → "It's a miracle! Unbelievable!" (~114s). (whisper-verified, RU+EN)
  {
    index: 31,
    // Tightened from 10:25-37: Ryle splits this into two DISTINCT sections —
    // 10:25-28 is the lawyer's lead-in question ("The Rule of Faith"), 10:29-37
    // is "The parable of the good Samaritan" itself. The old start point made
    // Ryle-Luke routing pick the lead-in section, never the parable. The clip
    // (whisper-verified) already opens mid-parable ("a priest came that way"),
    // so 10:29 loses nothing visually and fixes the reflection's source match.
    osisRef: "Luke.10.29-Luke.10.37",
    reference: "Luke 10:29-37",
    mood: "hope",
    themes: ["mercy", "love", "compassion", "kindness", "neighbour"],
    // Owner rule: seed WIDE. The old 36s start opened on "a priest came that
    // way," skipping the parable's own inciting incident — the man robbed
    // and left half dead (25.0-34.8s) — without which "a priest walked by"
    // has no stakes.
    clipStartSec: 25,
    clipLengthSec: 52,
  }, // Good Samaritan. Opens on the man robbed and left half dead (25.0s) → priest and Levite walk by → the Samaritan stops → ends after "whatever else you spend on him" (~77s, was cut mid-sentence). (whisper-verified)
  {
    index: 33,
    osisRef: "Luke.19.1-Luke.19.10",
    reference: "Luke 19:1-10",
    mood: "hope",
    themes: ["grace", "repentance", "salvation", "seeking", "mercy"],
    // Start unchanged (already snaps to the story's opening line, see below).
    // Owner rule: the old 89s END cut the scene's own resolution — "Salvation
    // has come to this house today! ...The Son of Man came to seek and to
    // save the lost" (121.8-131.3s) — which is the exact point of THIS
    // devotional. `removeInternalGaps` cuts the ~21s dead gap after the
    // pledge (90.5→111.3s) while the crowd reacts.
    clipStartSec: 39,
    clipLengthSec: 93,
    // This scene has a textbook act break: Jesus calls Zacchaeus down and the
    // crowd objects (37.9-62.6s), then 16.1s of silent walking to the house,
    // then the pledge and "Salvation has come to this house today" (78.7-
    // 131.3s). Those two acts map exactly onto Ryle's point 3 (Christ's
    // unasked initiative) and point 4 (conversion shows itself) — the pairing
    // the picker already chooses for Luke 19:10. Owner is reviewing this
    // structure here before deciding whether to enable it elsewhere.
    splitActs: true,
    // Owner is trying the SERIES shape here instead: two standalone videos over
    // the same scene, each whole, rather than one video that cuts back and
    // forth. The boundary is the 16.1s of silent walking, so neither episode
    // has to cut across a line of dialogue.
    //
    // Ryle's four points on Luke 19:1-10 divide cleanly between them, two each,
    // and the narrowed verse is what makes the picker find them:
    //   ep 1 · vv3-4 ("he ran ahead and climbed") → points 1 and 2 — no one is
    //          beyond grace, and how small the things are that a life turns on
    //   ep 2 · vv8-10 (the pledge, "salvation has come") → points 3 and 4 —
    //          Christ moves first unasked, and conversion shows itself
    episodes: [
      {
        // Must reach v5. The window plays through Jesus stopping and calling
        // Zacchaeus down, and that call is the hinge the reflection turns on —
        // with vv3-4 alone the coherence critic correctly blocked the run: the
        // verse on screen showed a man climbing a tree while the voice talked
        // about being called down from it.
        osisRef: "Luke.19.3-Luke.19.5",
        reference: "Luke 19:3-5",
        clipStartSec: 39,
        clipLengthSec: 30,
        note:
          "Zacchaeus wants to see Jesus, runs ahead, climbs the tree; Jesus " +
          "stops, looks up and calls him down, the crowd objects. It ENDS " +
          "there, on the invitation. Zacchaeus's pledge and Jesus's 'today " +
          "salvation has come to this house' are both in the next episode, so " +
          "the outcome of his conversion is off screen here.",
        // Owner's reading, and Henry is the commentator who states it: the
        // climb was not a small thing but a costly one. "He forgot his
        // gravity, as chief of the publicans, and ran before, like a boy."
        // Ryle, the default for Luke, calls the same climb mere curiosity and
        // then turns to how we should regard other people's first stirrings —
        // which is what kept pulling this episode away from the viewer.
        commentary: "henry",
      },
      {
        // Narrowed from 8-10. Verse 10 ("the Son of Man came to SEEK and to
        // save") points back at the calling, which is episode 1's footage, and
        // the reflection duly spent its first third re-telling a scene this
        // episode never shows. 8-9 is the pledge and Jesus's answer to it —
        // exactly what is on screen here.
        osisRef: "Luke.19.8-Luke.19.9",
        reference: "Luke 19:8-9",
        clipStartSec: 78.7,
        clipLengthSec: 52.6,
        note:
          "Opens INSIDE the house, on Zacchaeus's pledge: half his goods to " +
          "the poor, fourfold to anyone he defrauded. Then Jesus's answer, " +
          "'today salvation has come to this house'. The climb, the tree and " +
          "Jesus calling him down are all in the PREVIOUS episode and are not " +
          "on screen here. Raw window; removeInternalGaps cuts the ~21s " +
          "crowd-reaction gap to roughly 32s of content.",
        // Same commentator as episode 1. A two-part series read by two
        // different commentators changes vocabulary and emphasis halfway
        // through, which reads as two unrelated videos rather than one story.
        commentary: "henry",
      },
    ],
  }, // Jesus and Zaccheus. Seed for subtitle alignment: snaps to the story's opening line "In Jericho there was a tax collector named Zaccheus" (en 37.9s / ru 37.1s "И вот некто именем Закхей"), through the pledge, ends on "The Son of Man came to seek and to save the lost" (~131s). Earlier 44s seed snapped to the 2nd sentence "He wanted to see Jesus…" — mid-story, not the intro.
  {
    index: 55,
    osisRef: "Luke.23.44-Luke.23.49",
    reference: "Luke 23:44-49",
    mood: "lament",
    themes: ["cross", "sacrifice", "redemption", "sorrow", "forgiveness"],
    // Owner rule: seed WIDE. The old 44s start opened just AFTER "the curtain
    // of the temple was torn right down the middle" (40.3-44.1s), missing
    // that detail entirely. The old 94s end also cut off the centurion's full
    // declaration ("Glory be to God! Certainly this was a righteous Man,"
    // ends 96.1s). `removeInternalGaps` cuts the ~18s gap (44.1→62.2s) while
    // the darkness/silence holds, before Jesus's fragmented dying words.
    clipStartSec: 40,
    clipLengthSec: 57,
  }, // Death of Jesus — the temple curtain tears → "Father, into Your hands I commit My Spirit" → the centurion's declaration (~96s)
  {
    index: 59,
    osisRef: "Luke.24.36-Luke.24.49",
    reference: "Luke 24:36-49",
    mood: "awe",
    themes: ["resurrection", "hope", "joy", "peace", "victory"],
    clipStartSec: 30,
    clipLengthSec: 36,
  }, // Resurrected Jesus Appears. Opens on "Peace be with you" (~30s), shows his hands "it is I myself", ends on "these are the very things I spoke to you about" (~66s). (whisper-verified; was starting after "peace be with you" and cutting the commission mid-sentence)
]

const BY_INDEX = new Map(JESUS_FILM_PASSAGES.map((p) => [p.index, p]))

export function passageForChapter(
  index: number,
  episode?: number,
): ChapterPassage | null {
  const passage = BY_INDEX.get(index) ?? null
  if (!passage || episode === undefined) return passage
  // The RENDER re-reads this table by chapter index, so without the episode it
  // silently gets the whole scene's window — the clip card ran the full story
  // and the blurred background played episode 2's ending behind episode 1's
  // text. Generation narrowed correctly; only the render was blind to it.
  const beat = passage.episodes?.[episode - 1]
  if (!beat) return passage
  return {
    ...passage,
    osisRef: beat.osisRef,
    reference: beat.reference,
    clipStartSec: beat.clipStartSec,
    clipLengthSec: beat.clipLengthSec,
    splitActs: false,
  }
}

export type ChapterWithPassage = ChapterPassage & {
  id: string
  title: string
  /** Set only for an episode: what this beat actually shows. The point picker
   *  needs it, because a scene title alone ("Jesus and Zaccheus") describes the
   *  whole story and would let it choose a point whose events the viewer of
   *  THIS episode never sees. */
  episodeNote?: string
  /** Commentator override carried up from the episode. */
  commentary?: CommentaryPreference
}

/**
 * Join a passage entry with its catalog chapter (title + Arclight id).
 *
 * With `episode` (1-based), the chapter is narrowed to that beat: its window,
 * its verse range. Everything downstream — verse selection, point picking,
 * subtitle alignment, the clip trim — then works on the narrowed entry without
 * knowing episodes exist, which is why this is the only place that changes.
 * `splitActs` is dropped for an episode: an episode IS one act, so leaving it
 * on would ask the renderer to cut a single beat in half again.
 */
export function chapterWithPassage(
  index: number,
  episode?: number,
): ChapterWithPassage | null {
  const passage = BY_INDEX.get(index)
  const chapter = JESUS_FILM_CHAPTERS[index - 1]
  if (!passage || !chapter || chapter.index !== index) return null
  const base = { ...passage, id: chapter.id, title: chapter.title }
  if (episode === undefined) return base
  const beat = passage.episodes?.[episode - 1]
  if (!beat) {
    throw new Error(
      `chapter ${index} has no episode ${episode}` +
        (passage.episodes
          ? ` (it has ${passage.episodes.length})`
          : " (no episodes defined)"),
    )
  }
  return {
    ...base,
    osisRef: beat.osisRef,
    reference: beat.reference,
    clipStartSec: beat.clipStartSec,
    clipLengthSec: beat.clipLengthSec,
    splitActs: false,
    episodeNote: beat.note,
    ...(beat.commentary ? { commentary: beat.commentary } : {}),
  }
}

/** The chapters that currently have a passage mapping (the pipeline's pool). */
export function mappedChapterIndices(): number[] {
  return JESUS_FILM_PASSAGES.map((p) => p.index)
}
