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

/** One spoken line of the opening, designed with what the viewer sees. */
export type OpeningLine = {
  line: string
  /** The moment of the film that should be on screen under this line. */
  visual: string
  /** Words set large on screen, or "" for none. */
  onScreen: string
}

export type StoryScript = {
  title: string
  /** The one promise every title and cover variant must express; the
   *  opening confirms it in its first seconds, so one opening serves them
   *  all (owner, 2026-09-30). */
  promise: string
  opening: OpeningLine[]
  paragraphs: WrittenParagraph[]
  takeaway: string
  question: string
  prayer: string
}

const OpeningSchema = z
  .object({
    line: z.string().trim().min(1),
    visual: z.string().trim().min(1),
    onScreen: z.string().trim(),
  })
  .strict()

const Schema = z
  .object({
    title: z.string().trim().min(1),
    promise: z.string().trim().min(1),
    opening: z.array(OpeningSchema),
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
const OPENING_JSON = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { line: str, visual: str, onScreen: str },
    required: ["line", "visual", "onScreen"],
  },
} as const
const JSON_SCHEMA = {
  name: "storyteller_script",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: str,
      promise: str,
      opening: OPENING_JSON,
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
      "promise",
      "opening",
      "paragraphs",
      "takeaway",
      "question",
      "prayer",
    ],
  },
}

/**
 * The spoken opening (owner, 2026-09-30, from YouTube retention feedback and
 * an intro guide): confirm the click at once, create one unresolved question,
 * say what the devotional holds without saying what it means, and hand over
 * to the film. Shared by the writer and by writeOpening.
 */
export const OPENING_RULES = [
  "THE OPENING: four short lines (five at most) spoken over the film's own shots,",
  "before 'Let's watch.' (added for you: do not write it). No greeting, no",
  "channel name, no 'in this video', no 'stay tuned' or 'keep watching'.",
  "Voice and picture are designed together: for each line give the moment",
  "of THIS film that should be on screen (a person, an action, a detail the",
  "passage names) and, when it helps, two to four words set large on screen",
  '(onScreen), else "". Muted, the shots and words alone should tell what',
  "the video is about. On-screen words are claims too: only what the",
  "passage or the reflection says. About 12 to 15 seconds: at most 40",
  "words in all, 12 per line.",
  "  1. PROMISE, the first line, under ten words: the promise in the scene,",
  "     with a person in it. The viewer knows at once this is the video they",
  "     clicked. Do not quote the title.",
  "  2. CONTEXT AND GAP, one line: the one fact the tension turns on, set",
  "     against the promise so it lands as a contradiction the viewer",
  "     cannot resolve yet.",
  "     Do not retell the plot: the film is about to show it. Name the one",
  "     fact the tension turns on, and leave the rest for the film.",
  "     Recognition, never shame: the viewer thinks 'I know this', not",
  "     'this video is judging me'.",
  "  3. PREVIEW, one line that starts 'In this devotional': the devotional's",
  "     strongest finding (the language or history note), named by WHERE it",
  "     is and WHAT it concerns, never by what it means ('one word in the",
  "     father's last sentence, and what it says about the party'). Promise",
  "     only what the reflection delivers, in the reflection's own terms.",
  "  4. BRIDGE, the last line: points at the story about to play, so the",
  "     film feels like the answer beginning. A statement, not a command,",
  "     and not the word 'watch': 'Let's watch.' follows it.",
  "Do not reuse the reflection's wording: the viewer hears both.",
  "Never give the takeaway or the answer to the gap away.",
]

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
  "- promise: one sentence, the tension that made this devotional worth",
  "  clicking (from the brief's tension). Every title and cover is written",
  "  from it, so the opening confirms it without repeating any one title.",
  "- title: two to six words, the promise as the viewer feels it. It does",
  "  not give the answer away.",
  "- opening: see THE OPENING below.",
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
  ...OPENING_RULES,
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

