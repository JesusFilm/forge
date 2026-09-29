import { z } from "zod"

import { messageBlock, type DevotionalMessage } from "./devotional-message"
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
 * The two depth agents of the message-first path (feat-572): historical and
 * cultural context from two public-domain Bible dictionaries, and one Greek
 * word from the tagged text and a public-domain lexicon.
 *
 * Both read only what the corpora hand them, and every quotation they return
 * is checked in code; a fact whose quotation is not in the entry is dropped,
 * and a Greek word that is not in the passage is dropped. Both may answer
 * that there is nothing worth adding, and both may answer that the passage
 * does not support the message: that stops the run, because the message is
 * what must change, not the facts.
 */

export type DepthStatus = "facts" | "nothing-useful" | "conflict"

export type ContextFact = {
  /** The fact as the writer should understand it, in plain words. */
  claim: string
  /** Verbatim words from the entry that carry the claim. */
  quote: string
  entryId: string
  source: string
  term: string
  /** How it helps the viewer read THIS passage. */
  why: string
}

export type LanguageNote = {
  strong: string
  osis: string
  greek: string
  translit: string
  lemma: string
  /** The English words of the verse (BSB) this Greek word stands behind,
   *  copied from the passage: the narration points at these, never at the
   *  Greek, which the synthetic voice cannot say (owner, 2026-09-29). */
  englishPhrase: string
  /** Human reference of the verse, e.g. "Luke 15:20". */
  verseRef: string
  /** What the word means here, in plain words. */
  meaning: string
  /** Verbatim words from the lexicon entry. */
  quote: string
  /** What it changes in the reading. */
  why: string
  lexiconText: string
}

export class DepthConflictError extends Error {
  constructor(
    readonly agent: "context" | "language",
    readonly reason: string,
  ) {
    super(
      `${agent} research: the passage does not support the message: ${reason}`,
    )
    this.name = "DepthConflictError"
  }
}

const RULES = [
  "Search for what helps the viewer read the text MORE ACCURATELY in relation",
  "to the message. Do NOT search for evidence to prove the message. Reject",
  "anything that needs the source or the passage stretched. Old dictionaries",
  "carry dated guesses: take only what the entry states as plain fact about",
  "the text or its world, never its devotional asides or speculation.",
  "If nothing would clearly change how a viewer understands this passage,",
  "answer nothing-useful: that is a good answer, and far better than padding.",
  "If the passage itself pulls against the message, answer conflict and say",
  "why in one sentence.",
  "Every quote must be copied WORD FOR WORD from the text given to you, at",
  "least six words long; it is checked by code and dropped if it is not there.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

// ---- Historical and cultural context -----------------------------------------

const ContextSchema = z
  .object({
    status: z.enum(["facts", "nothing-useful", "conflict"]),
    reason: z.string(),
    facts: z.array(
      z
        .object({
          claim: z.string(),
          quote: z.string(),
          entryId: z.string(),
          why: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

const CONTEXT_JSON_SCHEMA = {
  name: "devotional_context",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["facts", "nothing-useful", "conflict"] },
      reason: { type: "string" },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim: { type: "string" },
            quote: { type: "string" },
            entryId: { type: "string" },
            why: { type: "string" },
          },
          required: ["claim", "quote", "entryId", "why"],
        },
      },
    },
    required: ["status", "reason", "facts"],
  },
}

export const CONTEXT_SYSTEM_PROMPT = [
  "You research HISTORICAL, CULTURAL, SOCIAL, ECONOMIC or RELIGIOUS context",
  "for a short Bible devotional video, from entries of Easton's Bible",
  "Dictionary (1897) and Smith's Bible Dictionary (1863), and from ancient",
  "texts such as the Book of Sirach, a Jewish wisdom book of the second",
  "century BC. An ancient text shows what people then valued or advised;",
  "state it as what that book says, never as proof of what everyone did.",
  "Return at most two facts. A good fact is one the viewer would not know from",
  "watching the scene, that changes how a moment in the story lands: a law, a",
  "custom, an economic reality, a religious boundary, who the audience was.",
  RULES,
].join("\n")

/** The part of an entry worth showing: the paragraphs that cite the passage,
 *  else its opening, capped so a long article does not drown the rest. */
export function entryExcerpt(
  e: DictionaryEntry,
  book: string,
  chapter: number,
  cap = 1400,
): string {
  const paras = e.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const cite = new RegExp(`\\b${book}\\.? ${chapter}:`)
  const hits = paras.filter((p) => cite.test(p))
  const body = (hits.length ? hits : paras.slice(0, 2)).join("\n\n")
  return body.length > cap ? `${body.slice(0, cap)}…` : body
}

