import { useSyncExternalStore } from "react"

import {
  DEFAULT_WATCH_AUDIENCE_ROLE_ID,
  WATCH_AUDIENCE_CODE_CONFIG,
  isWatchAudienceRoleId,
  type WatchAudienceRoleId,
} from "@/lib/watch-audience-config"

// The visitor's "who is this for" role, shared by every Watch audience surface.
// Only the role id is ever persisted, and only when the visitor picks one:
// a `?as=` URL hint is read for the page it opens and never written, and
// questionnaire answers, identity and tokens never touch this store. Public
// Watch pages are statically cached, so the server always renders Explore and
// the client store takes over after hydration.

export type WatchRole = WatchAudienceRoleId

/** Role chips, in authored order. Copy lives in the audience config. */
export const WATCH_ROLES: {
  id: WatchRole
  label: string
  hint: string
  /** Header chip copy, first person. */
  chip: string
}[] = WATCH_AUDIENCE_CODE_CONFIG.roles.map(({ id, label, hint, chip }) => ({
  id,
  label,
  hint,
  chip,
}))

export const isWatchRole = isWatchAudienceRoleId

const STORAGE_KEY = "forge.watch.role"
const HINT_PARAM = "as"

const listeners = new Set<() => void>()

/** `undefined` until first read after the last subscriber left. */
let urlHint: WatchRole | null | undefined
/** An explicit choice supersedes the hint that opened the page. */
let hintSuperseded = false
/** Cached storage read; cleared whenever storage may have changed. */
let stored: WatchRole | null | undefined
/** An explicit choice storage refused to keep: lives for the session only. */
let sessionChoice: WatchRole | null = null

function readUrlHint(): WatchRole | null {
  const value = new URLSearchParams(window.location.search).get(HINT_PARAM)
  return isWatchRole(value) ? value : null
}

function readStored(): WatchRole | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isWatchRole(value) ? value : null
  } catch {
    return null
  }
}

function getSnapshot(): WatchRole {
  if (urlHint === undefined) urlHint = readUrlHint()
  if (urlHint && !hintSuperseded) return urlHint
  if (sessionChoice) return sessionChoice
  if (stored === undefined) stored = readStored()
  return stored ?? DEFAULT_WATCH_AUDIENCE_ROLE_ID
}

function getServerSnapshot(): WatchRole {
  return DEFAULT_WATCH_AUDIENCE_ROLE_ID
}

function notify() {
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  // `key === null` is `localStorage.clear()` in another tab.
  if (event.key !== null && event.key !== STORAGE_KEY) return
  stored = undefined
  notify()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage)
      // The next page re-reads its own URL hint and storage.
      urlHint = undefined
      hintSuperseded = false
      stored = undefined
    }
  }
}

export function setWatchRole(role: WatchRole) {
  hintSuperseded = true
  try {
    window.localStorage.setItem(STORAGE_KEY, role)
    sessionChoice = null
  } catch {
    sessionChoice = role
  }
  stored = undefined
  notify()
}

/**
 * Current role plus whether the client has hydrated. Before hydration the
 * server snapshot (Explore) is returned so markup matches; callers that must
 * not flash the wrong role can gate on `hydrated`.
 */
export function useWatchRole(): { role: WatchRole; hydrated: boolean } {
  const role = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  return { role, hydrated }
}
