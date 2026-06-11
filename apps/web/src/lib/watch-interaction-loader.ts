"use client"

import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"

export type WatchInteractionKey = "language" | "search" | "share" | "download"

type InteractionLoader = () => Promise<unknown>
type LanguageOptionsLoader = (input: {
  videoSlug: string
}) => Promise<LanguagePickerVariant[]>

const WATCH_INTERACTION_WARM_ORDER = [
  "language",
  "search",
  "share",
  "download",
] as const satisfies readonly WatchInteractionKey[]

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
  return languageOptionsResults.get(videoSlug) ?? null
}

export function loadWatchLanguageOptionsForVideo(
  videoSlug: string,
): Promise<LanguagePickerVariant[]> {
  const cached = languageOptionsResults.get(videoSlug)
  if (cached) return Promise.resolve(cached)

  const existing = languageOptionsPromises.get(videoSlug)
  if (existing) return existing

  const promise = languageOptionsLoader({ videoSlug })
    .then((variants) => {
      languageOptionsResults.set(videoSlug, variants)
      return variants
    })
    .catch((error: unknown) => {
      languageOptionsPromises.delete(videoSlug)
      throw error
    })

  languageOptionsPromises.set(videoSlug, promise)
  return promise
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
}