export async function researchContext(input: {
  corpora: ReferenceCorpora
  passageOsis: string
  passageReference: string
  passageText: string
  settingText?: string
  message: DevotionalMessage
  /** Extra headwords to look up besides the entries that cite the passage. */
  terms?: string[]
  /** Ancient texts to offer as primary sources ("Sir.19.30"). */
  ancient?: string[]
  llm: DevotionalLlm
  log?: (m: string) => void
}): Promise<{ status: DepthStatus; reason: string; facts: ContextFact[] }> {
  const [book, chapterRaw] = input.passageOsis.split(".")
  const chapter = Number(chapterRaw)
  const bookName = input.passageReference.split(" ")[0]
  const citing = entriesCiting(input.corpora, input.passageOsis)
  const wanted = new Set((input.terms ?? []).map((t) => t.toLowerCase()))
  const extra = input.corpora.dictionaries.filter(
    (e) => wanted.has(e.term.toLowerCase()) && !citing.includes(e),
  )
  const ancient = (input.ancient ?? [])
    .map((r) => ancientEntry(input.corpora, r))
    .filter((e): e is DictionaryEntry => e != null)
  const entries = [...citing, ...extra, ...ancient]
  const shown = new Map(
    entries.map((e) => [
      e.id,
      { entry: e, excerpt: entryExcerpt(e, bookName, chapter) },
    ]),
  )
  void book
  const user = [
    messageBlock(input.message),
    "",
    `Passage (${input.passageReference}, BSB):`,
    input.passageText,
    ...(input.settingText ? ["", "Setting:", input.settingText] : []),
    "",
    "DICTIONARY ENTRIES (id, headword, source, text):",
    ...[...shown.values()].map(
      ({ entry, excerpt }) =>
        `### ${entry.id} | ${entry.term} | ${entry.source}\n${excerpt}`,
    ),
  ].join("\n")
  const ask = (u: string) =>
    input.llm.complete({
      system: CONTEXT_SYSTEM_PROMPT,
      user: u,
      jsonSchema: CONTEXT_JSON_SCHEMA,
      schema: ContextSchema,
      temperature: 0.3,
      maxTokens: 1500,
    })
  const verify = (list: z.infer<typeof ContextSchema>["facts"]) => {
    const ok: ContextFact[] = []
    const bad: typeof list = []
    for (const f of list) {
      const hit = shown.get(f.entryId)
      if (hit && verifyQuote(f.quote, hit.entry.text)) {
        ok.push({ ...f, source: hit.entry.source, term: hit.entry.term })
      } else {
        input.log?.(
          `   ✂️ context fact dropped (quote not in ${f.entryId}): “${f.quote}”`,
        )
        bad.push(f)
      }
    }
    return { ok, bad }
  }
  let out = await ask(user)
  if (out.status === "conflict")
    throw new DepthConflictError("context", out.reason)
  const first = verify(out.facts)
  let facts = first.ok
  const bad = first.bad
  // One more round for the facts whose quotation did not check out: the claim
  // may be right and the copying sloppy, or the claim may not be in the entry
  // at all (the model remembering a commentary it once read). Either way the
  // entry decides.
  if (bad.length > 0) {
    out = await ask(
      [
        user,
        "",
        "These facts were DROPPED because their quote is not in the entry named:",
        ...bad.map((f) => `- ${f.entryId}: “${f.quote}” (claim: ${f.claim})`),
        "For each, either copy a quote that IS in that entry, word for word,",
        "and restate the claim so it says only what the quote says, or leave it",
        "out. Do not keep a claim the entry does not make. Return the full list.",
      ].join("\n"),
    )
    if (out.status === "conflict")
      throw new DepthConflictError("context", out.reason)
    facts = verify(out.facts).ok
  }
  // A real quotation can still be dressed with a claim it does not make: "the
  // property of a father was divided among the sons" once carried "asking for
  // it early was wishing him dead" (2026-09-29). Each claim is cut back to
  // what its quotation and entry actually say, or dropped.
  const audited = facts.length
    ? await auditClaims({
        facts,
        shown,
        llm: input.llm,
        ...(input.log ? { log: input.log } : {}),
      })
    : []
  return {
    status: audited.length ? "facts" : "nothing-useful",
    reason: out.reason,
    facts: audited.slice(0, 2),
  }
}

const AuditSchema = z
  .object({
    verdicts: z.array(
      z
        .object({
          entryId: z.string(),
          supported: z.boolean(),
          claim: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

const AUDIT_JSON_SCHEMA = {
  name: "devotional_claim_audit",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            entryId: { type: "string" },
            supported: { type: "boolean" },
            claim: { type: "string" },
          },
          required: ["entryId", "supported", "claim"],
        },
      },
    },
    required: ["verdicts"],
  },
}

