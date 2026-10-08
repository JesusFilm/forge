import { WATCH_BASE_PATH } from "../../watch-base-path.mjs"

const SCRIPT_FONT_PRELOADS: Readonly<Record<string, string>> = {
  Arab: `${WATCH_BASE_PATH}/fonts/noto-sans-arabic.woff2`,
  Hebr: `${WATCH_BASE_PATH}/fonts/noto-sans-hebrew.woff2`,
  Deva: `${WATCH_BASE_PATH}/fonts/noto-sans-devanagari.woff2`,
  Thai: `${WATCH_BASE_PATH}/fonts/noto-sans-thai.woff2`,
  Ethi: `${WATCH_BASE_PATH}/fonts/noto-sans-ethiopic.woff2`,
}

/** Return the one script subset worth preloading for this document language. */
export function watchScriptFontPreload(htmlLang: string): string | null {
  try {
    const script = new Intl.Locale(htmlLang).maximize().script
    return script ? (SCRIPT_FONT_PRELOADS[script] ?? null) : null
  } catch {
    return null
  }
}
