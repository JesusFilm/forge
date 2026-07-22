import { useCallback } from "react"

import { usePersistedPrefs } from "../persistedPrefs"
import {
  DEFAULT_SHOWCASE_PREFS,
  loadShowcasePrefs,
  mergeShowcasePrefs,
  saveShowcasePrefs,
} from "./prefs"
import type { ShowcasePrefs } from "./prefs"

type UseShowcasePrefsResult = {
  prefs: ShowcasePrefs
  /** False until the on-disk read resolves — gates the launch-only auto-start check. */
  hydrated: boolean
  setAutoStart: (autoStart: boolean) => void
}

/**
 * On-device showcase preferences: hydrates on mount, persists every mutation.
 * Only an explicit setAutoStart writes; mounting and unmounting never do (AE2).
 * The React-free policy it wraps lives in ./prefs, where the tests reach it.
 */
export function useShowcasePrefs(): UseShowcasePrefsResult {
  const { prefs, hydrated, setPref } = usePersistedPrefs<ShowcasePrefs>({
    defaults: DEFAULT_SHOWCASE_PREFS,
    load: loadShowcasePrefs,
    save: saveShowcasePrefs,
    merge: mergeShowcasePrefs,
  })

  const setAutoStart = useCallback(
    (autoStart: boolean) => setPref("autoStart", autoStart),
    [setPref],
  )

  return { prefs, hydrated, setAutoStart }
}
