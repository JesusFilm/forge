"use client"

import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"
import type { GlobalLanguageOption } from "@/lib/watch-language-switcher"

export type WatchInteractionKey =
  | "global-language"
  | "language"
  | "search"
  | "share"
  | "download"

type InteractionLoader = () => Promise<unknown>
type LanguageOptionsLoader = (input: {
  videoSlug: string
}) => Promise<LanguagePickerVariant[]>
type GlobalLanguageOptionsLoader = () => Promise<GlobalLanguageOption[]>

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
  "global-language": () =>
    import("@/components/watch/GlobalLanguagePickerModal"),
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
let globalLanguageOptionsLoader: GlobalLanguageOptionsLoader = async () => {
  const languageActions = await import("@/lib/watch-language-actions")
  return languageActions.loadGlobalWatchLanguageOptions()
}

const interactionPromises = new Map<WatchInteractionKey, Promise<unknown>>()
const languageOptionsPromises = new Map<
  string,
  Promise<LanguagePickerVariant[]>
>()
const languageOptionsResults = new Map<string, LanguagePickerVariant[]>()
const storageHydratedLanguageOptions = new Set<string>()
let globalLanguageOptionsPromise: Promise<GlobalLanguageOption[]> | null = null
let globalLanguageOptionsResult: GlobalLanguageOption[] | null = null

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

/** Dedupe the compact global catalog and evict only failed requests for retry. */
export function loadGlobalWatchLanguageOptions(): Promise<
  GlobalLanguageOption[]
> {
  if (globalLanguageOptionsResult) {
    return Promise.resolve(globalLanguageOptionsResult)
  }
  if (globalLanguageOptionsPromise) return globalLanguageOptionsPromise

  globalLanguageOptionsPromise = globalLanguageOptionsLoader()
    .then((options) => {
      globalLanguageOptionsResult = options
      return options
    })
    .catch((error: unknown) => {
      globalLanguageOptionsPromise = null
      throw error
    })
  return globalLanguageOptionsPromise
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
    globalLanguage?: boolean
    globalLanguageOptions?: boolean
    interactionKeys?: readonly WatchInteractionKey[]
    videoSlug?: string
    signal?: { cancelled: boolean }
  } = {},
): Promise<void> {
  if (options.globalLanguage) {
    if (options.signal?.cancelled) return
    await loadWatchInteraction("global-language")
    if (options.signal?.cancelled) return
    if (options.globalLanguageOptions !== false) {
      void loadGlobalWatchLanguageOptions().catch(() => {})
    }
  }
  const interactionKeys =
    options.interactionKeys ?? WATCH_INTERACTION_WARM_ORDER
  for (const key of interactionKeys) {
    if (options.signal?.cancelled) return
    await loadWatchInteraction(key)
    if (key === "language" && options.videoSlug) {
      void loadWatchLanguageOptionsForVideo(options.videoSlug).catch(() => {})
    }
  }
}

export function scheduleWatchInteractionWarmup(
  options: {
    globalLanguage?: boolean
    globalLanguageOptions?: boolean
    interactionKeys?: readonly WatchInteractionKey[]
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

export function __setGlobalWatchLanguageOptionsLoaderForTests(
  loader: GlobalLanguageOptionsLoader,
): void {
  globalLanguageOptionsLoader = loader
  globalLanguageOptionsPromise = null
  globalLanguageOptionsResult = null
}

export function __resetWatchInteractionLoaderForTests(): void {
  interactionLoaders = { ...defaultInteractionLoaders }
  languageOptionsLoader = async ({ videoSlug }) => {
    const languageActions = await import("@/lib/watch-language-actions")
    return languageActions.loadWatchLanguageOptions({ videoSlug })
  }
  globalLanguageOptionsLoader = async () => {
    const languageActions = await import("@/lib/watch-language-actions")
    return languageActions.loadGlobalWatchLanguageOptions()
  }
  interactionPromises.clear()
  languageOptionsPromises.clear()
  languageOptionsResults.clear()
  storageHydratedLanguageOptions.clear()
  globalLanguageOptionsPromise = null
  globalLanguageOptionsResult = null
}
