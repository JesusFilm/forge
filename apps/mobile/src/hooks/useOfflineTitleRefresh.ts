import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"

import { currentAdminForms } from "../i18n/adminLanguage"
import { getCatalogTag, getLocaleEpoch } from "../i18n/localeStore"
import { useLocaleEpoch } from "../i18n/useT"
import type { OfflineTitlePatch } from "../lib/downloadLifecycle"
import type { OfflineDownloadRecord } from "../lib/offlineManifest"
import {
  createOfflineTitleRefresher,
  fetchOfflineTitleText,
  recordsNeedingTitles,
  type OfflineTitleRefreshDeps,
} from "../lib/offlineTitleRefresh"

export type UseOfflineTitleRefreshOptions = {
  /** The stored records have loaded. */
  ready: boolean
  records: readonly OfflineDownloadRecord[]
  /** `DownloadLifecycle.patchTitles`: a field-level write. */
  patchTitles: (videoSlug: string, fields: OfflineTitlePatch) => Promise<void>
}

/**
 * U7 (R4): the offline library's titles follow the UI language. A pass runs
 * when the records load, when the UI language changes, when a record needs
 * titles, and on each return to the foreground (the app may be online again).
 */
export function useOfflineTitleRefresh(
  options: UseOfflineTitleRefreshOptions,
  fetchText: OfflineTitleRefreshDeps["fetchText"] = fetchOfflineTitleText,
): void {
  const { ready, records } = options
  const recordsRef = useRef(records)
  recordsRef.current = records
  const patchRef = useRef(options.patchTitles)
  patchRef.current = options.patchTitles

  const [refresher] = useState(() =>
    createOfflineTitleRefresher({
      records: () => recordsRef.current,
      forms: currentAdminForms,
      epoch: getLocaleEpoch,
      fetchText,
      patch: (slug, fields) => patchRef.current(slug, fields),
    }),
  )

  const epoch = useLocaleEpoch()
  const staleKey = recordsNeedingTitles(records, getCatalogTag())
    .map((record) => record.videoSlug)
    .join("\n")

  useEffect(() => {
    if (ready && staleKey !== "") refresher.request()
  }, [ready, staleKey, epoch, refresher])

  useEffect(() => {
    if (!ready) return
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresher.request()
    })
    return () => subscription.remove()
  }, [ready, refresher])
}
