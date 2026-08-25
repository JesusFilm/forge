import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import type { DevotionalLang } from "./devotional-locale"
import { MAX_DEVOTIONAL_TEXT_LENGTH } from "./types"

/**
 * Translate the finished English devotional COPY into the target language.
 *
 * The devotional is generated + safety-checked in English (grounded in English
 * public-domain reflections); this step localizes the spoken/on-screen copy.
 * Scripture is NOT translated here — the real target-language Bible verse is
 * swapped in separately (never machine-translate the Word). All five fields go
 * in one call so tone stays consistent across them.
 *
 * Preserves meaning, warmth, and the author's voice; produces natural,
 * contemporary language (not word-for-word) that reads well spoken; keeps
 * target-language punctuation (e.g. the Russian em dash "—", which — unlike in
 * English — is standard, not an AI tell).
 */

export type TranslatableCopy = {
  title: string
  reflection: string
  conclusion: string
  question: string
  prayer: string
}

export type TranslateDevotionalErrorCode = "generation_failed" | "empty_output"

export class TranslateDevotionalError extends Error {
  constructor(
    readonly code: TranslateDevotionalErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TranslateDevotionalError"
  }
}

const LANGUAGE_NAMES: Record<DevotionalLang, string> = {
  en: "English",
  ru: "Russian",
}

const TranslatedSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    reflection: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    conclusion: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    question: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    prayer: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
  })
  .strict()

const TRANSLATED_JSON_SCHEMA = {
  name: "translated_devotional_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      reflection: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      conclusion: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      question: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      prayer: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
    },
    required: ["title", "reflection", "conclusion", "question", "prayer"],
  },
}

export function buildTranslateSystemPrompt(languageName: string): string {
  return [
    `You are a NATIVE ${languageName} translator for a Jesus Film daily devotional`,
    `video. Translate the given fields from English into ${languageName}.`,
    `- Translate the MEANING, not the words. NEVER produce a word-for-word gloss`,
    `  or a calque. Render every phrase the way a native ${languageName} pastor`,
    `  would actually say it out loud.`,
    `- It is narrated aloud, so it must sound like a real person speaking`,
    `  ${languageName}, warm and natural — never like a translation.`,
    `- The text refers to the Bible scene given below. Translate references to that`,
    `  scene so they make sense on their own (e.g. an English idiom about coming`,
    `  down from a tree must become a natural ${languageName} phrase, not a literal`,
    `  one). If a literal rendering would be unclear, rephrase for clarity.`,
    `- Preserve the tone, warmth, theology, "you" address, and rough length.`,
    `  Do NOT add, drop, or change any idea.`,
    `- Preserve EVERY paragraph and EVERY sentence's point. If the reflection has`,
    `  two paragraphs, return two paragraphs covering all the same points. NEVER`,
    `  summarize, condense, merge, or omit — the output must be as long and`,
    `  complete as the source.`,
    `- Keep statements about who God is or what He does COMPLETE and faithful.`,
    `  Do not compress a declaration into a vaguer one: "the God we serve" must`,
    `  keep "serve" (Бог, которому мы служим), not collapse to "such is our God"`,
    `  (Вот какой наш Бог). Every clause of a faith statement must survive.`,
    `- GRAMMAR must be flawless: correct case government, agreement, prepositions.`,
    `  (Russian example: "угрожать" takes the dative — "что тебе угрожает", never`,
    `  "что тебя угрожает"; "иметь" is not used to mean "have someone near" —`,
    `  say "Иисус был рядом", not "ученики имели Иисуса".)`,
    `- The viewer's GENDER is unknown. Address them ("ты") with gender-NEUTRAL`,
    `  wording — avoid gendered short adjectives / past-tense forms about the`,
    `  viewer (сильна/силён, готова/готов). Reformulate ("у тебя хватает сил",`,
    `  not "ты сильна/силён"). If no natural neutral form exists, use MASCULINE,`,
    `  never feminine.`,
    `- The TITLE is the FIRST thing viewers see and the opening line spoken aloud.`,
    `  It must be crystal clear and natural — never awkward, convoluted, or`,
    `  ambiguous. A clean, well-formed question or statement.`,
    `- AVOID the em/en dash ("—", "–"). It reads as heavy on screen and in`,
    `  speech. Rephrase with commas, or split into separate sentences, the way`,
    `  natural spoken ${languageName} would. Capitalize pronouns referring to`,
    `  God/Jesus (Он, Его, Ему).`,
    `- Bible names use their standard ${languageName} spelling.`,
    `- PRESERVE THE VOICE OF THE REFLECTION AND THE CONCLUSION. The English`,
    `  original has already been checked against the owner's standing rules, so`,
    `  your job is to carry those properties across, not to re-decide them.`,
    `  Specifically, in the reflection and the conclusion only:`,
    `    · A statement stays a STATEMENT. ${languageName} slips into the`,
    `      imperative far more readily than English does, and a devotional read`,
    `      by a synthetic voice has no standing to give the viewer orders. Where`,
    `      the English asserts something, assert it; do not turn it into an`,
    `      instruction, an exhortation, or a collective "we must / let us".`,
    `    · Do NOT rank believers. If the English describes what faith does or`,
    `      sees, keep it about the faith; never render it as a higher or better`,
    `      class of Christian that the viewer might not belong to.`,
    `    · The CLOSING sentences must land as hopefully as the English does.`,
    `      Never let the ending become a warning, a demand, or a reproach in`,
    `      translation.`,
    `    · If the English says a line ONCE, say it once. Do not repeat a quoted`,
    `      line for emphasis; spoken over the film the viewer hears it twice`,
    `      already.`,
    `  The QUESTION and the PRAYER are exempt: the prayer is deliberately an`,
    `  invitation to pray ("Ask God to …") and must stay one.`,
    `Return JSON only: an object with title, reflection, conclusion, question, prayer.`,
  ].join("\n")
}

