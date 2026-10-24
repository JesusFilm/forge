import type { LanguageConfig } from "./types"

const configCache = new Map<string, LanguageConfig | null>()

export async function loadLanguageConfig(
  language: string,
): Promise<LanguageConfig | undefined> {
  if (configCache.has(language)) {
    return configCache.get(language) ?? undefined
  }

  try {
    const importedConfigModule = (await import(
      `../../config/languages/${language}.json`
    )) as LanguageConfig & { default?: LanguageConfig }
    const config = importedConfigModule.default ?? importedConfigModule
    configCache.set(language, config)
    return config
  } catch {
    configCache.set(language, null)
    return undefined
  }
}

export const _internals = {
  configCache,
}
