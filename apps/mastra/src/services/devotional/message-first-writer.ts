import { z } from "zod"

import type { ContextFact, LanguageNote } from "./depth-research"
import { messageBlock, type DevotionalMessage } from "./devotional-message"
import type { DevotionalLlm } from "./llm"
import { checkReflectionVoice } from "./reflection-voice-check"

/**
 * The writer of the message-first path (feat-572). One continuous reflection
 * built from the message, the classic's points and the verified depth notes,
 * returned as paragraphs tagged with what each one draws on, so the source
 * credits and the evidence the narrative editor checks come from the writer's
 * own account of where each paragraph came from.
 */

export type ParagraphRole = "reflection" | "history" | "language" | "classic"

export type WrittenParagraph = { role: ParagraphRole; text: string }

const Schema = z
  .object({
    paragraphs: z.array(
      z
        .object({
          role: z.enum(["reflection", "history", "language", "classic"]),
          text: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict()

const JSON_SCHEMA = {
  name: "message_first_reflection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      paragraphs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            role: {
              type: "string",
              enum: ["reflection", "history", "language", "classic"],
            },
            text: { type: "string" },
          },
          required: ["role", "text"],
        },
      },
    },
    required: ["paragraphs"],
  },
}

export const SYSTEM_PROMPT = [
  "You write the spoken REFLECTION of a Bible devotional video. The viewer has",
  "just watched a film scene that reads the passage word for word. Two voices",
  "read your text: the main voice, and a second voice for the historical and",
  "language paragraphs. It is heard, not read: short sentences, one thought",
  "each, plain words.",
  "",
  "You are given THE MESSAGE the piece serves, the passage, the classic",
  "commentator's points, and research notes that have been checked against",
  "their sources. Build ONE line of thought that carries the viewer from what",
  "they just watched to the message. Every paragraph must move that line on.",
  "Use a research note only where it serves the line, and when you use one,",
  "say in the next sentence what it changes about the moment in the story.",
  "A note that does not clearly bear on the message is left out.",
  "Do not retell the story the viewer just watched: point to a detail and",
  "say what it means. At most one sentence of plain retelling in a row.",
  "",
  "SHAPE (a guide, not a template):",
  "- Open on the tension: the detail that does not sit right, stated plainly.",
  "- History and language paragraphs explain the world and the words so the",
  "  story lands as its first hearers heard it.",
  "- The classic commentator's insight gives the turn, retold in the",
  "  devotional's own voice.",
  "- The last paragraphs bring it to the viewer and to Christ, and end on a",
  "  statement, never on a command or an audit of their faith.",
  "",
  "ROLES: tag each paragraph with what it draws on: 'history' (a context",
  "note), 'language' (the Greek note), 'classic' (the commentator's points),",
  "'reflection' (your own connective or applied voice). A paragraph has ONE",
  "role; split it when it would need two. 'classic' is ONLY for paragraphs",
  "that carry the commentator's own claims, and it is checked against him:",
  "your own observations, however natural, are 'reflection'.",
  "Any sentence that uses a research note sits in a paragraph with that",
  "note's role, so it is credited on screen.",
  "",
  "THE STORY: every detail about what happens must match the passage exactly:",
  "who ran, who went out, who spoke, what was said, in what order. Do not",
  "improve the story with a parallel or a detail it does not have. What a",
  "character CLAIMS is his claim, not a fact: the narrator says the younger",
  "son squandered his wealth in wild living; the prostitutes are his",
  "brother's accusation. Say who says what.",
  "",
  "SOURCES:",
  "- History and language paragraphs may say only what their note says. No",
  "  added numbers, dates, customs or word meanings from memory.",
  "- A history paragraph carries ONE fact and ENDS on what that fact means",
  "  for this story: what the character gave up, risked or broke. Never set",
  "  two facts side by side and leave the listener to connect them (owner,",
  "  2026-09-29: 'he gave, and he ran: so what?'). A fact whose meaning the",
  "  source does not support is left out, however well known.",
  "- Never announce a section ('now some historical context', 'let's look at",
  "  the Greek'). Move into it with a natural sentence.",
  "- NEVER NAME A SOURCE in the spoken text: no commentator ('Ryle says'),",
  "  no dictionary, lexicon or book title. Every source is credited on",
  "  screen while its paragraph plays, and the video's description says",
  "  the reflection is adapted from the commentator (owner, 2026-09-29): time",
  "  spent saying where a thing comes from is time not spent on the thing.",
  "  Retell the commentator's thought as the devotional's own. For an ancient",
  "  text, say what was advised or believed then ('Jewish wisdom of that time",
  "  advised fathers...'), never as what everyone did. Luke may be named as",
  "  the Gospel's author ('the word Luke uses').",
  "- NEVER say a Greek or Hebrew word, in any spelling: the synthetic voice",
  "  cannot pronounce it, and a strange word tells the listener nothing about",
  "  where it is. Point at the place instead: the verse and its English words,",
  "  then what the original says there. For example: 'In verse 20 the father",
  "  was filled with compassion. The word Luke uses there means to feel pity,",
  "  to be moved with compassion.' Say 'the word Luke uses' or 'in the",
  "  original', not the word itself.",
  "- No quotation marks around the commentator's words: they are adapted,",
  "  not quoted, so paraphrase them in plain modern speech.",
  "- Bible references in parentheses are not read aloud later; do not use",
  "  them. If a verse matters, say it in words.",
  "",
  "VOICE RULES (owner's standing rules):",
  "- The audience already follows Jesus. Deepen, do not evangelize.",
  "- DESCRIBE, DON'T COMMAND: a synthetic voice must not order the viewer",
  "  about. No imperatives, no 'we must', no 'let us', no 'you should'. State",
  "  what is true and let it land. A gentle 'notice' or 'look at' to point",
  "  the eye is fine.",
  "- No denominational polemic; no predestination; no 'lives for you'",
  "  phrasing about Christ (use intercession wording).",
  "- Keep the order of events and who someone was: the detail a point rests",
  "  on stays.",
  "- No sentence that could sit in any devotional about any passage.",
  "- No em dashes or en dashes anywhere.",
  "",
  "LENGTH: 420 to 560 words in 10 to 16 short paragraphs. Return JSON only.",
].join("\n")

