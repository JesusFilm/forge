import { WATCH_BASE_PATH } from "../../watch-base-path.mjs"

const SCRIPT_FONT_PRELOADS: Readonly<Record<string, string>> = {
  Arab: `${WATCH_BASE_PATH}/fonts/noto-sans-arabic.woff2`,
  Hebr: `${WATCH_BASE_PATH}/fonts/noto-sans-hebrew.woff2`,
  Deva: `${WATCH_BASE_PATH}/fonts/noto-sans-devanagari.woff2`,
  Thai: `${WATCH_BASE_PATH}/fonts/noto-sans-thai.woff2`,
  Ethi: `${WATCH_BASE_PATH}/fonts/noto-sans-ethiopic.woff2`,
}

/**
 * Urdu is Arabic script but set in Nastaliq (see the `:root:lang(ur)` rule in
 * globals.css), so its documents preload that face instead of the Naskh one —
 * which they never render, because Nastaliq covers every Arabic code point the
 * Naskh subset would.
 */
const URDU_FONT_PRELOAD = `${WATCH_BASE_PATH}/fonts/noto-nastaliq-urdu.woff2`

/** Return the one script subset worth preloading for this document language. */
export function watchScriptFontPreload(htmlLang: string): string | null {
  try {
    const locale = new Intl.Locale(htmlLang)
    // Mirror the stylesheet's `:lang(ur)` on the RAW primary subtag: Intl
    // canonicalizes the ISO 639-3 alias `urd` (htmlLang of the urdu-hoda and
    // urdu-indian variants) to `ur`, which CSS does not, so using
    // `locale.language` would preload a Nastaliq face those documents never
    // render. `ur-Latn` is excluded as Latin text; no declared htmlLang yields it.
    const primary = htmlLang.split("-")[0]?.toLowerCase()
    if (primary === "ur" && locale.maximize().script === "Arab") {
      return URDU_FONT_PRELOAD
    }
    const script = locale.maximize().script
    return script ? (SCRIPT_FONT_PRELOADS[script] ?? null) : null
  } catch {
    return null
  }
}
