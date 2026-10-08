import { z } from "zod"

import {
  auditClaims,
  entryExcerpt,
  FUNCTION_LEMMAS,
  type ContextFact,
  type LanguageNote,
} from "./depth-research"
import type { DevotionalMessage } from "./devotional-message"
import type { DevotionalLlm } from "./llm"
import {
  ancientEntry,
  entriesCiting,
  greekWords,
  normalizeForQuote,
  verifyQuote,
  type DictionaryEntry,
  type ReferenceCorpora,
} from "./reference-corpus"

/**
 * The researcher of the storyteller path (owner, 2026-09-29: "researchers go
 * and find the information and hand it to the writer; the writer, a good
 * storyteller, writes without inventing"). One agent reads the passage, the
 * classic commentator and the reference works, and returns the message and
 * a handful of facts with verbatim quotes. Every fact is then checked in
 * code (the quote is in its source, a Greek word is in the passage) and cut
 * back to what its source actually states; only what survives reaches the
 * writer.
 */

export type ResearchBrief = {
  message: DevotionalMessage
  /**
   * The ONE insight the facts explain (owner, 2026-10-05: "take one point,
   * language or history, and explain it better, rather than a little of
   * each and in the end empty words"). All facts are of one kind and serve
   * this one sentence; absent when the researcher found none worth it.
   */
  insight?: string
  history: ContextFact[]
  language?: LanguageNote
  /** The classic's points the message rests on (text). */
  classicPoints: string[]
  /** What the researcher dropped and why, for the owner's notes. */
  dropped: string[]
}

export class ResearchConflictError extends Error {
  constructor(readonly reason: string) {
    super(`research: the passage does not support a clear message: ${reason}`)
    this.name = "ResearchConflictError"
  }
}

const FactSchema = z
  .object({
    kind: z.enum(["history", "language"]),
    sourceId: z.string(),
    claim: z.string(),
    quote: z.string(),
    meaning: z.string(),
    strong: z.string(),
    osis: z.string(),
    englishPhrase: z.string(),
  })
  .strict()

const Schema = z
  .object({
    status: z.enum(["ok", "conflict"]),
    reason: z.string(),
    idea: z.string(),
    tension: z.string(),
    askDirection: z.string(),
    grounding: z.string(),
    insight: z.string(),
    classicPoints: z.array(z.number().int()),
    facts: z.array(FactSchema),
  })
  .strict()

const str = { type: "string" } as const
const JSON_SCHEMA = {
  name: "research_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["ok", "conflict"] },
      reason: str,
      idea: str,
      tension: str,
      askDirection: str,
      grounding: str,
      insight: str,
      classicPoints: { type: "array", items: { type: "integer" } },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["history", "language"] },
            sourceId: str,
            claim: str,
            quote: str,
            meaning: str,
            strong: str,
            osis: str,
            englishPhrase: str,
          },
          required: [
            "kind",
            "sourceId",
            "claim",
            "quote",
            "meaning",
            "strong",
            "osis",
            "englishPhrase",
          ],
        },
      },
    },
    required: [
      "status",
      "reason",
      "idea",
      "tension",
      "askDirection",
      "grounding",
      "insight",
      "classicPoints",
      "facts",
    ],
  },
}