/** The note's Greek, in any of its spellings, said aloud: the voice cannot
 *  pronounce it (owner, 2026-09-29). */
export function foreignWords(
  text: string,
  note?: LanguageNote,
): { rule: string; sentence: string; why: string }[] {
  if (!note) return []
  const strip = (w: string) =>
    w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  const forms = [note.greek, note.lemma, note.translit]
    .filter(Boolean)
    .map(strip)
    .map((f) => f.slice(0, Math.max(5, f.length - 3)))
  const hits = text.split(/(?<=[.!?])\s+/).filter((s) =>
    strip(s)
      .split(/[^\p{L}]+/u)
      .some((w) => w.length >= 5 && forms.some((f) => w.startsWith(f))),
  )
  return hits.map((sentence) => ({
    rule: "foreign-word",
    sentence,
    why: "says the Greek word aloud; point at the verse's English words and say what the original means there",
  }))
}

/** Sources named aloud (owner, 2026-09-29: they are credited on screen). */
export const SOURCE_NAMES = [
  "Ryle",
  "Sirach",
  "Ben Sira",
  "Ecclesiasticus",
  "Easton",
  "Smith's",
  "Abbott-Smith",
  "lexicon",
  "dictionary",
  "commentator",
  "Henry",
  "Spurgeon",
]

export function namedSources(
  text: string,
): { rule: string; sentence: string; why: string }[] {
  const re = new RegExp(`\\b(?:${SOURCE_NAMES.join("|")})\\b`, "i")
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => re.test(s))
    .map((sentence) => ({
      rule: "names-source",
      sentence,
      why: "names a source aloud; it is credited on screen, so say the thing itself",
    }))
}

