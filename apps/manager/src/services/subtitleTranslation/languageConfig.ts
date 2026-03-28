// Load optional per-language config (custom prompt + glossary).
// Config files live at src/config/languages/{lang}.json.
// Returns undefined if no config exists for the language.

import type { LanguageConfig } from "./types"

const configCache = new Map<string, LanguageConfig | null>()

export async function loadLanguageConfig(
  lang: string,
): Promise<LanguageConfig | undefined> {
  if (configCache.has(lang)) {
    return configCache.get(lang) ?? undefined
  }

  try {
    const config = (await import(
      `@/config/languages/${lang}.json`
    )) as LanguageConfig
    configCache.set(lang, config)
    return config
  } catch {
    configCache.set(lang, null)
    return undefined
  }
}
