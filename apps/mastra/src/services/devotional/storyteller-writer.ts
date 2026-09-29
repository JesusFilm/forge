import { z } from "zod"

import type { DevotionalLlm } from "./llm"
import type { ResearchBrief } from "./research-brief"
import {
  foreignWords,
  namedSources,
  shapeProblems,
  type WrittenParagraph,
} from "./message-first-writer"
import { checkReflectionVoice } from "./reflection-voice-check"

/**
 * The storyteller (owner, 2026-09-29): one writer, the strongest model, writes
 * the whole script in one voice from the researcher's brief and nothing
 * else: the spoken opening, the reflection, the takeaway, the question and
 * the prayer. Written separately, those five kept repeating each other.
 */

export type StoryScript = {
  title: string
  openingLines: string[]
  paragraphs: WrittenParagraph[]
  takeaway: string
  question: string
  prayer: string
}

const Schema = z
  .object({
    title: z.string().trim().min(1),
    openingLines: z.array(z.string().trim().min(1)),
    paragraphs: z.array(
      z
        .object({
          role: z.enum(["reflection", "history", "language", "classic"]),
          text: z.string().trim().min(1),
        })
        .strict(),
    ),
    takeaway: z.string().trim().min(1),
    question: z.string().trim().min(1),
    prayer: z.string().trim().min(1),
  })
  .strict()

const str = { type: "string" } as const
const JSON_SCHEMA = {
  name: "storyteller_script",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: str,
      openingLines: { type: "array", items: str },
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
            text: str,
          },
          required: ["role", "text"],
        },
      },
      takeaway: str,
      question: str,
      prayer: str,
    },
    required: [
      "title",
      "openingLines",
      "paragraphs",
      "takeaway",
      "question",
      "prayer",
    ],
  },
}

export const SYSTEM_PROMPT = [
  "You are the STORYTELLER of Daily Bible Pause, a Bible devotional video for",
  "people who already follow Jesus. The viewer watches a film scene that reads",
  "the Gospel passage word for word, and then hears you. Your text is spoken",
  "by a synthetic voice and heard once, never read: write for the ear. Short",
  "sentences, one thought each, plain words, concrete pictures from the story.",
  "",
  "You write from the RESEARCH BRIEF and nothing else. It holds the message,",
  "the commentator's points and a few facts, each checked against its source.",
  "Do not add a fact, custom, number, date, word meaning or detail of the",
  "story that is not in the brief or the passage. Your craft is in choosing,",
  "ordering and telling, never in adding.",
  "",
  "THE SCRIPT:",
  "- title: two to six words, the story's tension as the viewer feels it.",
  "  It does not give the answer away.",
  "- openingLines: three or four short lines spoken over a montage before the",
  "  film (after 'Welcome to Daily Bible Pause.', before 'Let's watch.'). The",
  "  first line is the title. Open on the tension; the last line points at the",
  "  story about to play. Never give the answer away.",
  "- paragraphs: the reflection, heard after 'Let's look more closely at what",
  "  this story means.' 350 to 500 words in 10 to 16 short paragraphs.",
  "- takeaway: the one sentence the viewer carries away, under 20 words.",
  "- question: spoken after 'First, ask yourself:'. One personal question for",
  "  this week, built from the reflection's own images.",
  "- prayer: spoken after 'Talk to God about it:'. One or two short sentences",
  "  telling the viewer what to bring to God, in the second person.",
  "The takeaway, question and prayer each say something the reflection has",
  "not said in those words: none repeats a sentence or phrase from it.",
  "",
  "HOW THE REFLECTION MOVES:",
  "- Open on the people: the human tension of the scene (who is hungry,",
  "  ashamed, angry, and why it does not sit right). Never open on a fact.",
  "- Weave the facts into ONE or TWO developed blocks. Each block starts from",
  "  a moment in the scene, gives the context that explains it, and at once",
  "  says what it means for the message. Facts that serve one idea sit",
  "  together. Never set facts side by side and leave the listener to",
  "  connect them.",
  "- Do not retell the film: point to a detail and say what it means. At most",
  "  one sentence of plain retelling in a row.",
  "- The commentator's insight gives the turn, retold as your own thought.",
  "- Say each idea once, well. Do not restate the main point in new words",
  "  two or three times; move the thought forward instead.",
  "- End on the viewer and on Christ, with a statement, never a command.",
  "",
  "ROLES: tag each paragraph with what it draws on: 'history' (a history fact),",
  "'language' (the Greek fact), 'classic' (the commentator's points),",
  "'reflection' (your own voice). One role per paragraph: a fact sits in its",
  "own paragraph (credited on screen), your meaning in the next.",
  "",
  "THE OWNER'S STANDING RULES:",
  "- Never name a source aloud: no commentator, book, dictionary, lexicon.",
  "  They are credited on screen. Retell, never quote the commentator; state",
  "  a rabbinic saying as 'a saying the rabbis later recorded', never as what",
  "  everyone believed; Luke may be named as the Gospel's author.",
  "- Never say a Greek or Hebrew word in any spelling: point at the verse and",
  "  its English words, then say what the original means there ('In verse 20",
  "  the father was filled with compassion. The word Luke uses there means...').",
  "- What a character CLAIMS is his claim, not the narrator's fact: say who",
  "  says what.",
  "- Describe, don't command: no imperatives, no 'we must', 'let us', 'you",
  "  should'. A gentle 'notice' or 'look at' is fine.",
  "- The audience already follows Jesus: deepen, never evangelize or question",
  "  whether they are saved.",
  "- No denominational polemic, no predestination, no judgement of Judaism or",
  "  the rabbis.",
  "- No Bible references in parentheses; say a verse in words if it matters.",
  "- No em dashes or en dashes anywhere.",
  "Return JSON only.",
].join("\n")

