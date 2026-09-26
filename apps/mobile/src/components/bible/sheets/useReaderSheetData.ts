// What the three reader sheet routes read (feat-553 U10): the reader's theme
// and the bundled catalog.
import { useCallback, useEffect, useState } from "react"
import { useColorScheme } from "react-native"

import type { BundledResult } from "../../../lib/bible/data/bundled"
import type { Catalog } from "../../../lib/bible/data/catalog"
import {
  useReaderSettings,
  type ReaderSettingsSnapshot,
  type ReaderSettingsStore,
} from "../../../lib/bible/settings/store"
import {
  readerTokens,
  resolveReaderScheme,
  type ReaderTokens,
} from "../../../lib/bible/theme/palettes"

/** KTD12: the sheets follow the reader's theme, not the app's. */
export function useReaderSheetTheme(store: ReaderSettingsStore): {
  settings: ReaderSettingsSnapshot
  tokens: ReaderTokens
} {
  const settings = useReaderSettings(store)
  const systemScheme = useColorScheme()
  return {
    settings,
    tokens: readerTokens(
      settings.palette,
      resolveReaderScheme(settings.mode, systemScheme),
    ),
  }
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
