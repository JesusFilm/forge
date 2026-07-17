"use client"

import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"

export type WatchInteractionKey = "language" | "search" | "share" | "download"

type InteractionLoader = () => Promise<unknown>
type LanguageOptionsLoader = (input: {
  videoSlug: string
}) => Promise<LanguagePickerVariant[]>

type StoredLanguageOptionsPayload = {
  version: 1
  variants: LanguagePickerVariant[]
}

const WATCH_INTERACTION_WARM_ORDER = [
  "language",
  "search",
  "share",
  "download",
] as const satisfies readonly WatchInteractionKey[]
const WATCH_LANGUAGE_OPTIONS_STORAGE_VERSION = 1
const WATCH_LANGUAGE_OPTIONS_STORAGE_KEY_PREFIX =
  "forge.watch.languageOptions.v1:"

const defaultInteractionLoaders: Record<
  WatchInteractionKey,
  InteractionLoader
> = {
  language: () => import("@/components/watch/LanguagePickerModal"),
  search: () => import("@/components/FloatingSearchController"),
  share: () => import("@/components/watch/ShareModal"),
  download: () => import("@/components/watch/DownloadModal"),
}

let interactionLoaders: Record<WatchInteractionKey, InteractionLoader> = {
  ...defaultInteractionLoaders,
}

let languageOptionsLoader: LanguageOptionsLoader = async ({ videoSlug }) => {
  const languageActions = await import("@/lib/watch-language-actions")
  return languageActions.loadWatchLanguageOptions({ videoSlug })
}

const interactionPromises = new Map<WatchInteractionKey, Promise<unknown>>()
const languageOptionsPromises = new Map<
  string,
  Promise<LanguagePickerVariant[]>
>()
const languageOptionsResults = new Map<string, LanguagePickerVariant[]>()
const storageHydratedLanguageOptions = new Set<string>()

export function loadWatchInteraction(
  key: WatchInteractionKey,
): Promise<unknown> {
  const existing = interactionPromises.get(key)
  if (existing) return existing

  const promise = interactionLoaders[key]().catch((error: unknown) => {
    interactionPromises.delete(key)
    throw error
  })
  interactionPromises.set(key, promise)
  return promise
}

export function getCachedWatchLanguageOptions(
  videoSlug: string,
): LanguagePickerVariant[] | null {
  const cached = languageOptionsResults.get(videoSlug)
  if (cached) return cached

  const stored = readStoredWatchLanguageOptions(videoSlug)
  if (!stored) return null

  languageOptionsResults.set(videoSlug, stored)
  storageHydratedLanguageOptions.add(videoSlug)
  return stored
}

export function shouldRefreshCachedWatchLanguageOptions(
  videoSlug: string,
): boolean {
  return storageHydratedLanguageOptions.has(videoSlug)
}

export function loadWatchLanguageOptionsForVideo(
  videoSlug: string,
  options: { forceRefresh?: boolean } = {},
): Promise<LanguagePickerVariant[]> {
  const cached = options.forceRefresh
    ? null
    : getCachedWatchLanguageOptions(videoSlug)
  if (cached) return Promise.resolve(cached)

  const existing = languageOptionsPromises.get(videoSlug)
  if (existing) return existing
  if (options.forceRefresh) {
    storageHydratedLanguageOptions.delete(videoSlug)
  }

  const promise = languageOptionsLoader({ videoSlug })
    .then((variants) => {
      languageOptionsResults.set(videoSlug, variants)
      storageHydratedLanguageOptions.delete(videoSlug)
      writeStoredWatchLanguageOptions(videoSlug, variants)
      return variants
    })
    .catch((error: unknown) => {
      languageOptionsPromises.delete(videoSlug)
      throw error
    })

  languageOptionsPromises.set(videoSlug, promise)
  return promise
}

function languageOptionsStorageKey(videoSlug: string): string {
  return `${WATCH_LANGUAGE_OPTIONS_STORAGE_KEY_PREFIX}${encodeURIComponent(
    videoSlug,
  )}`
}

function isStoredLanguageOptionsPayload(
  value: unknown,
): value is StoredLanguageOptionsPayload {
  if (typeof value !== "object" || value === null) return false
  const payload = value as Partial<StoredLanguageOptionsPayload>
  return (
    payload.version === WATCH_LANGUAGE_OPTIONS_STORAGE_VERSION &&
    Array.isArray(payload.variants) &&
    payload.variants.every(isStoredLanguageOption)
  )
}

