// What the three reader sheet routes read (feat-553 U10): the reader's theme
// and the bundled catalog.
import { useCallback, useEffect, useState } from "react"

import { usePhoneColorScheme } from "../../../hooks/usePhoneColorScheme"
import type { BundledResult } from "../../../lib/bible/data/bundled"
import type { Catalog } from "../../../lib/bible/data/catalog"
import {
  useReaderSettings,
  type ReaderSettingsSnapshot,
  type ReaderSettingsStore,
} from "../../../lib/bible/settings/store"
import {
  readerTokens,
  resolveReaderTheme,
  type ReaderTheme,
  type ReaderTokens,
} from "../../../lib/bible/theme/palettes"
import { sheetBackground } from "../../../lib/sheetOptions"

/** KTD12: the sheets follow the reader's theme, not the app's. */
export function useReaderSheetTheme(store: ReaderSettingsStore): {
  settings: ReaderSettingsSnapshot
  tokens: ReaderTokens
  /** The fill of the sheet's screen and body (feat-705 KTD7, R15). */
  background: string
} {
  const settings = useReaderSettings(store)
  const systemScheme = usePhoneColorScheme()
  const theme = resolveReaderTheme(settings.mode, systemScheme)
  const tokens = readerTokens(theme)
  return { settings, tokens, background: readerSheetBackground(theme, tokens) }
}

/**
 * Only Dark clears the fill for the system glass sheet: the dark app style
 * would put dark glass behind a Light page, and True Dark stays pure black.
 * Dark and True Dark share `scheme`, so the theme name decides.
 */
function readerSheetBackground(theme: ReaderTheme, tokens: ReaderTokens) {
  return theme === "dark"
    ? sheetBackground(tokens.background)
    : tokens.background
}

export type SheetCatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "failed" }

/** `load` never rejects (reader/services.ts); a failed read can retry. */
export function useSheetCatalog(load: () => Promise<BundledResult<Catalog>>): {
  state: SheetCatalogState
  retry: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<SheetCatalogState>({ status: "loading" })

  useEffect(() => {
    // Per effect, so StrictMode's first run cannot write after its cleanup.
    let live = true
    void load().then((result) => {
      if (!live) return
      setState(
        result.status === "ok"
          ? { status: "ready", catalog: result.value }
          : { status: "failed" },
      )
    })
    return () => {
      live = false
    }
  }, [load, attempt])

  const retry = useCallback(() => {
    setState({ status: "loading" })
    setAttempt((value) => value + 1)
  }, [])

  return { state, retry }
}