export function briefBlock(
  brief: ResearchBrief,
  passage: { reference: string; text: string },
  settingText?: string,
) {
  return [
    `PASSAGE (${passage.reference}, BSB), which the viewer just watched:`,
    passage.text,
    ...(settingText
      ? ["", "SETTING (who Jesus is speaking to):", settingText]
      : []),
    "",
    "RESEARCH BRIEF",
    `Message: ${brief.message.idea}`,
    `Tension: ${brief.message.tension}`,
    `The closing question points toward: ${brief.message.askDirection}`,
    `Grounding: ${brief.message.grounding}`,
    "",
    "Commentator's points (retell, do not name him):",
    ...brief.classicPoints.map((p, i) => `(${i + 1}) ${p}`),
    "",
    "History facts (checked):",
    ...(brief.history.length
      ? brief.history.map(
          (f) =>
            `- ${f.claim} Source words: "${f.quote}". What it shows: ${f.why}`,
        )
      : ["- none"]),
    "Language fact (checked):",
    brief.language
      ? `- ${brief.language.verseRef}, the words "${brief.language.englishPhrase}": ${brief.language.meaning} Source words: "${brief.language.quote}". What it shows: ${brief.language.why}`
      : "- none",
  ].join("\n")
}

/** Phrases of six words or more said twice anywhere in the script. */
export function repeatedPhrases(
  script: Pick<StoryScript, "paragraphs" | "takeaway" | "question" | "prayer">,
  n = 6,
): { rule: string; sentence: string; why: string }[] {
  const parts = [
    ...script.paragraphs.map((p, i) => ({
      where: `paragraph ${i + 1}`,
      text: p.text,
    })),
    { where: "takeaway", text: script.takeaway },
    { where: "question", text: script.question },
    { where: "prayer", text: script.prayer },
  ]
  const seen = new Map<string, string>()
  const out: { rule: string; sentence: string; why: string }[] = []
  for (const part of parts) {
    const w = part.text
      .toLowerCase()
      .replace(/[^a-z' ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
    const mine = new Set<string>()
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n).join(" ")
      if (mine.has(g)) continue
      mine.add(g)
      const first = seen.get(g)
      if (first && first !== part.where) {
        out.push({
          rule: "repeats-itself",
          sentence: `${part.where}: “${g}”`,
          why: `already said in ${first}; say it once, or say something new here`,
        })
        break
      }
      if (!first) seen.set(g, part.where)
    }
  }
  return out
}

export function scriptProblems(s: StoryScript, brief: ResearchBrief) {
  const reflection = s.paragraphs.map((p) => p.text).join("\n\n")
  return [
    ...checkReflectionVoice(reflection, { lang: "en", conclusion: s.takeaway }),
    ...foreignWords(
      [reflection, s.takeaway, s.question, s.prayer].join("\n"),
      brief.language,
    ),
    ...namedSources([reflection, s.takeaway, s.question, s.prayer].join("\n")),
    ...shapeProblems(s.paragraphs),
    ...repeatedPhrases(s),
  ]
}

export async function writeStory(input: {
  brief: ResearchBrief
  passage: { reference: string; text: string }
  settingText?: string
  llm: DevotionalLlm
  /** The previous script and what must change (a check or the owner). */
  revise?: { script: StoryScript; problems: string[] }
}): Promise<StoryScript> {
  const user = [
    briefBlock(input.brief, input.passage, input.settingText),
    ...(input.revise
      ? [
          "",
          "YOUR PREVIOUS SCRIPT:",
          JSON.stringify(input.revise.script),
          "",
          "Fix each of these where it occurs and change as little else as you",
          "can; keep every role, and return the full script. Paragraph",
          "numbers count from 1:",
          ...input.revise.problems.map((p) => `- ${p}`),
        ]
      : []),
  ].join("\n")
  return input.llm.complete({
    system: SYSTEM_PROMPT,
    user,
    jsonSchema: JSON_SCHEMA,
    schema: Schema,
    temperature: input.revise ? 0.3 : 0.7,
    maxTokens: 5000,
  })
}

export const _internal = { JSON_SCHEMA }