function isStoredLanguageOption(
  value: unknown,
): value is LanguagePickerVariant {
  if (typeof value !== "object" || value === null) return false
  const variant = value as Partial<LanguagePickerVariant>
  const language = variant.language
  return (
    typeof variant.documentId === "string" &&
    typeof variant.hls === "string" &&
    variant.published === true &&
    typeof language === "object" &&
    language !== null &&
    typeof language.slug === "string" &&
    (language.name == null || typeof language.name === "string") &&
    (language.nativeName == null || typeof language.nativeName === "string") &&
    (language.bcp47 == null || typeof language.bcp47 === "string") &&
    (language.coreId == null || typeof language.coreId === "string")
  )
}

function readStoredWatchLanguageOptions(
  videoSlug: string,
): LanguagePickerVariant[] | null {
  if (typeof window === "undefined") return null

  const key = languageOptionsStorageKey(videoSlug)
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isStoredLanguageOptionsPayload(parsed)) {
      window.sessionStorage.removeItem(key)
      return null
    }

    return parsed.variants
  } catch {
    return null
  }
}

function writeStoredWatchLanguageOptions(
  videoSlug: string,
  variants: LanguagePickerVariant[],
): void {
  if (typeof window === "undefined") return

  try {
    const payload: StoredLanguageOptionsPayload = {
      version: WATCH_LANGUAGE_OPTIONS_STORAGE_VERSION,
      variants,
    }
    window.sessionStorage.setItem(
      languageOptionsStorageKey(videoSlug),
      JSON.stringify(payload),
    )
  } catch {
    // Browser storage is an optional acceleration layer.
  }
}

export async function warmWatchInteractionsNow(
  options: {
    videoSlug?: string
    signal?: { cancelled: boolean }
  } = {},
): Promise<void> {
  for (const key of WATCH_INTERACTION_WARM_ORDER) {
    if (options.signal?.cancelled) return
    await loadWatchInteraction(key)
    if (key === "language" && options.videoSlug) {
      void loadWatchLanguageOptionsForVideo(options.videoSlug).catch(() => {})
    }
  }
}

export function scheduleWatchInteractionWarmup(
  options: {
    videoSlug?: string
  } = {},
): () => void {
  if (typeof window === "undefined") return () => {}

  const signal = { cancelled: false }
  let cleanupIdle: (() => void) | null = null
  let loadListener: (() => void) | null = null

  const startWarmup = () => {
    cleanupIdle = runAfterIdle(() => {
      void warmWatchInteractionsNow({ ...options, signal }).catch(() => {})
    })
  }

  if (document.readyState === "complete") {
    startWarmup()
  } else {
    loadListener = startWarmup
    window.addEventListener("load", loadListener, { once: true })
  }

  return () => {
    signal.cancelled = true
    cleanupIdle?.()
    if (loadListener) {
      window.removeEventListener("load", loadListener)
    }
  }
}

function runAfterIdle(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}

  if ("requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(callback, { timeout: 2500 })
    return () => window.cancelIdleCallback?.(handle)
  }

  const handle = globalThis.setTimeout(callback, 250)
  return () => globalThis.clearTimeout(handle)
}

export function __setWatchInteractionLoadersForTests(
  loaders: Partial<Record<WatchInteractionKey, InteractionLoader>>,
): void {
  interactionLoaders = { ...defaultInteractionLoaders, ...loaders }
  interactionPromises.clear()
}

export function __setWatchLanguageOptionsLoaderForTests(
  loader: LanguageOptionsLoader,
): void {
  languageOptionsLoader = loader
  languageOptionsPromises.clear()
  languageOptionsResults.clear()
}

export function __resetWatchInteractionLoaderForTests(): void {
  interactionLoaders = { ...defaultInteractionLoaders }
  languageOptionsLoader = async ({ videoSlug }) => {
    const languageActions = await import("@/lib/watch-language-actions")
    return languageActions.loadWatchLanguageOptions({ videoSlug })
  }
  interactionPromises.clear()
  languageOptionsPromises.clear()
  languageOptionsResults.clear()
  storageHydratedLanguageOptions.clear()
}