/** Scene context so references translate meaningfully (no context-free calques). */
export type TranslateContext = {
  sceneTitle: string
  scriptureReference?: string
  scriptureText?: string
}

export type TranslateDevotionalOptions = {
  copy: TranslatableCopy
  targetLang: DevotionalLang
  llm: DevotionalLlm
  context?: TranslateContext
}

/**
 * Translate the copy. `targetLang === "en"` is a no-op passthrough (the source
 * is already English) so callers can localize unconditionally.
 */
export async function translateDevotionalCopy(
  options: TranslateDevotionalOptions,
): Promise<TranslatableCopy> {
  if (options.targetLang === "en") {
    return { ...options.copy }
  }
  const languageName = LANGUAGE_NAMES[options.targetLang]

  const ctx = options.context
  const contextLines = ctx
    ? [
        "SCENE CONTEXT (for understanding references — do NOT translate this block):",
        `Bible scene: ${ctx.sceneTitle}`,
        ctx.scriptureReference && ctx.scriptureText
          ? `Scripture (${ctx.scriptureReference}): ${ctx.scriptureText}`
          : "",
        "",
      ].filter(Boolean)
    : []

  const user = [
    ...contextLines,
    "Translate these devotional fields. Return the same five keys.",
    "",
    `TITLE (cover hook): ${options.copy.title}`,
    "",
    `REFLECTION:\n${options.copy.reflection}`,
    "",
    `CONCLUSION (closing takeaway line): ${options.copy.conclusion}`,
    "",
    `QUESTION: ${options.copy.question}`,
    "",
    `PRAYER (invitation to pray): ${options.copy.prayer}`,
  ].join("\n")

  let result: z.infer<typeof TranslatedSchema>
  try {
    result = await options.llm.complete({
      system: buildTranslateSystemPrompt(languageName),
      user,
      jsonSchema: TRANSLATED_JSON_SCHEMA,
      schema: TranslatedSchema,
      temperature: 0.3,
      maxTokens: 1500,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new TranslateDevotionalError(
        "generation_failed",
        `devotional translation failed: ${error.code}`,
        error,
      )
    }
    throw error
  }

  const out: TranslatableCopy = {
    title: result.title.trim(),
    reflection: result.reflection.trim(),
    conclusion: result.conclusion.trim(),
    question: result.question.trim(),
    prayer: result.prayer.trim(),
  }
  if (Object.values(out).some((v) => !v)) {
    throw new TranslateDevotionalError(
      "empty_output",
      "translator returned an empty field",
    )
  }
  return out
}

function buildEditSystemPrompt(languageName: string): string {
  return [
    `You are a NATIVE ${languageName} editor polishing a short Christian`,
    `devotional that will be READ ALOUD. Rewrite the given ${languageName} fields`,
    `so they sound like a ${languageName} pastor wrote them from scratch.`,
    `- Fix anything that reads as a translation: kill calques, literal English`,
    `  word order, and phrases a native would never say. Make unclear sentences`,
    `  clear.`,
    `- Keep the SAME meaning, warmth, "you" address, theology, and rough length.`,
    `  Do NOT add or remove ideas, and do NOT re-translate — only improve fluency.`,
    `- Preserve ALL paragraphs and every point. Same number of paragraphs as the`,
    `  input; never shorten, merge, summarize, or drop sentences.`,
    `- Never compress or vague-out a statement of faith while polishing. Keep every`,
    `  clause's full meaning ("the God we serve" keeps "serve"). Fluency must never`,
    `  cost content.`,
    `- Fix any GRAMMAR errors: case government, agreement, prepositions (Russian:`,
    `  "что тебе угрожает" not "что тебя угрожает"; never "иметь" for "have someone`,
    `  near").`,
    `- Keep the address to the viewer ("ты") gender-NEUTRAL — no gendered short`,
    `  adjectives / past-tense about the viewer (reformulate: "у тебя хватает сил",`,
    `  not "ты сильна/силён"). If unavoidable, use MASCULINE, never feminine.`,
    `- The TITLE is the first thing viewers see and is spoken first: make it`,
    `  perfectly clear and natural, never awkward or convoluted.`,
    `- Natural ${languageName} punctuation; capitalize pronouns for God/Jesus`,
    `  (Он, Его, Ему). AVOID the em/en dash ("—", "–") — rephrase with commas or`,
    `  split the sentence instead.`,
    `Return JSON only: title, reflection, conclusion, question, prayer.`,
  ].join("\n")
}

/**
 * Second, monolingual pass: a native editor polishes the machine-translated
 * copy for fluency (removes calques / unnatural phrasing) WITHOUT re-translating
 * or changing meaning. English is a no-op passthrough.
 */
export async function editLocalizedCopy(
  options: TranslateDevotionalOptions,
): Promise<TranslatableCopy> {
  if (options.targetLang === "en") return { ...options.copy }
  const languageName = LANGUAGE_NAMES[options.targetLang]

  const user = [
    "Polish these fields for natural fluency. Return the same five keys.",
    "",
    `TITLE: ${options.copy.title}`,
    "",
    `REFLECTION:\n${options.copy.reflection}`,
    "",
    `CONCLUSION: ${options.copy.conclusion}`,
    "",
    `QUESTION: ${options.copy.question}`,
    "",
    `PRAYER: ${options.copy.prayer}`,
  ].join("\n")

  let result: z.infer<typeof TranslatedSchema>
  try {
    result = await options.llm.complete({
      system: buildEditSystemPrompt(languageName),
      user,
      jsonSchema: TRANSLATED_JSON_SCHEMA,
      schema: TranslatedSchema,
      temperature: 0.4,
      maxTokens: 1500,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      // Polish is best-effort: if the editor pass fails, keep the translation.
      return { ...options.copy }
    }
    throw error
  }

  const out: TranslatableCopy = {
    title: result.title.trim(),
    reflection: result.reflection.trim(),
    conclusion: result.conclusion.trim(),
    question: result.question.trim(),
    prayer: result.prayer.trim(),
  }
  // If the editor blanked anything, fall back to the pre-edit copy.
  return Object.values(out).some((v) => !v) ? { ...options.copy } : out
}

export const _internal = { JSON_SCHEMA: TRANSLATED_JSON_SCHEMA }
