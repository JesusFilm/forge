import { quoteTranscript } from "./subtitle-align"

/**
 * The clip is the story's FIRST ACT — shared prompt framing for every writer.
 *
 * Owner's framing, and the reason this module exists at all: a devotional is
 * one continuous piece — cover, clip, reflection, closing takeaway, question,
 * prayer, in that order — not a video with commentary bolted on. The clip
 * itself tells part of the story, so a writer who knows how the story OPENS
 * can offer the continuation instead of starting over.
 *
 * The first version of this threading told the writer "do not repeat these
 * lines", buried at the bottom of the prompt. Measured across five chapters
 * (ch7, 14, 17, 18, 19) the depth critic raised `retells-scene` on four of
 * them anyway — a prohibition tells the model what NOT to write and leaves it
 * to guess what to write instead, and the guess was narration. So the block
 * moved to the TOP of every writer's prompt and became a positive brief:
 * here is act one, your part is act two.
 *
 * Returns an EMPTY array when there is no transcript, so a run whose subtitle
 * fetch failed gets byte-identical prompts to before this existed.
 * `fetchClipTranscript` is best-effort by contract, so that path is normal.
 */
export function clipStoryBlock(
  clipTranscript: string | undefined,
  /** What THIS writer contributes next — the one part that differs per seam. */
  role: ReadonlyArray<string>,
): string[] {
  if (!clipTranscript) return []
  return [
    "ACT ONE — THE STORY HAS ALREADY STARTED.",
    "This is the clip the viewer just watched and heard, word for word:",
    `"${quoteTranscript(clipTranscript)}"`,
    "",
    "The cover, that clip, the reflection, the closing takeaway, the question",
    "and the prayer are ONE continuous piece, in that order. The viewer already",
    "has everything in the text above: those events, those words, that ending.",
    "What they do not have yet is what it means for them.",
    ...role,
    "",
  ]
}

/** The reflection's part of the arc: act two. */
export const REFLECTION_ROLE = [
  "YOUR PART IS WHAT COMES NEXT. Continue this story; do not re-tell it.",
  "Any sentence that reports an event or repeats a line from the text above is",
  "a sentence the viewer has already heard, and it spends the one chance you",
  "had to say something they haven't. Start where the clip stops: it ends at",
  "what happened, so you begin at what is therefore true.",
] as const

/** The cover/question/prayer's part of the arc: the way in, and where it lands. */
export const COPY_ROLE = [
  "The title is the way IN to this story — what makes someone stop and watch",
  "the clip above — never a summary of it. The question and the prayer are",
  "where the story lands in the viewer's own life. None of the three restates",
  "an event or a line from the clip; the viewer has just heard those.",
] as const

/** The closing takeaway's part of the arc: the last line of it. */
export const CONCLUSION_ROLE = [
  "Your closing takeaway is the LAST line of this arc. It lands what the clip",
  "opened and the reflection developed: one sentence of what is true now, not",
  "a recap of what happened on screen.",
] as const
