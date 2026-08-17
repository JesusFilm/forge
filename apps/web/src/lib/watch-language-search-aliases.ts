export type WatchLanguageSearchAliasAuthority = {
  readonly aliasesBySlug: Readonly<Record<string, readonly string[]>>
  readonly exactAliases: ReadonlySet<string>
}

const EMPTY_LANGUAGE_SEARCH_ALIASES: readonly string[] = []

/**
 * Chinese search terms reviewed against exact Forge language identities.
 *
 * Keep this table explicit: a BCP-47 family or prefix cannot prove that two
 * public language slugs describe the same language. New entries require a
 * language-identity review before they become searchable here.
 */
export const WATCH_LANGUAGE_SEARCH_ALIASES = {
  cantonese: ["粤语", "粵語", "中文"],
  "chinese-guiliu": ["中文"],
  "chinese-hokkien-amoy": ["中文"],
  "chinese-qinghai": ["中文"],
  "chinese-sichuan": ["中文"],
  "chinese-simplified": ["简体", "簡體", "简体中文", "簡體中文", "中文"],
  "chinese-traditional": ["繁体", "繁體", "繁体中文", "繁體中文", "中文"],
  "chinese-yunnan-kunming": ["中文"],
  foochow: ["中文"],
  hainanese: ["中文"],
  hakka: ["中文"],
  hui: ["中文"],
  "mandarin-china": ["普通话", "普通話", "中文"],
  "mandarin-taiwan": ["国语", "國語", "台湾华语", "臺灣華語", "中文"],
  "penang-hokkien": ["中文"],
  "pontianak-hakka": ["中文"],
  shanghainese: ["中文"],
  teochew: ["中文"],
  xiang: ["中文"],
} as const satisfies Readonly<Record<string, readonly string[]>>

export const WATCH_LANGUAGE_SEARCH_EXACT_ALIASES: ReadonlySet<string> = new Set(
  Object.values(WATCH_LANGUAGE_SEARCH_ALIASES)
    .flat()
    .map((alias) => alias.trim().toLowerCase()),
)

export const WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY = {
  aliasesBySlug: WATCH_LANGUAGE_SEARCH_ALIASES,
  exactAliases: WATCH_LANGUAGE_SEARCH_EXACT_ALIASES,
} as const satisfies WatchLanguageSearchAliasAuthority

export function watchLanguageSearchAliasesFor(slug: string): readonly string[] {
  if (!Object.hasOwn(WATCH_LANGUAGE_SEARCH_ALIASES, slug)) {
    return EMPTY_LANGUAGE_SEARCH_ALIASES
  }

  return WATCH_LANGUAGE_SEARCH_ALIASES[
    slug as keyof typeof WATCH_LANGUAGE_SEARCH_ALIASES
  ]
}