export const AUDIT_SYSTEM_PROMPT = [
  "You audit research notes for a Bible devotional. Each note has a CLAIM,",
  "the QUOTE it rests on, and the ENTRY the quote comes from. For each note:",
  "supported = true only if the entry itself states what the claim says. Then",
  "rewrite the claim to say ONLY what the entry states, in plain words: cut",
  "every inference, motive, feeling or cultural meaning the entry does not",
  "state, however well known it is elsewhere. If nothing of the claim is",
  "left, supported = false. No em dashes or en dashes. Return JSON only.",
].join("\n")

async function auditClaims(input: {
  facts: ContextFact[]
  shown: Map<string, { entry: DictionaryEntry; excerpt: string }>
  llm: DevotionalLlm
  log?: (m: string) => void
}): Promise<ContextFact[]> {
  const out = await input.llm.complete({
    system: AUDIT_SYSTEM_PROMPT,
    user: input.facts
      .map(
        (f) =>
          `### ${f.entryId}\nCLAIM: ${f.claim}\nQUOTE: ${f.quote}\nENTRY: ${input.shown.get(f.entryId)?.excerpt ?? ""}`,
      )
      .join("\n\n"),
    jsonSchema: AUDIT_JSON_SCHEMA,
    schema: AuditSchema,
    temperature: 0,
    maxTokens: 900,
  })
  const kept: ContextFact[] = []
  for (const f of input.facts) {
    const v = out.verdicts.find((x) => x.entryId === f.entryId)
    if (!v || !v.supported) {
      input.log?.(
        `   ✂️ context claim dropped (entry does not say it): ${f.claim}`,
      )
      continue
    }
    if (v.claim.trim() !== f.claim.trim()) {
      input.log?.(`   ✎ context claim narrowed to the entry: ${v.claim}`)
    }
    kept.push({ ...f, claim: v.claim.trim() })
  }
  return kept
}

// ---- Original language -----------------------------------------------------

const LanguageSchema = z
  .object({
    status: z.enum(["facts", "nothing-useful", "conflict"]),
    reason: z.string(),
    strong: z.string(),
    osis: z.string(),
    englishPhrase: z.string(),
    meaning: z.string(),
    quote: z.string(),
    why: z.string(),
  })
  .strict()

const LANGUAGE_JSON_SCHEMA = {
  name: "devotional_language",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["facts", "nothing-useful", "conflict"] },
      reason: { type: "string" },
      strong: { type: "string" },
      osis: { type: "string" },
      englishPhrase: { type: "string" },
      meaning: { type: "string" },
      quote: { type: "string" },
      why: { type: "string" },
    },
    required: [
      "status",
      "reason",
      "strong",
      "osis",
      "englishPhrase",
      "meaning",
      "quote",
      "why",
    ],
  },
}

export const LANGUAGE_SYSTEM_PROMPT = [
  "You look at the ORIGINAL GREEK of a Gospel passage for a short Bible",
  "devotional video. You get every content word of the passage (form,",
  "transliteration, English, lemma, Strong number) with its entry from",
  "Abbott-Smith's Manual Greek Lexicon of the New Testament (1922).",
  "Pick AT MOST ONE word whose meaning in Greek changes or sharpens how a",
  "viewer reads this passage, in a way an English reader would miss. Not a",
  "word study for its own sake; not an etymology that the Greek speakers of",
  "the day would not have heard. The meaning is what the lexicon says the",
  "WORD means, not what its root once meant: σπλαγχνίζομαι means to feel",
  "pity or compassion; that it comes from a noun for the inward parts is",
  "etymology, and the viewer must not be told the father felt it in his",
  "guts. Give its strong and osis exactly as listed; englishPhrase, the",
  "English words of THAT verse in the passage (BSB) that translate it,",
  "copied exactly; its meaning here in plain words; a verbatim quote from",
  "ITS lexicon entry; and what it changes. The narration will never say the",
  "Greek word (a synthetic voice cannot pronounce it): it will point at the",
  "English words in the verse, so the note must work that way. Leave strong,",
  "osis, englishPhrase, meaning, quote and why empty when status is not",
  "facts.",
  RULES,
].join("\n")

/** Parts of speech that never carry a devotional point. */
const FUNCTION_LEMMAS = new Set([
  "ὁ",
  "καί",
  "δέ",
  "αὐτός",
  "ἐγώ",
  "σύ",
  "εἰς",
  "ἐν",
  "πρός",
  "ἐκ",
  "ἀπό",
  "ὅτι",
  "οὐ",
  "μή",
  "γάρ",
  "ἀλλά",
  "ὡς",
  "οὗτος",
  "τις",
  "τίς",
  "ἐπί",
  "διά",
  "μετά",
  "καθώς",
  "ἵνα",
  "εἰμί",
  "ἑαυτοῦ",
  "ὅς",
  "σός",
  "ἐμός",
  "ἤδη",
  "ἔτι",
])

