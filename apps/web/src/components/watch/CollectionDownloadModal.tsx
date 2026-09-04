"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Download, LoaderCircle, LogIn, Square } from "lucide-react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadQueue,
  type CollectionDownloadEpisode,
  type CollectionDownloadQueueItem,
} from "@/components/watch/collection-download-options"
import {
  runCollectionDownloadQueue,
  type CollectionDownloadDirectory,
  type CollectionDownloadProgress,
  type CollectionDownloadQueueResult,
} from "@/components/watch/collection-download-queue"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import type { DownloadTier } from "@/components/watch/download-options"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { TierListbox } from "@/components/watch/TierListbox"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import {
  WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS,
  WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS,
} from "@/components/watch/watch-modal-presentation"
import { languageCodeFor } from "@/lib/language-code"
import { loadWatchCollectionDownloads } from "@/lib/watch-collection-download-actions"

type CollectionDownloadDirectoryHandle = CollectionDownloadDirectory & {
  name?: string
}

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "readwrite"
  }) => Promise<CollectionDownloadDirectoryHandle>
}

type LoadState =
  | { status: "idle" | "loading" }
  | {
      status: "ready"
      options: ReturnType<typeof buildCollectionDownloadOptions>
    }
  | { status: "error" }

type StoredCollectionDownloadItem = Pick<
  CollectionDownloadQueueItem,
  "filename" | "id" | "title"
>

type StoredCollectionDownloadResume = {
  canceled: boolean
  completed: StoredCollectionDownloadItem[]
  deliveryMode: CollectionDownloadQueueResult["deliveryMode"]
  languageSlug: string
  pending: StoredCollectionDownloadItem[]
  tier: DownloadTier
  total: number
  version: 3
}

const COLLECTION_DOWNLOAD_RESUME_KEY =
  "forge.watch.collection-download-resume.v3"
const COLLECTION_THUMBNAIL_STACK_CLASSES = [
  "top-7 w-28 border-2 border-stone-950 min-[500px]:w-40 min-[900px]:top-10 min-[900px]:w-56",
  "top-6 w-[6.625rem] border border-black/70 brightness-[0.64] saturate-[0.55] min-[500px]:w-[9.5rem] min-[900px]:top-[2.1875rem] min-[900px]:w-[13.25rem]",
  "top-5 w-[6.25rem] border border-black/60 brightness-[0.42] saturate-[0.3] min-[500px]:w-36 min-[900px]:top-[1.875rem] min-[900px]:w-[12.5rem]",
] as const
const COLLECTION_DECORATIVE_STACK_CLASSES = [
  "top-4 w-[5.875rem] bg-gradient-to-b from-stone-700/60 to-stone-900/90 min-[500px]:w-[8.5rem] min-[900px]:top-[1.5625rem] min-[900px]:w-[11.75rem]",
  "top-3 w-[5.5rem] bg-gradient-to-b from-stone-800/70 to-stone-950 min-[500px]:w-32 min-[900px]:top-5 min-[900px]:w-44",
] as const