export async function writeMessageFirstReflection(input: {
  message: DevotionalMessage
  passageReference: string
  passageText: string
  settingText?: string
  classicName: string
  classicPoints: string[]
  context: ContextFact[]
  language?: LanguageNote
  llm: DevotionalLlm
  log?: (m: string) => void
}): Promise<WrittenParagraph[]> {
  const user = [
    messageBlock(input.message),
    "",
    `PASSAGE (${input.passageReference}, BSB), which the viewer just watched:`,
    input.passageText,
    ...(input.settingText
      ? ["", "SETTING (who Jesus is speaking to):", input.settingText]
      : []),
    "",
    `CLASSIC COMMENTATOR: ${input.classicName}. His points:`,
    ...input.classicPoints.map((p, i) => `(${i + 1}) ${p}`),
    "",
    "RESEARCH NOTES (verified against the sources):",
    ...(input.context.length
      ? input.context.map(
          (f) =>
            `- HISTORY (${f.source}, "${f.term}"): ${f.claim} Source words: "${f.quote}". Why it matters: ${f.why}`,
        )
      : ["- HISTORY: none worth adding."]),
    input.language
      ? `- LANGUAGE (Abbott-Smith lexicon), ${input.language.verseRef}, the words "${input.language.englishPhrase}": ${input.language.meaning} Source words: "${input.language.quote}". Why it matters: ${input.language.why} (Do not say the Greek word.)`
      : "- LANGUAGE: none worth adding.",
  ].join("\n")
  const ask = (u: string) =>
    input.llm.complete({
      system: SYSTEM_PROMPT,
      user: u,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0.6,
      maxTokens: 3000,
    })
  let out = (await ask(user)).paragraphs
  // The owner's voice rules are checked mechanically, as for the modernizer;
  // two repair rounds with the exact sentences that broke them.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = out.map((p) => p.text).join("\n\n")
    const broken = [
      ...checkReflectionVoice(text, { lang: "en" }),
      ...foreignWords(text, input.language),
      ...namedSources(text),
    ]
    if (broken.length === 0) break
    input.log?.(
      `   ↻ voice repair ${attempt}/2: ${broken.map((b) => b.rule).join(", ")}`,
    )
    out = (
      await ask(
        [
          user,
          "",
          "Your previous reflection:",
          JSON.stringify({ paragraphs: out }),
          "",
          "It broke rules that are checked mechanically. Rewrite ONLY these sentences, keep everything else word for word:",
          ...broken.map((b) => `- “${b.sentence}”: ${b.why}`),
        ].join("\n"),
      )
    ).paragraphs
  }
  return out
}

/** One targeted rewrite for problems a check found (the checks used to only
 *  reject; their reasons now come back to the writer). Only the sentences the
 *  problems name should change. */
export async function reviseMessageFirstReflection(input: {
  paragraphs: WrittenParagraph[]
  problems: string[]
  message: DevotionalMessage
  passageReference: string
  passageText: string
  classicName: string
  classicPoints: string[]
  llm: DevotionalLlm
}): Promise<WrittenParagraph[]> {
  const out = await input.llm.complete({
    system: SYSTEM_PROMPT,
    user: [
      messageBlock(input.message),
      "",
      `PASSAGE (${input.passageReference}, BSB):`,
      input.passageText,
      "",
      `CLASSIC COMMENTATOR: ${input.classicName}. His points:`,
      ...input.classicPoints.map((p, i) => `(${i + 1}) ${p}`),
      "",
      "YOUR REFLECTION:",
      JSON.stringify({ paragraphs: input.paragraphs }),
      "",
      "Reviewers found these problems. Fix each one where it occurs, changing",
      "as little as possible; keep every other sentence and every role as it",
      "is, unless a problem is about the role. Return the full reflection.",
      ...input.problems.map((p) => `- ${p}`),
    ].join("\n"),
    jsonSchema: JSON_SCHEMA,
    schema: Schema,
    temperature: 0.3,
    maxTokens: 3000,
  })
  return out.paragraphs
}

export const _internal = { JSON_SCHEMA }