export const SYSTEM_PROMPT = [
  "You are the RESEARCHER for a short Bible devotional video. You do not write",
  "the script: a writer will, from what you hand over and nothing else. Your",
  "job is to decide what this passage says to people who already follow",
  "Jesus, and to find the few facts that make the story land as its first",
  "hearers heard it.",
  "",
  "Return:",
  "- idea: the one thing the viewer should carry away, one or two plain",
  "  sentences, specific to THIS passage. Scripture bounds it: it must be what",
  "  the text says or clearly shows.",
  "- tension: what in the story resists that idea and keeps someone watching",
  "  (the reasonable objection, the character the viewer secretly agrees with).",
  "- askDirection: where the closing personal question should point.",
  "- grounding: which verses carry the idea.",
  "- classicPoints: the numbers of the one or two commentator points that",
  "  carry the idea (the reflection is two minutes long).",
  "- insight: ONE thing a modern reader would miss in this story that makes",
  "  the idea land harder: EITHER the meaning of one word (language) OR one",
  "  piece of background (history), never both. One sentence: what it is and",
  "  which moment of the story it changes. The writer will explain it in",
  "  full (what it is, how we know, what it changes), so it must be one",
  "  point with enough behind it to explain, not a passing remark. Leave it",
  "  empty, with no facts, when nothing in the sources is worth that time.",
  "- facts: two to four facts that all explain THAT insight, all of one",
  "  kind, together enough to explain it properly: what it was, where it",
  "  comes from, why it matters at this moment. For each, meaning = what it",
  "  shows in THIS story, one sentence, following from the source itself.",
  "  kind 'history': from the SOURCES given (law, custom, economy, religious",
  "  boundaries, sayings of the time). sourceId exactly as listed; quote",
  "  copied WORD FOR WORD from that source, at least six words.",
  "  kind 'language': ONE Greek word from the GREEK list whose",
  "  meaning an English reader would miss; strong and osis exactly as listed;",
  "  englishPhrase = the English words of that verse in the passage that",
  "  translate it, copied exactly; quote from ITS lexicon entry; the meaning",
  "  is what the lexicon says the word means, never its root's etymology.",
  "  Several language facts may quote different parts of that ONE word's",
  "  entry (same strong and osis).",
  "  Leave strong, osis and englishPhrase empty for history facts.",
  "",
  "Everything is checked in code: a quote not in its source, a Greek word not",
  "in the passage, or a claim the source does not state is thrown away. Do",
  "not look for proof of the idea; look for what helps the viewer read the",
  "text accurately. Old dictionaries carry dated guesses: take only what they",
  "state as plain fact. Rabbinic texts were written down after Jesus: they",
  "show what rabbis said, not what Jesus' hearers knew. One insight well",
  "supported is better than two thin ones; none at all is an honest answer.",
  "If the passage does not support a clear message, status = conflict.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

/** Passage content words the language researcher may pick from. */
function greekBlock(corpora: ReferenceCorpora, osis: string): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const w of greekWords(corpora, osis)) {
    const base = w.strong.replace(/[A-Z]$/, "")
    if (FUNCTION_LEMMAS.has(w.lemma) || seen.has(`${base}|${w.osis}`)) continue
    seen.add(`${base}|${w.osis}`)
    const lex = corpora.lexicon[base] ?? corpora.lexicon[w.strong]
    lines.push(
      `${w.osis} ${w.strong} "${w.english}" lemma ${w.lemma}: ${lex ? lex.text.slice(0, 400) : "(no entry)"}`,
    )
  }
  return lines.join("\n")
}