function formatCollectionDownloadSize(bytes: number, locale: string): string {
  if (bytes < 1_000_000) return "<1 MB"
  const useGigabytes = bytes >= 1_000_000_000
  const value = bytes / (useGigabytes ? 1_000_000_000 : 1_000_000)
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 10 ? 1 : 2,
  }).format(value)} ${useGigabytes ? "GB" : "MB"}`
}

function collectionDownloadResumeKey(collectionSlug: string): string {
  return `${COLLECTION_DOWNLOAD_RESUME_KEY}:${encodeURIComponent(collectionSlug)}`
}

function isStoredQueueItem(
  value: unknown,
): value is StoredCollectionDownloadItem {
  if (value == null || typeof value !== "object") return false
  const item = value as Partial<StoredCollectionDownloadItem>
  return (
    typeof item.id === "string" &&
    typeof item.filename === "string" &&
    typeof item.title === "string"
  )
}

function readCollectionDownloadResume(
  collectionSlug: string,
): StoredCollectionDownloadResume | null {
  try {
    const raw = window.sessionStorage.getItem(
      collectionDownloadResumeKey(collectionSlug),
    )
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredCollectionDownloadResume>
    if (
      stored.version !== 3 ||
      typeof stored.languageSlug !== "string" ||
      typeof stored.canceled !== "boolean" ||
      !["browser", "directory"].includes(stored.deliveryMode ?? "") ||
      !["highest", "high", "low"].includes(stored.tier ?? "") ||
      !Array.isArray(stored.completed) ||
      !stored.completed.every(isStoredQueueItem) ||
      !Array.isArray(stored.pending) ||
      !stored.pending.every(isStoredQueueItem) ||
      typeof stored.total !== "number" ||
      !Number.isInteger(stored.total) ||
      stored.total < stored.completed.length + stored.pending.length
    ) {
      return null
    }
    return stored as StoredCollectionDownloadResume
  } catch {
    return null
  }
}

function writeCollectionDownloadResume(
  collectionSlug: string,
  languageSlug: string,
  tier: DownloadTier,
  result: CollectionDownloadQueueResult,
): void {
  try {
    const stored: StoredCollectionDownloadResume = {
      canceled: result.canceled,
      completed: result.completed.map(({ filename, id, title }) => ({
        filename,
        id,
        title,
      })),
      deliveryMode: result.deliveryMode,
      languageSlug,
      pending: result.failed.map(({ item: { filename, id, title } }) => ({
        filename,
        id,
        title,
      })),
      tier,
      total: result.total,
      version: 3,
    }
    window.sessionStorage.setItem(
      collectionDownloadResumeKey(collectionSlug),
      JSON.stringify(stored),
    )
  } catch {
    // A blocked storage API should not prevent the sign-in flow.
  }
}

function clearCollectionDownloadResume(collectionSlug: string): void {
  try {
    window.sessionStorage.removeItem(
      collectionDownloadResumeKey(collectionSlug),
    )
  } catch {
    // A blocked storage API should not prevent a download.
  }
}

function tierMessageKey(tier: DownloadTier) {
  if (tier === "highest") return "tierHighest" as const
  if (tier === "high") return "tierHigh" as const
  return "tierLow" as const
}

export type CollectionDownloadModalProps = {
  open: boolean
  collectionSlug: string
  collectionTitle?: string | null
  episodes: CollectionDownloadEpisode[]
  languages: LanguageComboboxOption[]
  currentLanguageSlug: string
  accountGateEnabled: boolean
  authRequiredLoginUrl?: string | null
  onClose: () => void
}

export function CollectionDownloadModal({
  open,
  collectionSlug,
  collectionTitle,
  episodes,
  languages,
  currentLanguageSlug,
  accountGateEnabled,
  authRequiredLoginUrl = null,
  onClose,
}: CollectionDownloadModalProps) {
  const t = useTranslations("CollectionDownloadModal")
  const inventoryT = useTranslations("LanguageInventory")
  const locale = useLocale()
  const qualityLabelId = useId()
  const [languageSlug, setLanguageSlug] = useState(currentLanguageSlug)
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" })
  const [selectedTier, setSelectedTier] = useState<DownloadTier>("highest")
  const [progress, setProgress] = useState<CollectionDownloadProgress | null>(
    null,
  )
  const [result, setResult] = useState<CollectionDownloadQueueResult | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [authLoginUrl, setAuthLoginUrl] = useState<string | null>(null)
  const [directory, setDirectory] =
    useState<CollectionDownloadDirectoryHandle | null>(null)
  const [starting, setStarting] = useState(false)
  const requestVersionRef = useRef(0)
  const startVersionRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const resumeInitializedRef = useRef(false)

  const selectedLanguage = useMemo(
    () => languages.find((language) => language.slug === languageSlug) ?? null,
    [languageSlug, languages],
  )
  const options = loadState.status === "ready" ? loadState.options : null
  const effectiveTier =
    options?.commonTiers.includes(selectedTier) === true
      ? selectedTier
      : (options?.commonTiers[0] ?? null)
  const totalSizeLabel = useMemo(() => {
    if (!options || !effectiveTier || options.candidates.length === 0) {
      return null
    }
    let totalBytes = 0
    for (const candidate of options.candidates) {
      const size = candidate.tiers[effectiveTier]?.size
      if (size == null || !Number.isFinite(size) || size <= 0) return null
      totalBytes += size
    }
    return formatCollectionDownloadSize(totalBytes, locale)
  }, [effectiveTier, locale, options])
  const videoCountLabel = useMemo(() => {
    const count = options?.candidates.length ?? 0
    const formattedCount = new Intl.NumberFormat(locale).format(count)
    const localizedCountLabel = inventoryT("videoCount", { count })
    return localizedCountLabel.replace(formattedCount, "").trim()
  }, [inventoryT, locale, options?.candidates.length])
  const running = progress?.active != null
  const busy = starting || running
  const effectiveAuthLoginUrl = authRequiredLoginUrl ?? authLoginUrl
  const directoryPickerSupported =
    typeof window !== "undefined" &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker ===
      "function"

  const loadOptions = useCallback(async () => {
    startVersionRef.current += 1
    if (!collectionSlug) {
      setLoadState({ status: "error" })
      return
    }
    if (!languageSlug) {
      setLoadState({
        status: "ready",
        options: buildCollectionDownloadOptions(episodes, []),
      })
      return
    }
    const requestVersion = ++requestVersionRef.current
    setLoadState({ status: "loading" })
    setProgress(null)
    setResult(null)
    setError(null)
    let response: Awaited<ReturnType<typeof loadWatchCollectionDownloads>>
    try {
      response = await loadWatchCollectionDownloads({
        collectionSlug,
        languageSlug,
      })
    } catch {
      if (requestVersion !== requestVersionRef.current) return
      setLoadState({ status: "error" })
      return
    }
    if (requestVersion !== requestVersionRef.current) return
    if (!response.ok) {
      if (response.reason === "auth-required") {
        const session = await resolveDownloadSessionAccess()
        if (requestVersion !== requestVersionRef.current) return
        if (!session.ok && session.reason === "auth-required") {
          setAuthLoginUrl(session.loginUrl)
          setLoadState({ status: "error" })
          return
        }
      }
      setLoadState({ status: "error" })
      return
    }
    setAuthLoginUrl(null)
    const nextOptions = buildCollectionDownloadOptions(episodes, response.dubs)
    const restored = readCollectionDownloadResume(collectionSlug)
    const restoredTier =
      restored?.languageSlug === languageSlug &&
      nextOptions.commonTiers.includes(restored.tier)
        ? restored.tier
        : null
    const nextTier = restoredTier ?? nextOptions.commonTiers[0] ?? "highest"
    setLoadState({ status: "ready", options: nextOptions })
    setSelectedTier(nextTier)
    if (restored?.languageSlug === languageSlug && restored.pending.length) {
      const currentItems = buildCollectionDownloadQueue({
        candidates: nextOptions.candidates,
        tier: nextTier,
        languageCode: languageCodeFor(selectedLanguage ?? {}),
        languageName: selectedLanguage?.name,
        languageSlug,
      })
      const itemById = new Map(currentItems.map((item) => [item.id, item]))
      const restoreItem = (
        item: StoredCollectionDownloadItem,
      ): CollectionDownloadQueueItem =>
        itemById.get(item.id) ?? { ...item, url: "" }
      const restoredResult: CollectionDownloadQueueResult = {
        active: null,
        authRequired: false,
        canceled: restored.canceled,
        completed: restored.completed.map(restoreItem),
        deliveryMode: restored.deliveryMode,
        failed: restored.pending.map((item) => ({
          item: restoreItem(item),
          reason: itemById.has(item.id) ? "retry-pending" : "unavailable",
        })),
        total: restored.total,
      }
      setProgress(restoredResult)
      setResult(restoredResult)
    }
  }, [collectionSlug, episodes, languageSlug, selectedLanguage])

  useEffect(() => {
    if (!open) {
      resumeInitializedRef.current = false
      return
    }
    let canceled = false
    let handledResume = false
    let restoredLanguage = false
    if (!resumeInitializedRef.current) {
      resumeInitializedRef.current = true
      const restored = readCollectionDownloadResume(collectionSlug)
      if (
        restored &&
        languages.some((language) => language.slug === restored.languageSlug)
      ) {
        handledResume = true
        restoredLanguage = restored.languageSlug !== languageSlug
        window.queueMicrotask(() => {
          if (canceled) return
          setSelectedTier(restored.tier)
          if (restoredLanguage) setLanguageSlug(restored.languageSlug)
          else void loadOptions()
        })
      }
    }
    if (!handledResume) {
      window.queueMicrotask(() => {
        if (!canceled && resumeInitializedRef.current) void loadOptions()
      })
    }
    return () => {
      canceled = true
      requestVersionRef.current += 1
      startVersionRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
      setStarting(false)
    }
  }, [collectionSlug, languageSlug, languages, loadOptions, open])

  const close = useCallback(() => {
    if (starting || controllerRef.current) return
    startVersionRef.current += 1
    setProgress(null)
    setResult(null)
    setError(null)
    onClose()
  }, [onClose, starting])

  const cancelDownload = useCallback(() => {
    startVersionRef.current += 1
    if (controllerRef.current) {
      controllerRef.current.abort()
      return
    }
    setStarting(false)
  }, [])

  async function startDownload(retry = false) {
    if (!options || !effectiveTier || busy) return
    const startVersion = ++startVersionRef.current
    const previousResult = retry ? result : null
    setError(null)
    setStarting(true)

    let downloadDirectory = directory
    if (!downloadDirectory && directoryPickerSupported) {
      const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
      try {
        downloadDirectory = (await picker?.({ mode: "readwrite" })) ?? null
      } catch (pickerError) {
        if (
          !(pickerError instanceof DOMException) ||
          pickerError.name !== "AbortError"
        ) {
          setError(t("folderError"))
        }
        setStarting(false)
        return
      }
      if (startVersion !== startVersionRef.current) return
      if (!downloadDirectory) {
        setStarting(false)
        return
      }
      setDirectory(downloadDirectory)
    }

    if (accountGateEnabled) {
      const session = await resolveDownloadSessionAccess()
      if (startVersion !== startVersionRef.current) return
      if (!session.ok && session.reason === "session-unavailable") {
        setStarting(false)
        setError(t("sessionError"))
        return
      }
      if (!session.ok) {
        setStarting(false)
        setAuthLoginUrl(session.loginUrl)
        return
      }
      setAuthLoginUrl(null)
    }
    let refreshed: Awaited<ReturnType<typeof loadWatchCollectionDownloads>>
    try {
      refreshed = await loadWatchCollectionDownloads({
        collectionSlug,
        languageSlug,
      })
    } catch {
      if (startVersion !== startVersionRef.current) return
      setStarting(false)
      setError(t("loadError"))
      return
    }
    if (startVersion !== startVersionRef.current) return
    if (!refreshed.ok) {
      setStarting(false)
      if (refreshed.reason === "auth-required") {
        const session = await resolveDownloadSessionAccess()
        if (startVersion !== startVersionRef.current) return
        if (!session.ok && session.reason === "auth-required") {
          setAuthLoginUrl(session.loginUrl)
          return
        }
        if (!session.ok && session.reason === "session-unavailable") {
          setError(t("sessionError"))
          return
        }
      }
      setError(t("loadError"))
      return
    }
    setAuthLoginUrl(null)
    const freshOptions = buildCollectionDownloadOptions(
      episodes,
      refreshed.dubs,
    )
    const freshTier = freshOptions.commonTiers.includes(effectiveTier)
      ? effectiveTier
      : (freshOptions.commonTiers[0] ?? null)
    if (!freshTier) {
      setStarting(false)
      setLoadState({ status: "ready", options: freshOptions })
      setError(t("loadError"))
      return
    }
    setLoadState({ status: "ready", options: freshOptions })
    setSelectedTier(freshTier)
    setStarting(false)

    clearCollectionDownloadResume(collectionSlug)
    setResult(null)
    const freshItems = buildCollectionDownloadQueue({
      candidates: freshOptions.candidates,
      tier: freshTier,
      languageCode: languageCodeFor(selectedLanguage ?? {}),
      languageName: selectedLanguage?.name,
      languageSlug,
    })
    const pendingIds = new Set(
      previousResult?.failed.map(({ item }) => item.id) ?? [],
    )
    const items = previousResult
      ? freshItems.filter((item) => pendingIds.has(item.id))
      : freshItems
    const freshItemIds = new Set(items.map((item) => item.id))
    const unavailableFailures =
      previousResult?.failed.filter(({ item }) => !freshItemIds.has(item.id)) ??
      []
    const completedBeforeRetry = previousResult?.completed ?? []
    const total = previousResult?.total ?? items.length
    const mergeProgress = (
      nextProgress: CollectionDownloadProgress,
    ): CollectionDownloadProgress => ({
      ...nextProgress,
      completed: [...completedBeforeRetry, ...nextProgress.completed],
      total,
    })
    const controller = new AbortController()
    controllerRef.current = controller
    setProgress({
      active: items[0] ?? null,
      completed: completedBeforeRetry,
      failed: [],
      total,
    })
    const nextResult = await runCollectionDownloadQueue({
      directory: downloadDirectory,
      items,
      signal: controller.signal,
      onProgress: (nextProgress) => setProgress(mergeProgress(nextProgress)),
    })
    const completedRetryIds = new Set(
      nextResult.completed.map((item) => item.id),
    )
    const retryFailureById = new Map(
      nextResult.failed.map((failure) => [failure.item.id, failure]),
    )
    const unavailableFailureById = new Map(
      unavailableFailures.map((failure) => [failure.item.id, failure]),
    )
    const previousFailureIds = new Set(
      previousResult?.failed.map((failure) => failure.item.id) ?? [],
    )
    const failed = previousResult
      ? [
          ...previousResult.failed.flatMap((failure) => {
            if (completedRetryIds.has(failure.item.id)) return []
            return [
              retryFailureById.get(failure.item.id) ??
                unavailableFailureById.get(failure.item.id) ??
                failure,
            ]
          }),
          ...nextResult.failed.filter(
            (failure) => !previousFailureIds.has(failure.item.id),
          ),
        ]
      : nextResult.failed
    const mergedResult: CollectionDownloadQueueResult = {
      ...nextResult,
      completed: [...completedBeforeRetry, ...nextResult.completed],
      failed,
      total,
    }
    controllerRef.current = null
    setProgress(mergedResult)
    setResult(mergedResult)
    if (mergedResult.failed.length === 0) {
      clearCollectionDownloadResume(collectionSlug)
    } else {
      writeCollectionDownloadResume(
        collectionSlug,
        languageSlug,
        freshTier,
        mergedResult,
      )
    }
    if (nextResult.authRequired) {
      const refreshedSession = await resolveDownloadSessionAccess()
      if (startVersion !== startVersionRef.current) return
      if (!refreshedSession.ok && refreshedSession.reason === "auth-required") {
        writeCollectionDownloadResume(
          collectionSlug,
          languageSlug,
          freshTier,
          mergedResult,
        )
        setAuthLoginUrl(refreshedSession.loginUrl)
      }
    }
  }

  const completedCount =
    progress?.completed.length ?? result?.completed.length ?? 0
  const totalCount =
    progress?.total ?? result?.total ?? options?.candidates.length ?? 0
  const showDownloadAgain =
    result != null &&
    !result.authRequired &&
    !result.canceled &&
    result.failed.length === 0 &&
    result.completed.length === result.total

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-testid="watch-collection-download-modal"
        className={`${WATCH_MODAL_PAGE_SCROLL_CONTENT_CLASS} w-full max-w-[min(94vw,960px)] rounded-none border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[960px]`}
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        viewportClassName={WATCH_MODAL_PAGE_SCROLL_VIEWPORT_CLASS}
        showCloseButton={false}
      >
        <WatchModalViewportCloseButton
          open={open && !busy}
          onClose={close}
          testId="watch-collection-download-modal-close"
          renderInline
        />
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <div
          data-testid="watch-collection-download-modal-content"
          className="flex flex-col gap-8 p-6 sm:p-9"
        >
          <div
            data-testid="watch-collection-download-header"
            className="grid gap-x-8 gap-y-6 min-[900px]:grid-cols-[minmax(0,1fr)_26rem] min-[900px]:items-center"
          >
            <div className="min-w-0">
              <p
                data-testid="watch-collection-download-eyebrow"
                className="text-xs font-semibold tracking-[0.28em] text-red-100/70 uppercase sm:text-sm"
              >
                {t("eyebrow")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                {collectionTitle ?? t("dialogTitle")}
              </h2>
              <p
                data-testid="watch-collection-download-description"
                className="mt-3 max-w-[46ch] text-base sm:text-sm leading-6 text-stone-300"
              >
                {t("description")}
              </p>
            </div>
            {options && options.candidates.length > 0 ? (
              <div
                data-testid="watch-collection-download-ready"
                role="status"
                aria-label={t("availableCount", {
                  count: options.candidates.length,
                })}
                className="flex w-fit shrink-0 items-center justify-self-center gap-3 min-[500px]:gap-5 min-[900px]:justify-self-end min-[900px]:gap-6"
              >
                <div
                  data-testid="watch-collection-download-thumbnail-stack"
                  className="relative isolate h-24 w-36 shrink-0 min-[500px]:h-[7.5rem] min-[500px]:w-[11.5rem] min-[900px]:h-[10.5rem] min-[900px]:w-64"
                  aria-hidden="true"
                >
                  {COLLECTION_DECORATIVE_STACK_CLASSES.slice(
                    0,
                    Math.min(
                      COLLECTION_DECORATIVE_STACK_CLASSES.length,
                      Math.max(options.candidates.length - 3, 0),
                    ),
                  ).map((layerClassName, index) => (
                    <div
                      key={layerClassName}
                      data-testid="watch-collection-download-stack-layer"
                      className={`absolute left-1/2 aspect-video -translate-x-1/2 rounded-xl border border-white/10 shadow-lg ${layerClassName}`}
                      style={{ zIndex: 3 - index }}
                    />
                  ))}
                  {options.candidates.slice(0, 3).map((episode, index) => (
                    <div
                      key={episode.documentId}
                      data-testid="watch-collection-download-thumbnail"
                      className={`absolute left-1/2 aspect-video -translate-x-1/2 overflow-hidden rounded-xl bg-stone-800 shadow-xl ring-1 ring-black/40 ${COLLECTION_THUMBNAIL_STACK_CLASSES[index]}`}
                      style={{
                        zIndex: 6 - index,
                      }}
                    >
                      {episode.thumbnailUrl ? (
                        <Image
                          src={episode.thumbnailUrl}
                          alt=""
                          fill
                          sizes="(min-width: 900px) 224px, (min-width: 500px) 160px, 112px"
                          className="object-cover object-left-top"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900" />
                      )}
                    </div>
                  ))}
                </div>
                <span
                  data-testid="watch-collection-download-ready-count"
                  aria-hidden="true"
                  className="flex flex-col items-center whitespace-nowrap rounded-2xl border-2 border-white/15 px-3 py-3 text-center text-stone-300 min-[500px]:px-4 min-[900px]:rounded-3xl min-[900px]:px-5 min-[900px]:py-4"
                >
                  <span className="text-3xl font-semibold tabular-nums text-white min-[900px]:text-5xl">
                    {options.candidates.length}
                  </span>
                  <span className="text-sm leading-none font-medium min-[500px]:text-base min-[900px]:text-xl">
                    {videoCountLabel}
                  </span>
                  {totalSizeLabel ? (
                    <span
                      data-testid="watch-collection-download-total-size"
                      className="mt-0.5 whitespace-nowrap text-xs leading-none font-semibold tracking-[0.08em] text-red-100/70 uppercase sm:text-sm"
                    >
                      {totalSizeLabel}
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>

          {effectiveAuthLoginUrl ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="font-semibold text-white">{t("signInTitle")}</h3>
              <p className="mt-2 text-base sm:text-sm leading-6 text-stone-300">
                {t("signInBody")}
              </p>
              <Button
                variant="pill"
                className="mt-5"
                data-testid="watch-collection-download-sign-in"
                onClick={() =>
                  redirectToAuth(effectiveAuthLoginUrl, {
                    reopenDownload: true,
                  })
                }
              >
                <LogIn size={16} />
                {t("signIn")}
              </Button>
            </div>
          ) : (
            <>
              <div
                data-testid="watch-collection-download-fields"
                className="grid gap-5 sm:grid-cols-2"
              >
                <div className="flex flex-col gap-2.5 text-base sm:text-sm font-semibold">
                  <span>{t("languageLabel")}</span>
                  <LanguageCombobox
                    options={languages}
                    value={languageSlug}
                    disabled={busy}
                    onChange={setLanguageSlug}
                    compact
                    triggerClassName="border-white/15 bg-stone-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-stone-800 focus-visible:ring-amber-400"
                  />
                </div>
                <div className="flex flex-col gap-2.5 text-base sm:text-sm font-semibold">
                  <span id={qualityLabelId}>{t("qualityLabel")}</span>
                  <TierListbox
                    tiers={options?.commonTiers ?? []}
                    value={effectiveTier}
                    onChange={setSelectedTier}
                    getLabel={(tier) => t(tierMessageKey(tier))}
                    placeholder={t("qualityLabel")}
                    disabled={busy || !effectiveTier}
                    labelledBy={qualityLabelId}
                    testIdPrefix="watch-collection-download-quality"
                    triggerClassName="h-14 rounded-xl border-white/15 bg-stone-900 px-4 py-0 text-base sm:text-sm text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-stone-800 focus-visible:border-amber-400/70 focus-visible:ring-amber-400"
                  />
                </div>
              </div>

              {loadState.status === "loading" ? (
                <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-base sm:text-sm text-stone-300">
                  <LoaderCircle className="animate-spin" size={18} />
                  {t("loading")}
                </div>
              ) : null}
              {loadState.status === "error" ? (
                <div className="rounded-2xl bg-white/5 p-4 text-base sm:text-sm text-stone-300">
                  <p>{t("loadError")}</p>
                  <Button
                    variant="ghost"
                    className="mt-2"
                    data-testid="watch-collection-download-load-retry"
                    onClick={loadOptions}
                  >
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
              {options && options.candidates.length === 0 ? (
                <p className="rounded-2xl bg-white/5 p-4 text-base sm:text-sm text-stone-300">
                  {t("noDownloads")}
                </p>
              ) : null}
              {options && options.skipped.length > 0 ? (
                <div className="text-base sm:text-sm text-amber-300">
                  <p>{t("skippedCount", { count: options.skipped.length })}</p>
                  <ul
                    data-testid="watch-collection-download-skipped"
                    className="mt-2 list-disc space-y-1 pl-5"
                  >
                    {options.skipped.map((episode) => (
                      <li key={episode.documentId}>
                        {episode.title ?? episode.slug ?? episode.documentId}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {directory?.name || !directoryPickerSupported ? (
                <p className="text-sm sm:text-xs leading-5 text-stone-400">
                  {directory?.name
                    ? t("folderSelected", { name: directory.name })
                    : t("browserFallback")}
                </p>
              ) : null}

              {progress || result ? (
                <div
                  data-testid="watch-collection-download-progress"
                  aria-live="polite"
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center justify-between text-base sm:text-sm font-semibold">
                    <span>
                      {running && progress?.active
                        ? t("downloading", { title: progress.active.title })
                        : result?.canceled
                          ? t("canceled")
                          : result?.deliveryMode === "browser"
                            ? t("browserFallback")
                            : t("complete")}
                    </span>
                    <span>
                      {t("progress", {
                        completed: completedCount,
                        total: totalCount,
                      })}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-800">
                    <div
                      className="h-full rounded-full bg-brand-red transition-[width]"
                      style={{
                        width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  {(result?.failed.length ?? 0) > 0 ? (
                    <p className="mt-3 text-base sm:text-sm text-amber-300">
                      {t("failedCount", { count: result?.failed.length ?? 0 })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="text-base sm:text-sm font-semibold text-brand-red"
                >
                  {error}
                </p>
              ) : null}

              <div
                data-testid="watch-collection-download-actions"
                className="flex items-center justify-end gap-3 pt-5"
              >
                {showDownloadAgain ? (
                  <>
                    <Button
                      variant="ghost"
                      data-testid="watch-collection-download-start"
                      onClick={() => void startDownload(false)}
                    >
                      <Download size={16} />
                      {t("downloadAgain")}
                    </Button>
                    <Button
                      variant="pill"
                      data-testid="watch-collection-download-close"
                      onClick={close}
                    >
                      {t("close")}
                    </Button>
                  </>
                ) : !busy ? (
                  <Button
                    variant="ghost"
                    data-testid="watch-collection-download-close"
                    onClick={close}
                  >
                    {t("close")}
                  </Button>
                ) : null}
                {busy && !showDownloadAgain ? (
                  <Button
                    variant="pill"
                    data-testid="watch-collection-download-cancel"
                    onClick={cancelDownload}
                  >
                    <Square size={15} />
                    {t("cancel")}
                  </Button>
                ) : !showDownloadAgain ? (
                  <Button
                    variant="pill"
                    data-testid="watch-collection-download-start"
                    disabled={
                      loadState.status !== "ready" ||
                      !effectiveTier ||
                      options?.candidates.length === 0
                    }
                    onClick={() =>
                      void startDownload(Boolean(result?.failed.length))
                    }
                  >
                    <Download size={16} />
                    {result?.failed.length ? t("downloadAgain") : t("start")}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
