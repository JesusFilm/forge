"use client"

import { useEffect, useSyncExternalStore } from "react"

import type { WatchAudienceConfig } from "@/lib/watch-audience-config"

// Which audience configuration the current page is showing, if any. The
// header role chip lives in the shared chrome, which knows neither the
// feature flag nor the published configuration; the page's audience frame
// registers here while mounted, so the chip appears exactly where the frame
// does (flag on, configuration accepted) and with the same roles.

export type WatchAudiencePresence = {
  config: WatchAudienceConfig
  languageSlug: string | null
}

const listeners = new Set<() => void>()
const entries: { id: number; presence: WatchAudiencePresence }[] = []
let nextId = 0

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The most recently mounted frame wins; null while no frame is shown. */
function getSnapshot(): WatchAudiencePresence | null {
  return entries.at(-1)?.presence ?? null
}

function getServerSnapshot(): WatchAudiencePresence | null {
  return null
}

export function useRegisterWatchAudiencePresence(
  config: WatchAudienceConfig | null,
  languageSlug: string | null,
) {
  useEffect(() => {
    if (!config) return
    const id = nextId++
    entries.push({ id, presence: { config, languageSlug } })
    notify()
    return () => {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index !== -1) entries.splice(index, 1)
      notify()
    }
  }, [config, languageSlug])
}

export function useWatchAudiencePresence(): WatchAudiencePresence | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
