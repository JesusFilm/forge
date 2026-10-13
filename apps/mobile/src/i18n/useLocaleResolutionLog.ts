import { useEffect, useRef } from "react"

import { datadogLog } from "../lib/datadog"
import { readDirectionReloadKind } from "./lazyLayoutDirection"
import { getLocaleResolution, localeResolutionAttributes } from "./localeStore"

/** Logs `ui_locale.resolved` once per mount, on the first commit where
 *  `hydrated` is true. The root layout passes its cache hydration gate. */
export function useLocaleResolutionLog(hydrated: boolean): void {
  const loggedRef = useRef(false)
  useEffect(() => {
    if (!hydrated || loggedRef.current) return
    loggedRef.current = true
    // feat-695 U2: the log fires once per JavaScript runtime, so a runtime
    // after a direction reload says so.
    datadogLog.info("ui_locale.resolved", {
      ...localeResolutionAttributes(getLocaleResolution()),
      "ui_locale.direction_reload": readDirectionReloadKind() ?? "none",
    })
  }, [hydrated])
}
