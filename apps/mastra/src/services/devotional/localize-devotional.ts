import type { DevotionalLocale } from "./devotional-locale"
import type { GeneratedDevotional } from "./generate-devotional"
import type { DevotionalLlm } from "./llm"
import { pickReflectionHighlights } from "./reflection-highlighter"
import { splitReflection } from "./reflection-split"
import { fetchSynodalPassage } from "./synodal-bible"
import {
  editLocalizedCopy,
  translateDevotionalCopy,
} from "./translate-devotional"

/**
 * Localize a finished ENGLISH devotional into the locale's language.
 *
 * The devotional is generated + safety-checked in English; this step produces
 * the target-language edition: translate the copy, swap in the REAL
 * target-language scripture (never machine-translated), re-pick the verbatim
 * reflection highlights on the translated text, set the locale's narration
 * voice, and localize the cover attribution prefix. The clip (chapter), passage,
 * mood, sequence, and date are unchanged — only the language surface differs.
 *
 * English is a no-op passthrough so callers can localize unconditionally.
 */

export type LocalizeDevotionalDeps = {
  translate?: typeof translateDevotionalCopy
  edit?: typeof editLocalizedCopy
  fetchScripture?: typeof fetchSynodalPassage
  pickHighlights?: typeof pickReflectionHighlights
}

export type LocalizeDevotionalOptions = {
  devotional: GeneratedDevotional
  locale: DevotionalLocale
  llm: DevotionalLlm
  /**
   * Optional stronger model for the translate + native-editor passes (natural
   * target-language adaptation). Defaults to `llm` when omitted.
   */
  translateLlm?: DevotionalLlm
}

export async function localizeDevotional(
  options: LocalizeDevotionalOptions,
  deps: LocalizeDevotionalDeps = {},
): Promise<GeneratedDevotional> {
  const { devotional: d, locale, llm } = options
  if (locale.lang === "en") return d

  // Translation + native-editor passes may use a stronger model than content.
  const translateLlm = options.translateLlm ?? llm
  const translate = deps.translate ?? translateDevotionalCopy
  const edit = deps.edit ?? editLocalizedCopy
  const fetchScripture = deps.fetchScripture ?? fetchSynodalPassage
  const pickHighlights = deps.pickHighlights ?? pickReflectionHighlights

  // Scripture (real target-language Bible) and copy translation are independent
  // — run them together. Translation is a two-pass: translate with scene context
  // (so references aren't context-free calques), then a native-editor polish.
  const [scripture, translated] = await Promise.all([
    // Mirror the English selection: fetch the SAME focused verse the English
    // devotional quotes (d.scripture.reference), not the broad passage.
    fetchScripture(d.scripture.reference),
    translate({
      copy: {
        title: d.title,
        reflection: d.reflection.text,
        conclusion: d.conclusion,
        question: d.question,
        prayer: d.prayer,
      },
      targetLang: locale.lang,
      llm: translateLlm,
      context: {
        sceneTitle: d.clip.title,
        scriptureReference: d.scripture.reference,
        scriptureText: d.scripture.text,
      },
    }),
  ])
  const edited = await edit({
    copy: translated,
    targetLang: locale.lang,
    llm: translateLlm,
  })
  // Deterministic typography fix-up (e.g. Russian spaces the em dash). Copy
  // only — scripture is the authoritative target-language Bible, left as-is.
  const norm = locale.normalizeCopy ?? ((s: string) => s)
  const copy = {
    title: norm(edited.title),
    reflection: norm(edited.reflection),
    conclusion: norm(edited.conclusion),
    question: norm(edited.question),
    prayer: norm(edited.prayer),
  }

  // Verbatim accent phrases must match the TRANSLATED reflection text.
  const reflectionHighlights = await pickHighlights({
    chunks: splitReflection(copy.reflection),
    llm,
  })

  // Keep the author, localize the "Adapted from …" prefix AND the author name
  // itself (e.g. "Matthew Henry" → "Мэтью Генри").
  const rawAuthor = d.reflection.attribution.includes("·")
    ? d.reflection.attribution.split("·").pop()!.trim()
    : d.reflection.source.split(",")[0].trim()
  const author = locale.localizeAuthor ? locale.localizeAuthor(rawAuthor) : rawAuthor

  // DROP the English `parts`. They are the two reflection halves used to place
  // the act-2 video card, and the manifest derives that position by counting
  // SENTENCES in parts[0] (`splitReflection(parts[0]).length`) against segments
  // built from the TRANSLATED text. English and Russian sentence counts have no
  // fixed relationship, so keeping them puts the second clip under the wrong
  // sentence — chapter 33 already ships with `splitActs: true`, so this was
  // reachable on the default `--lang=ru` path.
  //
  // Dropping them makes a localized devotional fall back to the single-clip
  // layout: correct, just without the two-act treatment. Restoring two acts for
  // a localized edition means translating each half and re-deriving the
  // boundary from the translated halves, which is a change to the translation
  // schema (TranslatableCopy) rather than something to fake here.
  const { parts: _englishParts, ...reflectionWithoutParts } = d.reflection

  return {
    ...d,
    title: copy.title,
    scripture: {
      reference: scripture.reference,
      text: scripture.text,
      translation: "Синодальный перевод",
      needsCanonicalSource: false,
    },
    reflection: {
      ...reflectionWithoutParts,
      text: copy.reflection,
      attribution: `${locale.attributionPrefix} · ${author}`,
    },
    reflectionHighlights,
    conclusion: copy.conclusion,
    question: copy.question,
    prayer: copy.prayer,
    voice: locale.voice === "rotate" ? d.voice : locale.voice,
  }
}
