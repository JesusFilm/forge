/**
 * Display cleanup for transcript-chunk snippets on Watch Search cards.
 *
 * Semantic hits use the winning transcript chunk as the card snippet. Caption
 * tracks carry non-speech cues (`[MUSIC]`, `[INAUDIBLE]`, `(upbeat music)`)
 * and `>>` speaker-change markers. A chunk made only of those rendered as
 * `[MUSIC] [MUSIC] [INAUDIBLE] >> [INAUDIBLE] …` (feat-760), which reads as
 * broken and hides why the result matched.
 *
 * Display only: ranking, retrieval, scores and `startSeconds` never read this.
 * The cue vocabulary is closed on purpose so editorial brackets such as
 * `[He] said` or `(John 3:16)` survive.
 */

const CUE_WORDS = [
  "applause",
  "blank_audio",
  "cheering",
  "foreign",
  "inaudible",
  "laughing",
  "laughs",
  "laughter",
  "music",
  "noise",
  "silence",
  "sighs",
  "singing",
] as const

// A bracketed or parenthesised cue: the cue word with up to three short
// qualifiers around it, e.g. `[MUSIC PLAYING]`, `(intense music)`,
// `[SOFT MUSIC]`. Anything longer is treated as real text.
const CAPTION_CUE = new RegExp(
  String.raw`[\[(]\s*(?:[\p{L}'-]+\s+){0,3}(?:${CUE_WORDS.join("|")})(?:\s+[\p{L}'-]+){0,3}\s*[\])]`,
  "giu",
)
const SPEAKER_CHANGE = /(?:^|\s)>>+(?=\s|$)/gu
const LEADING_SEPARATORS = /^[\s\-–—:.,;…]+/u
const HAS_WORD = /[\p{L}\p{N}]/u

/**
 * Returns the snippet without caption cues, or `null` when nothing readable
 * is left so the caller can fall back to the localized description.
 */
export function displayTranscriptSnippet(
  snippet: string | null | undefined,
): string | null {
  if (snippet == null) return null
  const cleaned = snippet
    .replace(CAPTION_CUE, " ")
    .replace(SPEAKER_CHANGE, " ")
    .replace(/\s+/gu, " ")
    .replace(LEADING_SEPARATORS, "")
    .trim()
  return HAS_WORD.test(cleaned) ? cleaned : null
}
