"use client"

import type { SearchResult } from "./search"
import { tryAsContentSlug, tryAsLocaleSlug } from "./routes"

export const WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY =
  "watch:unavailable-language-recovery:v2"
export const WATCH_UNAVAILABLE_RECOVERY_MAX_BYTES = 16 * 1024
export const WATCH_UNAVAILABLE_RECOVERY_TTL_MS = 5 * 60 * 1000

export type WatchUnavailableRecoveryContext = {
  version: 2
  createdAt: number
  target: {
    slug: string
    title: string
    imageUrl: string | null
    requestedLanguageSlug: string
    requestedLanguageName: string | null
  }
}

type WriteInput = {
  target: SearchResult
  requestedLanguageSlug: string
  requestedLanguageName?: string | null
  storage?: Storage
  now?: number
}

type ConsumeInput = {
  contentSlug: string
  requestedLanguageSlug: string
  storage?: Storage
  now?: number
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

function safeImageUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2_048) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

function boundedTitle(value: string): string | null {
  const title = value.trim()
  return title.length > 0 && title.length <= 300 ? title : null
}

export function writeWatchUnavailableRecoveryContext({
  target,
  requestedLanguageSlug,
  requestedLanguageName,
  storage = browserSessionStorage() ?? undefined,
  now = Date.now(),
}: WriteInput): boolean {
  if (!storage || target.availabilityKind !== "unavailable") return false
  const targetSlug = tryAsContentSlug(target.slug)
  const requestedLanguage = tryAsLocaleSlug(requestedLanguageSlug)
  const targetTitle = boundedTitle(target.title)
  if (!targetSlug || !requestedLanguage || !targetTitle) return false

  const context: WatchUnavailableRecoveryContext = {
    version: 2,
    createdAt: now,
    target: {
      slug: targetSlug,
      title: targetTitle,
      imageUrl: safeImageUrl(target.imageUrl),
      requestedLanguageSlug: requestedLanguage,
      requestedLanguageName:
        requestedLanguageName && boundedTitle(requestedLanguageName)
          ? requestedLanguageName.trim()
          : null,
    },
  }
  const serialized = JSON.stringify(context)
  if (
    new TextEncoder().encode(serialized).byteLength >
    WATCH_UNAVAILABLE_RECOVERY_MAX_BYTES
  ) {
    return false
  }
  try {
    storage.setItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY, serialized)
    return true
  } catch {
    return false
  }
}

function removeStoredRecoveryContext(storage: Storage): void {
  try {
    storage.removeItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY)
  } catch {
    // Browser storage is optional; an unsuccessful cleanup must not block UI.
  }
}

export function readWatchUnavailableRecoveryContext({
  contentSlug,
  requestedLanguageSlug,
  storage = browserSessionStorage() ?? undefined,
  now = Date.now(),
}: ConsumeInput): WatchUnavailableRecoveryContext | null {
  if (!storage) return null
  let serialized: string | null = null
  try {
    serialized = storage.getItem(WATCH_UNAVAILABLE_RECOVERY_STORAGE_KEY)
  } catch {
    return null
  }
  if (
    !serialized ||
    new TextEncoder().encode(serialized).byteLength >
      WATCH_UNAVAILABLE_RECOVERY_MAX_BYTES
  ) {
    if (serialized) removeStoredRecoveryContext(storage)
    return null
  }
  try {
    const value = JSON.parse(serialized) as unknown
    if (!isRecoveryContext(value)) {
      removeStoredRecoveryContext(storage)
      return null
    }
    if (
      value.target.slug !== contentSlug ||
      value.target.requestedLanguageSlug !== requestedLanguageSlug
    ) {
      removeStoredRecoveryContext(storage)
      return null
    }
    if (
      now < value.createdAt ||
      now - value.createdAt > WATCH_UNAVAILABLE_RECOVERY_TTL_MS
    ) {
      removeStoredRecoveryContext(storage)
      return null
    }
    return value
  } catch {
    removeStoredRecoveryContext(storage)
    return null
  }
}

function isRecoveryContext(
  value: unknown,
): value is WatchUnavailableRecoveryContext {
  if (typeof value !== "object" || value == null) return false
  const candidate = value as Partial<WatchUnavailableRecoveryContext>
  if (
    candidate.version !== 2 ||
    typeof candidate.createdAt !== "number" ||
    !Number.isFinite(candidate.createdAt) ||
    !candidate.target
  ) {
    return false
  }
  const target = candidate.target
  if (
    !tryAsContentSlug(target.slug) ||
    !boundedTitle(target.title) ||
    !tryAsLocaleSlug(target.requestedLanguageSlug) ||
    (target.requestedLanguageName != null &&
      !boundedTitle(target.requestedLanguageName)) ||
    target.imageUrl !== safeImageUrl(target.imageUrl)
  ) {
    return false
  }
  return true
}