/** The opening's shape, checked in code: what a rule says, code enforces. */
export function openingProblems(
  opening: ReadonlyArray<OpeningLine>,
  /** The reflection the opening previews: its wording must not be reused. */
  reflection?: ReadonlyArray<{ text: string }>,
): { rule: string; sentence: string; why: string }[] {
  const out: { rule: string; sentence: string; why: string }[] = []
  const lines = opening.map((o) => o.line)
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length
  // About 12 to 15 seconds at the reading pace, and each line short enough to
  // hear once: long lines are where the plot retelling crept back in.
  const total = lines.reduce((n, l) => n + words(l), 0)
  if (total > 40)
    out.push({
      rule: "opening-too-long",
      sentence: `${total} words`,
      why: "the whole opening is 40 words or fewer (12 to 15 seconds); cut the plot, keep the tension",
    })
  for (const l of lines) {
    const max = /^\s*in this devotional\b/i.test(l) ? 14 : 12
    if (words(l) > max)
      out.push({
        rule: "opening-line-too-long",
        sentence: l,
        why: `a line of the opening is ${max} words or fewer`,
      })
  }
  const bridge = lines[lines.length - 1]
  if (bridge && /\bwatch\b/i.test(bridge))
    out.push({
      rule: "opening-bridge",
      sentence: bridge,
      why: "'Let's watch.' follows the bridge; do not say watch twice or tell the viewer what to do",
    })
  if (reflection?.length) {
    const grams = (t: string, n: number) => {
      const w = t
        .toLowerCase()
        .replace(/[^a-z' ]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
      return new Set(
        Array.from({ length: Math.max(0, w.length - n + 1) }, (_, i) =>
          w.slice(i, i + n).join(" "),
        ),
      )
    }
    const said = grams(reflection.map((p) => p.text).join(" "), 5)
    for (const l of lines) {
      const hit = [...grams(l, 5)].find((g) => said.has(g))
      if (hit)
        out.push({
          rule: "opening-reuses-reflection",
          sentence: `${l} (“${hit}”)`,
          why: "the reflection says this later in the same words; say it differently",
        })
    }
  }
  if (lines.length < 4 || lines.length > 5)
    out.push({
      rule: "opening-length",
      sentence: `${lines.length} line(s)`,
      why: "the opening is four lines, five at most",
    })
  if (lines[0] && words(lines[0]) >= 10)
    out.push({
      rule: "opening-promise",
      sentence: lines[0],
      why: "the first line is the promise, under ten words",
    })
  for (const l of lines) {
    if (
      /\b(welcome|hello|in this video|stay tuned|keep watching|let's get into|watch the full)\b/i.test(
        l,
      ) ||
      /^\s*let'?s watch\.?\s*$/i.test(l)
    )
      out.push({
        rule: "opening-no-teaser-talk",
        sentence: l,
        why: "no greeting or teaser phrases, and 'Let's watch.' is added for you",
      })
  }
  const previews = lines.filter((l) => /^\s*in this devotional\b/i.test(l))
  if (previews.length !== 1)
    out.push({
      rule: "opening-preview",
      sentence: `${previews.length} preview line(s)`,
      why: "exactly one line starts 'In this devotional'",
    })
  if (previews.length === 1 && lines.indexOf(previews[0]) === lines.length - 1)
    out.push({
      rule: "opening-bridge",
      sentence: previews[0],
      why: "the last line points at the story, after the preview",
    })
  return out
}

export function scriptProblems(s: StoryScript, brief: ResearchBrief) {
  const reflection = s.paragraphs.map((p) => p.text).join("\n\n")
  const opening = s.opening.map((o) => o.line).join("\n")
  return [
    ...openingProblems(s.opening, s.paragraphs),
    ...foreignWords(opening, brief.language),
    ...namedSources(opening),
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

const OpeningOnlySchema = z
  .object({
    promise: z.string().trim().min(1),
    opening: z.array(OpeningSchema),
  })
  .strict()
const OPENING_ONLY_JSON = {
  name: "storyteller_opening",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { promise: str, opening: OPENING_JSON },
    required: ["promise", "opening"],
  },
}

/**
 * Rewrite ONLY the opening of a finished devotional, under the same rules the
 * writer follows, so a published piece can get a new intro without touching
 * the reflection it previews.
 */
export async function writeOpening(input: {
  passage: { reference: string; text: string }
  message: { idea: string; tension: string }
  title: string
  paragraphs: ReadonlyArray<{ role?: string; text: string }>
  takeaway: string
  llm: DevotionalLlm
  revise?: {
    opening: { promise: string; opening: OpeningLine[] }
    problems: string[]
  }
}): Promise<{ promise: string; opening: OpeningLine[] }> {
  const user = [
    `PASSAGE (${input.passage.reference}, BSB), the film that follows:`,
    input.passage.text,
    "",
    `Message: ${input.message.idea}`,
    `Tension: ${input.message.tension}`,
    `Current title (one of several being tested): ${input.title}`,
    "",
    "THE REFLECTION the opening previews (do not change it):",
    ...input.paragraphs.map(
      (p, i) => `[${i + 1}]${p.role ? ` (${p.role})` : ""} ${p.text}`,
    ),
    `Takeaway (never give it away): ${input.takeaway}`,
    ...(input.revise
      ? [
          "",
          "YOUR PREVIOUS OPENING:",
          JSON.stringify(input.revise.opening),
          "Fix each of these and change as little else as you can:",
          ...input.revise.problems.map((p) => `- ${p}`),
        ]
      : []),
  ].join("\n")
  return input.llm.complete({
    system: [
      "You write the spoken opening of Daily Bible Pause, a Bible devotional",
      "video for people who already follow Jesus. It is heard once, by a",
      "synthetic voice: short sentences, plain words, concrete pictures.",
      "Use only what the passage and the reflection below contain.",
      "",
      "- promise: one sentence, the tension that made this devotional worth",
      "  clicking. Every title and cover is written from it.",
      ...OPENING_RULES,
      "No em dashes or en dashes. Never name a source aloud, never say a",
      "Greek or Hebrew word. Return JSON only.",
    ].join("\n"),
    user,
    jsonSchema: OPENING_ONLY_JSON,
    schema: OpeningOnlySchema,
    temperature: input.revise ? 0.3 : 0.7,
    maxTokens: 1500,
  })
}

export const _internal = { JSON_SCHEMA }
