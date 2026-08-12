import { z } from "zod"

import { createDevotionalLlm, type DevotionalLlm } from "./llm"
import { stressWord } from "./ru-stress-dict"

/**
 * Automatic Russian stress marking by MULTI-MODEL CONSENSUS (spoken text only).
 *
 * A single strong model is not reliable for Russian stress — claude-sonnet-4.5
 * missed "набра́но", gpt-4o missed "коробо́в". But a PER-WORD MAJORITY VOTE across
 * several strong models corrects each other's misses (verified on Luke 9:17: the
 * vote got both right). This is the reliable, hands-off replacement for the old
 * manual override list.
 *
 * Robust: any model that ALTERS the text (drops/reorders/changes a word, not
 * just adds accents) is discarded from the vote. Models are told to KEEP any
 * accent already present, so caller-pinned exceptions (homographs) survive.
 * Output is spoken-only; the on-screen text stays clean.
 */

const ACCENT = "́" // combining acute
const stripAccents = (s: string): string => s.replace(/́/g, "")

const Schema = z.object({ accented: z.string() }).strict()
const JSON_SCHEMA = {
  name: "accented_text",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { accented: { type: "string" } },
    required: ["accented"],
  },
}

const SYSTEM_PROMPT = [
  "Ты расставляешь ударения в русском тексте для синтеза речи.",
  "Добавь знак ударения — комбинируемый акут U+0301 — СРАЗУ ПОСЛЕ ударной гласной",
  "в КАЖДОМ слове, где больше одного слога (в том числе в тексте из Писания).",
  "НЕ меняй сами буквы, порядок слов и пунктуацию — только добавляй метки.",
  "Если у слова УЖЕ стоит знак ударения, оставь его как есть.",
  "Верни JSON: { accented: string } — тот же текст с метками.",
].join("\n")

/**
 * Default ensemble (all verified reachable on the OpenRouter key). FIVE voters so
 * a single flaky/slow model still leaves a clear majority — 3 voters tied and
 * broke wrong when one dropped. Odd count avoids most ties.
 */
export const STRESS_ENSEMBLE = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o",
  "openai/gpt-4.1",
  "google/gemini-2.5-pro",
] as const

export type AccentDeps = {
  /** Build an LLM for a model id (injectable for tests). */
  llmFor?: (model: string) => DevotionalLlm
  models?: readonly string[]
}

async function accentOnce(
  text: string,
  model: string,
  llmFor: (m: string) => DevotionalLlm,
): Promise<string | null> {
  try {
    const r = await llmFor(model).complete({
      system: SYSTEM_PROMPT,
      user: text,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0,
      maxTokens: 900,
    })
    return r.accented
  } catch {
    return null // a failed voter just doesn't vote
  }
}

/**
 * Return `text` with stress marks, decided per-word by majority vote across the
 * ensemble. Best-effort: if fewer than one model returns usable output, returns
 * the input unchanged (never worse than no marks).
 */
export async function accentRussianConsensus(
  text: string,
  deps: AccentDeps = {},
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return text
  const models = deps.models ?? STRESS_ENSEMBLE
  const llmFor =
    deps.llmFor ?? ((model: string) => createDevotionalLlm({ model }))

  const originalTokens = trimmed.split(/\s+/)
  const results = await Promise.all(
    models.map((m) => accentOnce(trimmed, m, llmFor)),
  )

  // Keep only outputs that preserve the exact words (accents aside): same token
  // count AND same base for every token. A model that rewrote the text is out.
  const valid = results.filter((out): out is string => {
    if (!out) return false
    const toks = out.trim().split(/\s+/)
    if (toks.length !== originalTokens.length) return false
    return toks.every((t, i) => stripAccents(t) === originalTokens[i])
  })

  if (valid.length === 0) return text
  if (valid.length === 1) return valid[0]

  const votes = valid.map((v) => v.trim().split(/\s+/))
  const consensus = originalTokens.map((_, i) => {
    const counts = new Map<string, number>()
    for (const v of votes) counts.set(v[i], (counts.get(v[i]) ?? 0) + 1)
    // Highest vote wins; tie → the accented variant over the bare one, else first.
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || (b[0].includes(ACCENT) ? 1 : 0) - (a[0].includes(ACCENT) ? 1 : 0),
    )[0][0]
  })
  return consensus.join(" ")
}

const TOKEN_RE = /[-А-Яа-яЁё́]+|[^-А-Яа-яЁё́]+/g
const hasCyrillic = (t: string): boolean => /[А-Яа-яЁё]/.test(t)
const hasAccent = (t: string): boolean => t.includes(ACCENT)

/**
 * Accent Russian text with the DICTIONARY first (deterministic, authoritative
 * for words it knows unambiguously), falling back to the multi-model CONSENSUS
 * only for homographs (сто́ит/стои́т) and out-of-dictionary words. Words that
 * already carry an accent (owner-pinned overrides) are left untouched. When the
 * dictionary resolves everything, NO LLM call is made — fast, free, exact.
 */
export async function accentRussianHybrid(
  text: string,
  deps: AccentDeps = {},
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return text
  const tokens = trimmed.match(TOKEN_RE) ?? [trimmed]
  const wordPositions = tokens
    .map((t, i) => (hasCyrillic(t) ? i : -1))
    .filter((i) => i >= 0)

  const resolved = tokens.slice()
  const needConsensus: number[] = []
  for (const i of wordPositions) {
    if (hasAccent(tokens[i])) continue // owner-pinned override
    const dictForm = stressWord(tokens[i])
    if (dictForm) resolved[i] = dictForm
    else needConsensus.push(i)
  }
  if (needConsensus.length === 0) return resolved.join("")

  // Homographs / unknown words → context-aware consensus, aligned by word index.
  const consensus = await accentRussianConsensus(trimmed, deps)
  const cWords = (consensus.match(TOKEN_RE) ?? []).filter(hasCyrillic)
  if (cWords.length === wordPositions.length) {
    for (const i of needConsensus) {
      const c = cWords[wordPositions.indexOf(i)]
      if (c && stripAccents(c) === stripAccents(tokens[i])) resolved[i] = c
    }
  }
  return resolved.join("")
}