export async function researchBrief(input: {
  corpora: ReferenceCorpora
  passage: { reference: string; osisRef: string }
  passageText: string
  settingText?: string
  classic: { name: string; points: string[] }
  terms?: string[]
  ancient?: string[]
  /** The owner's leaning for this story ("history" / "language"), passed as
   *  a preference the researcher may overrule with a reason. */
  insightHint?: string
  llm: DevotionalLlm
  /** Audits claims against their sources (a cheaper model is fine). */
  auditLlm: DevotionalLlm
  log?: (m: string) => void
}): Promise<ResearchBrief> {
  const log = input.log ?? (() => {})
  const bookName = input.passage.reference.split(" ").slice(0, -1).join(" ")
  const chapter = Number(input.passage.osisRef.split(".")[1])
  const wanted = new Set((input.terms ?? []).map((t) => t.toLowerCase()))
  const entries: DictionaryEntry[] = [
    ...entriesCiting(input.corpora, input.passage.osisRef),
    ...input.corpora.dictionaries.filter((e) =>
      wanted.has(e.term.toLowerCase()),
    ),
    ...(input.ancient ?? [])
      .map((r) => ancientEntry(input.corpora, r))
      .filter((e): e is DictionaryEntry => e != null),
  ]
  const shown = new Map(
    [...new Map(entries.map((e) => [e.id, e])).values()].map((e) => [
      e.id,
      {
        entry: e,
        excerpt: entryExcerpt(e, bookName, chapter, 1400, input.passageText),
      },
    ]),
  )
  const user = [
    `PASSAGE (${input.passage.reference}, BSB):`,
    input.passageText,
    ...(input.settingText
      ? ["", "SETTING (who Jesus is speaking to):", input.settingText]
      : []),
    "",
    `CLASSIC COMMENTATOR (${input.classic.name}), his points:`,
    ...input.classic.points.map((p, i) => `(${i + 1}) ${p}`),
    "",
    "SOURCES (id | name | text):",
    ...[...shown.values()].map(
      ({ entry, excerpt }) =>
        `### ${entry.id} | ${entry.term} | ${entry.source}\n${excerpt}`,
    ),
    "",
    'GREEK (osis strong "English" lemma: lexicon entry):',
    greekBlock(input.corpora, input.passage.osisRef),
    ...(input.insightHint
      ? [
          "",
          `THE OWNER'S LEANING for the insight: ${input.insightHint}. A preference, not an order: follow it when the sources carry it well; if the other kind is clearly stronger here, choose that and say why in the insight sentence.`,
        ]
      : []),
  ].join("\n")
  const out = await input.llm.complete({
    system: SYSTEM_PROMPT,
    user,
    jsonSchema: JSON_SCHEMA,
    schema: Schema,
    temperature: 0.4,
    maxTokens: 3000,
  })
  if (out.status === "conflict") throw new ResearchConflictError(out.reason)

  const dropped: string[] = []
  const historyRaw: ContextFact[] = []
  let language: LanguageNote | undefined
  const words = greekWords(input.corpora, input.passage.osisRef)
  // One insight, one kind: the first fact decides, the other kind is cut.
  const kind = out.facts[0]?.kind
  for (const f of out.facts) {
    if (f.kind !== kind) {
      dropped.push(
        `${f.kind}, a second kind of insight beside the ${kind} one: ${f.claim}`,
      )
      continue
    }
    if (f.kind === "history") {
      const hit = shown.get(f.sourceId)
      if (!hit || !verifyQuote(f.quote, hit.entry.text)) {
        dropped.push(`history, quote not in ${f.sourceId}: “${f.quote}”`)
        continue
      }
      historyRaw.push({
        claim: `${f.claim} ${f.meaning}`.trim(),
        quote: f.quote,
        entryId: f.sourceId,
        source: hit.entry.source,
        term: hit.entry.term,
        why: f.meaning,
      })
      continue
    }
    if (language) {
      // More of the SAME word's entry deepens the one insight.
      const same =
        language.osis === f.osis &&
        language.strong.replace(/[A-Z]$/, "") === f.strong.replace(/[A-Z]$/, "")
      if (!same)
        dropped.push(
          `language, a second word (${f.strong}) beyond the one allowed`,
        )
      else if (!verifyQuote(f.quote, language.lexiconText))
        dropped.push(
          `language, quote not in the ${language.lemma} entry: “${f.quote}”`,
        )
      else
        language.more = [
          ...(language.more ?? []),
          { meaning: f.claim, quote: f.quote, why: f.meaning },
        ]
      continue
    }
    const base = (s: string) => s.replace(/[A-Z]$/, "")
    const word = words.find(
      (w) => w.osis === f.osis && base(w.strong) === base(f.strong),
    )
    const lex = word
      ? (input.corpora.lexicon[base(word.strong)] ??
        input.corpora.lexicon[word.strong])
      : undefined
    const phraseOk =
      f.englishPhrase.trim() !== "" &&
      ` ${normalizeForQuote(input.passageText)} `.includes(
        ` ${normalizeForQuote(f.englishPhrase)} `,
      )
    if (!word || !lex) dropped.push(`language, ${f.strong} is not at ${f.osis}`)
    else if (!verifyQuote(f.quote, lex.text))
      dropped.push(
        `language, quote not in the ${lex.lemma} entry: “${f.quote}”`,
      )
    else if (!phraseOk)
      dropped.push(`language, “${f.englishPhrase}” is not in the passage`)
    else {
      const [, c, v] = word.osis.split(".")
      language = {
        strong: word.strong,
        osis: word.osis,
        verseRef: `${bookName} ${c}:${v}`,
        englishPhrase: f.englishPhrase.trim(),
        greek: word.greek,
        translit: word.translit,
        lemma: lex.lemma,
        meaning: f.claim,
        quote: f.quote,
        why: f.meaning,
        lexiconText: lex.text,
      }
    }
  }
  for (const d of dropped) log(`   ✂️ ${d}`)

  // Real quotes can still carry claims their source does not make; each is
  // cut back to what the source states, or dropped.
  const history = historyRaw.length
    ? await auditClaims({ facts: historyRaw, shown, llm: input.auditLlm, log })
    : []
  for (const f of historyRaw) {
    if (!history.some((h) => h.entryId === f.entryId && h.quote === f.quote)) {
      dropped.push(`history, the source does not state: ${f.claim}`)
    }
  }

  const chosen = [...new Set(out.classicPoints)]
    .filter((n) => n >= 1 && n <= input.classic.points.length)
    .slice(0, 2)
  const classicPoints = (chosen.length ? chosen : [1]).map(
    (n) => input.classic.points[n - 1],
  )
  return {
    ...(out.insight.trim() && (history.length || language)
      ? { insight: out.insight.trim() }
      : {}),
    message: {
      idea: out.idea,
      tension: out.tension,
      askDirection: out.askDirection,
      grounding: out.grounding,
      classicPoints: chosen,
    },
    history,
    ...(language ? { language } : {}),
    classicPoints,
    dropped,
  }
}

export const _internal = { JSON_SCHEMA }
