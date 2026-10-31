// KTD1: Hermes has neither Intl.Locale nor Intl.PluralRules. The locale
// polyfill loads first because the plural polyfill's matcher calls
// `new Intl.Locale(...).maximize()`. Only localeStore.ts requires this module.
import "@formatjs/intl-locale/polyfill-force.js"
import "@formatjs/intl-pluralrules/polyfill-force.js"

import { PLURAL_DATA_LOADERS } from "./pluralData.generated"

const ENGLISH = "en"

const loaded = new Set<string>()

function load(tag: string, loaders: Readonly<Record<string, () => void>>) {
  if (loaded.has(tag)) return
  const loader = loaders[tag]
  if (!loader) throw new Error(`No plural data loader for "${tag}"`)
  loader()
  loaded.add(tag)
}

// English always registers first: the polyfill makes the first locale it gets
// its default, and the English fallback relies on that (KTD3). `loaders` is a
// test seam; the app always loads through the generated index (R8).
export function loadPluralData(
  tag: string,
  loaders: Readonly<Record<string, () => void>> = PLURAL_DATA_LOADERS,
): void {
  load(ENGLISH, PLURAL_DATA_LOADERS)
  load(tag, loaders)
}