export async function researchLanguage(input: {
  corpora: ReferenceCorpora
  passageOsis: string
  passageReference: string
  passageText: string
  message: DevotionalMessage
  llm: DevotionalLlm
  log?: (m: string) => void
}): Promise<{ status: DepthStatus; reason: string; note?: LanguageNote }> {
  const words = greekWords(input.corpora, input.passageOsis)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const w of words) {
    const base = w.strong.replace(/[A-Z]$/, "")
    if (FUNCTION_LEMMAS.has(w.lemma) || seen.has(`${base}|${w.osis}`)) continue
    seen.add(`${base}|${w.osis}`)
    const lex = input.corpora.lexicon[base] ?? input.corpora.lexicon[w.strong]
    lines.push(
      `${w.osis} ${w.strong} ${w.greek} (${w.translit}) "${w.english}" lemma ${w.lemma}: ${
        lex ? lex.text.slice(0, 500) : "(no entry)"
      }`,
    )
  }
  const user = [
    messageBlock(input.message),
    "",
    `Passage (${input.passageReference}, BSB):`,
    input.passageText,
    "",
    "GREEK WORDS WITH LEXICON ENTRIES:",
    ...lines,
  ].join("\n")
  const out = await input.llm.complete({
    system: LANGUAGE_SYSTEM_PROMPT,
    user,
    jsonSchema: LANGUAGE_JSON_SCHEMA,
    schema: LanguageSchema,
    temperature: 0.3,
    maxTokens: 900,
  })
  if (out.status === "conflict")
    throw new DepthConflictError("language", out.reason)
  if (out.status !== "facts")
    return { status: "nothing-useful", reason: out.reason }
  const word = words.find(
    (w) =>
      w.osis === out.osis &&
      w.strong.replace(/[A-Z]$/, "") === out.strong.replace(/[A-Z]$/, ""),
  )
  const lex = word
    ? (input.corpora.lexicon[word.strong.replace(/[A-Z]$/, "")] ??
      input.corpora.lexicon[word.strong])
    : undefined
  if (!word || !lex) {
    input.log?.(
      `   ✂️ language note dropped: ${out.strong} is not at ${out.osis}`,
    )
    return {
      status: "nothing-useful",
      reason: "picked word not in the passage",
    }
  }
  let quote = out.quote
  if (!verifyQuote(quote, lex.text)) {
    input.log?.(
      `   ✂️ language quote not in the entry, asking again: “${quote}”`,
    )
    // The shown entries are cut at 500 characters; the full entry decides.
    const again = await input.llm.complete({
      system: LANGUAGE_SYSTEM_PROMPT,
      user: [
        user,
        "",
        `You picked ${out.strong} at ${out.osis}, but your quote is not in its entry.`,
        `Its FULL entry: ${lex.text}`,
        "Copy a quote of at least six words from it, word for word, and keep the",
        "same word, or answer nothing-useful if the entry does not say what you",
        "meant.",
      ].join("\n"),
      jsonSchema: LANGUAGE_JSON_SCHEMA,
      schema: LanguageSchema,
      temperature: 0.2,
      maxTokens: 900,
    })
    if (again.status !== "facts" || !verifyQuote(again.quote, lex.text)) {
      input.log?.(
        `   ✂️ language note dropped (quote not in the entry): “${again.quote}”`,
      )
      return {
        status: "nothing-useful",
        reason: "quote not in the lexicon entry",
      }
    }
    quote = again.quote
    out.meaning = again.meaning || out.meaning
    out.why = again.why || out.why
  }
  const phrase = out.englishPhrase.trim()
  if (
    !phrase ||
    !` ${normalizeForQuote(input.passageText)} `.includes(
      ` ${normalizeForQuote(phrase)} `,
    )
  ) {
    input.log?.(
      `   ✂️ language note dropped: “${phrase}” is not in the passage's English`,
    )
    return {
      status: "nothing-useful",
      reason: "english phrase not in the passage",
    }
  }
  const [, chapter, verse] = word.osis.split(".")
  const book = input.passageReference.split(" ").slice(0, -1).join(" ")
  return {
    status: "facts",
    reason: out.reason,
    note: {
      englishPhrase: phrase,
      verseRef: `${book} ${chapter}:${verse}`,
      strong: word.strong,
      osis: word.osis,
      greek: word.greek,
      translit: word.translit,
      lemma: lex.lemma,
      meaning: out.meaning,
      quote,
      why: out.why,
      lexiconText: lex.text,
    },
  }
}

export const _internal = {
  JSON_SCHEMA: CONTEXT_JSON_SCHEMA,
  AUDIT_JSON_SCHEMA,
  LANGUAGE_JSON_SCHEMA,
  normalizeForQuote,
}
