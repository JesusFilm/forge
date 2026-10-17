// KTD15: display names sort in the UI language's order, so one UI tag gives
// one order on every device; ids sort by code unit, the same in every language.

type Compare = (a: string, b: string) => number

// Keyed on the tag, never the locale epoch (KTD2).
const byTag = new Map<string, Compare>()

function collatorFor(locale: string | undefined): Compare {
  // "accent" ignores case and keeps accents, like the lower-cased compare
  // this replaces, without a new string per comparison.
  const collator = new Intl.Collator(locale, { sensitivity: "accent" })
  return (a, b) => collator.compare(a, b)
}

function createCompare(uiTag: string): Compare {
  try {
    return collatorFor(uiTag)
  } catch {
    // A tag Intl refuses, or an engine without Intl.Collator.
  }
  try {
    return collatorFor(undefined)
  } catch {
    return (a, b) => a.toLowerCase().localeCompare(b.toLowerCase())
  }
}

/** Compares display names in the collation of the UI language tag. */
export function nameComparator(uiTag: string): Compare {
  let compare = byTag.get(uiTag)
  if (!compare) {
    compare = createCompare(uiTag)
    byTag.set(uiTag, compare)
  }
  return compare
}

/** Compares ids by UTF-16 code unit, so the order never depends on language. */
export function compareIds(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
