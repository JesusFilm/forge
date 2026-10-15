/**
 * The language name the `LanguageInventory` templates interpolate as
 * `{language}`.
 *
 * Admin's native name is stored capitalised ("Español"), which is right as a
 * title ("Español videos") but wrong mid-sentence in languages that do not
 * capitalise language names ("Vídeos cristianos gratuitos en Español" should be
 * "... en español"). When the inventory language IS the UI language, the UI
 * locale's own CLDR name for itself is the correctly cased in-sentence form.
 *
 * Two guards keep this from reading worse anywhere:
 *
 *  - The CLDR name is only used when it equals admin's name ignoring case, so
 *    the rule can change CASE only, never the wording, and a language the UI
 *    locale merely resembles (`es-419` on `es`) is left exactly as admin has it.
 *  - Templates that put `{language}` first, or after a sentence terminator,
 *    keep the capitalised form: lower-casing there would break the sentence
 *    (`az`, `kk`, `ba` open their titles with the language name).
 */

function ownLanguageName(uiLocale: string): string | null {
  try {
    return (
      new Intl.DisplayNames([uiLocale], { type: "language" })
        .of(uiLocale)
        ?.trim() || null
    )
  } catch {
    return null
  }
}

// Start of the string, or a sentence terminator (Latin, CJK, Arabic, Devanagari
// danda) followed only by whitespace and opening markup.
const SENTENCE_START_PREFIX = /(?:^|[.!?。！？؟।]\s*)$/u

function startsSentenceInTemplate(template: string): boolean {
  for (const match of template.matchAll(/\{language\}/g)) {
    // Ignore rich-text markup the template wraps around the placeholder.
    const prefix = template
      .slice(0, match.index)
      .replace(/<\/?[a-zA-Z][^>]*>\s*$/u, "")
    if (SENTENCE_START_PREFIX.test(prefix)) return true
  }
  return false
}

export function inventoryLanguageNameForTemplate({
  name,
  uiLocale,
  template,
}: {
  /** Admin's native name, else its English name. */
  name: string
  uiLocale: string
  /** The raw (uninterpolated) catalog string the name is placed into. */
  template: unknown
}): string {
  const own = ownLanguageName(uiLocale)
  if (!own || own === name) return name
  if (own.toLocaleLowerCase(uiLocale) !== name.toLocaleLowerCase(uiLocale)) {
    return name
  }
  // A template we cannot read is treated as sentence-initial: capitalised is
  // the safe, pre-existing behaviour.
  if (typeof template !== "string" || startsSentenceInTemplate(template)) {
    return name
  }
  return own
}
