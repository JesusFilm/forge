import { useEffect, useRef } from "react"

import { datadogLog } from "../lib/datadog"
import { getLocaleResolution, localeResolutionAttributes } from "./localeStore"

/** Logs `ui_locale.resolved` once per mount, on the first commit where
 *  `hydrated` is true. The root layout passes its cache hydration gate. */
export function useLocaleResolutionLog(hydrated: boolean): void {
  const loggedRef = useRef(false)
  useEffect(() => {
    if (!hydrated || loggedRef.current) return
    loggedRef.current = true
    datadogLog.info(
      "ui_locale.resolved",
      localeResolutionAttributes(getLocaleResolution()),
    )
  }, [hydrated])
}
