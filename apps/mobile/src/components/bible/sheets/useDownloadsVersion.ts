import { useEffect, useReducer } from "react"

import type { TranslationDownloads } from "../../../lib/bible/repository/translationDownloads"

/** A number that changes at each download store change, for list memos. */
export function useDownloadsVersion(
  downloads: Pick<TranslationDownloads, "subscribe" | "check">,
): number {
  const [version, bump] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const unsubscribe = downloads.subscribe(bump)
    // A rejected check leaves each download reading as not downloaded.
    void Promise.resolve()
      .then(() => downloads.check())
      .catch(() => undefined)
    return unsubscribe
  }, [downloads])
  return version
}
