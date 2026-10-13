/**
 * Detects ICU plural blocks that don't define every category a locale's own
 * CLDR plural rules require. next-intl does not error on a missing category
 * — it silently falls back to `other` (confirmed by hand: an
 * `{count, plural, one {..} other {..}}` block formats Arabic's count=2 and
 * count=11 with no error, though Arabic requires `two` and `many`) — which
 * is how forge#N33 (Arabic item counts in the wrong plural form) shipped.
 *
 * Single source of truth for "what counts as a gap", shared by the
 * completeness test in __tests__/messages-parity.test.ts and by
 * scripts/generate-plural-category-gaps.ts, which regenerates the tracked
 * backlog in docs/i18n/watch-ui-plural-category-gaps.json.
 */

export type MessageTree = { [key: string]: string | MessageTree }

export type PluralCategoryGap = {
  path: string
  variable: string
  missing: string[]
}

export function extractPluralBlocks(
  message: string,
): Array<{ variable: string; categories: Set<string> }> {
  const blocks: Array<{ variable: string; categories: Set<string> }> = []
  const pluralHeaderPattern = /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*plural\s*,\s*/g
  let match: RegExpExecArray | null
  while ((match = pluralHeaderPattern.exec(message))) {
    const variable = match[1]
    let i = pluralHeaderPattern.lastIndex
    const categories = new Set<string>()
    while (i < message.length) {
      while (i < message.length && /\s/.test(message[i])) i++
      if (message[i] === "}") {
        i++
        break
      }
      const catStart = i
      while (i < message.length && /[A-Za-z0-9_=]/.test(message[i])) i++
      const category = message.slice(catStart, i)
      while (i < message.length && /\s/.test(message[i])) i++
      if (message[i] !== "{") break
      let bodyDepth = 0
      do {
        if (message[i] === "{") bodyDepth++
        else if (message[i] === "}") bodyDepth--
        i++
      } while (i < message.length && bodyDepth > 0)
      if (category) categories.add(category)
    }
    blocks.push({ variable, categories })
    pluralHeaderPattern.lastIndex = i
  }
  return blocks
}

/** The categories a locale's CLDR rules require, or null if Intl can't resolve the tag. */
export function requiredPluralCategories(locale: string): string[] | null {
  try {
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories
  } catch {
    return null
  }
}

export function pluralGapKey(path: string, variable: string): string {
  return `${path}::${variable}`
}

/** Every plural block in `catalog` missing a category `locale` requires; null if unresolvable. */
export function findPluralCategoryGaps(
  locale: string,
  catalog: MessageTree,
): PluralCategoryGap[] | null {
  const required = requiredPluralCategories(locale)
  if (required == null) return null

  const gaps: PluralCategoryGap[] = []
  function visit(value: string | MessageTree, path: string[]): void {
    if (typeof value !== "string") {
      for (const [key, child] of Object.entries(value)) {
        visit(child, [...path, key])
      }
      return
    }
    for (const block of extractPluralBlocks(value)) {
      const missing = required!
        .filter((category) => category !== "other")
        .filter((category) => !block.categories.has(category))
        .sort()
      if (missing.length > 0) {
        gaps.push({ path: path.join("."), variable: block.variable, missing })
      }
    }
  }
  visit(catalog, [])
  return gaps
}
