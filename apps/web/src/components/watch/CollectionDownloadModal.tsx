"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronRight,
  Download,
  FolderOpen,
  LoaderCircle,
  LogIn,
  Square,
} from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadQueue,
  type CollectionDownloadEpisode,
  type CollectionDownloadQueueItem,
} from "@/components/watch/collection-download-options"
import {
  failedCollectionDownloadItems,
  runCollectionDownloadQueue,
  type CollectionDownloadDirectory,
  type CollectionDownloadProgress,
  type CollectionDownloadQueueResult,
} from "@/components/watch/collection-download-queue"
import { resolveDownloadSessionAccess } from "@/components/watch/download-session-access"
import { redirectToAuth } from "@/components/watch/download-session-client"
import { DOWNLOAD_PROXY_PATH } from "@/components/watch/download-link"
import type { DownloadTier } from "@/components/watch/download-options"
import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { languageCodeFor } from "@/lib/language-code"
import { loadWatchCollectionDownloads } from "@/lib/watch-collection-download-actions"

type DirectoryHandle = CollectionDownloadDirectory & { name?: string }

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "readwrite"
  }) => Promise<DirectoryHandle>
}

type LoadState =
  | { status: "idle" | "loading" }
  | {
      status: "ready"
      options: ReturnType<typeof buildCollectionDownloadOptions>
    }
  | { status: "error" }

type StoredCollectionDownloadResume = Pick<
  CollectionDownloadQueueResult,
  "completed" | "failed" | "total"
>

const COLLECTION_DOWNLOAD_RESUME_KEY = "forge.watch.collection-download-resume"
const COLLECTION_THUMBNAIL_STACK_CLASSES = [
  "translate-y-7 min-[700px]:translate-y-10",
  "translate-x-3 translate-y-3.5 min-[700px]:translate-x-4 min-[700px]:translate-y-5",
  "translate-x-6 min-[700px]:translate-x-8",
] as const

function collectionDownloadResumeKey(
  collectionSlug: string,
  languageSlug: string,
): string {
  return `${COLLECTION_DOWNLOAD_RESUME_KEY}:${encodeURIComponent(collectionSlug)}:${encodeURIComponent(languageSlug)}`
}

function isStoredQueueItem(
  value: unknown,
): value is CollectionDownloadQueueItem {
  if (value == null || typeof value !== "object") return false
  const item = value as Partial<CollectionDownloadQueueItem>
  return (
    typeof item.id === "string" &&
    typeof item.filename === "string" &&
    typeof item.title === "string" &&
    typeof item.url === "string" &&
    item.url.startsWith(`${DOWNLOAD_PROXY_PATH}?`)
  )
}

function readCollectionDownloadResume(
  collectionSlug: string,
  languageSlug: string,
): CollectionDownloadQueueResult | null {
  try {
    const raw = window.sessionStorage.getItem(
      collectionDownloadResumeKey(collectionSlug, languageSlug),
    )
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<StoredCollectionDownloadResume>
    if (
      !Array.isArray(stored.completed) ||
      !stored.completed.every(isStoredQueueItem) ||
      !Array.isArray(stored.failed) ||
      !stored.failed.every(
        (failure) =>
          failure != null &&
          typeof failure === "object" &&
          isStoredQueueItem(failure.item) &&
          typeof failure.reason === "string",
      ) ||
      typeof stored.total !== "number" ||
      !Number.isInteger(stored.total) ||
      stored.total < stored.completed.length + stored.failed.length
    ) {
      return null
    }
    return {
      active: null,
      authRequired: false,
      canceled: false,
      completed: stored.completed,
      failed: stored.failed,
      total: stored.total,
    }
  } catch {
    return null
  }
}

function writeCollectionDownloadResume(
  collectionSlug: string,
  languageSlug: string,
  result: CollectionDownloadQueueResult,
): void {
  try {
    const stored: StoredCollectionDownloadResume = {
      completed: result.completed,
      failed: result.failed,
      total: result.total,
    }
    window.sessionStorage.setItem(
      collectionDownloadResumeKey(collectionSlug, languageSlug),
      JSON.stringify(stored),
    )
  } catch {
    // A blocked storage API should not prevent the sign-in flow.
  }
}

function clearCollectionDownloadResume(
  collectionSlug: string,
  languageSlug: string,
): void {
  try {
    window.sessionStorage.removeItem(
      collectionDownloadResumeKey(collectionSlug, languageSlug),
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
  const [languageSlug, setLanguageSlug] = useState(currentLanguageSlug)
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" })
  const [selectedTier, setSelectedTier] = useState<DownloadTier>("highest")
  const [directory, setDirectory] = useState<DirectoryHandle | null>(null)
  const [progress, setProgress] = useState<CollectionDownloadProgress | null>(
    null,
  )
  const [result, setResult] = useState<CollectionDownloadQueueResult | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [authLoginUrl, setAuthLoginUrl] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const requestVersionRef = useRef(0)
  const startVersionRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const selectedLanguage = useMemo(
    () => languages.find((language) => language.slug === languageSlug) ?? null,
    [languageSlug, languages],
  )
  const options = loadState.status === "ready" ? loadState.options : null
  const effectiveTier =
    options?.commonTiers.includes(selectedTier) === true
      ? selectedTier
      : (options?.commonTiers[0] ?? null)
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
      setLoadState({ status: "error" })
      return
    }
    const nextOptions = buildCollectionDownloadOptions(episodes, response.dubs)
    const restoredResult = readCollectionDownloadResume(
      collectionSlug,
      languageSlug,
    )
    setLoadState({ status: "ready", options: nextOptions })
    setSelectedTier(nextOptions.commonTiers[0] ?? "highest")
    if (restoredResult?.failed.length) {
      setProgress(restoredResult)
      setResult(restoredResult)
    }
  }, [collectionSlug, episodes, languageSlug])

  useEffect(() => {
    if (!open) return
    let canceled = false
    window.queueMicrotask(() => {
      if (!canceled) void loadOptions()
    })
    return () => {
      canceled = true
      requestVersionRef.current += 1
      startVersionRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [loadOptions, open])

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

  async function chooseDirectory() {
    const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
    if (!picker) return
    try {
      const handle = await picker({ mode: "readwrite" })
      setDirectory(handle)
      setError(null)
    } catch (pickerError) {
      if (
        !(pickerError instanceof DOMException) ||
        pickerError.name !== "AbortError"
      ) {
        setError(t("folderError"))
      }
    }
  }

  async function startDownload(
    retryItems?: ReturnType<typeof failedCollectionDownloadItems>,
  ) {
    if (!options || !effectiveTier || busy) return
    const startVersion = ++startVersionRef.current
    const previousResult = retryItems ? result : null
    setError(null)

    if (accountGateEnabled) {
      setStarting(true)
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
      setStarting(false)
    }

    clearCollectionDownloadResume(collectionSlug, languageSlug)
    setResult(null)
    const items =
      retryItems ??
      buildCollectionDownloadQueue({
        candidates: options.candidates,
        tier: effectiveTier,
        languageCode: languageCodeFor(selectedLanguage ?? {}),
        languageName: selectedLanguage?.name,
        languageSlug,
      })
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
      items,
      signal: controller.signal,
      directory,
      onProgress: (nextProgress) => setProgress(mergeProgress(nextProgress)),
    })
    const completedRetryIds = new Set(
      nextResult.completed.map((item) => item.id),
    )
    const retryFailureById = new Map(
      nextResult.failed.map((failure) => [failure.item.id, failure]),
    )
    const previousFailureIds = new Set(
      previousResult?.failed.map((failure) => failure.item.id) ?? [],
    )
    const failed = previousResult
      ? [
          ...previousResult.failed.flatMap((failure) => {
            if (completedRetryIds.has(failure.item.id)) return []
            return [retryFailureById.get(failure.item.id) ?? failure]
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
      clearCollectionDownloadResume(collectionSlug, languageSlug)
    }
    if (nextResult.authRequired) {
      const refreshedSession = await resolveDownloadSessionAccess()
      if (startVersion !== startVersionRef.current) return
      if (!refreshedSession.ok && refreshedSession.reason === "auth-required") {
        writeCollectionDownloadResume(
          collectionSlug,
          languageSlug,
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <WatchModalViewportCloseButton
        open={open}
        onClose={close}
        testId="watch-collection-download-modal-close"
      />
      <DialogContent
        data-testid="watch-collection-download-modal"
        className="w-full max-w-[min(94vw,960px)] rounded-none border-0 bg-transparent p-0 text-stone-100 ring-0 sm:max-w-[960px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <div className="flex max-h-[86vh] flex-col gap-8 overflow-y-auto p-6 sm:p-9">
          <div
            data-testid="watch-collection-download-header"
            className="grid gap-x-10 gap-y-6 min-[700px]:grid-cols-[minmax(0,1fr)_20rem] min-[700px]:items-center"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-[0.18em] text-amber-400 uppercase">
                {t("eyebrow")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                {collectionTitle ?? t("dialogTitle")}
              </h2>
              <p
                data-testid="watch-collection-download-description"
                className="mt-3 max-w-[46ch] text-sm leading-6 text-stone-300"
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
                className="flex w-fit shrink-0 flex-col items-center justify-self-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-5 shadow-xl shadow-black/30 backdrop-blur-sm min-[700px]:justify-self-end min-[700px]:gap-4 min-[700px]:rounded-[2rem] min-[700px]:py-6"
              >
                <div
                  data-testid="watch-collection-download-thumbnail-stack"
                  className="relative h-[7.5rem] w-[11.5rem] shrink-0 min-[700px]:h-[10.5rem] min-[700px]:w-64"
                  aria-hidden="true"
                >
                  {options.candidates.slice(0, 3).map((episode, index) => (
                    <div
                      key={episode.documentId}
                      data-testid="watch-collection-download-thumbnail"
                      className={`absolute top-0 left-0 aspect-video w-40 overflow-hidden rounded-xl border-2 border-stone-950 bg-stone-800 shadow-xl ring-1 ring-white/10 min-[700px]:w-56 ${COLLECTION_THUMBNAIL_STACK_CLASSES[index]}`}
                      style={{
                        zIndex: 3 - index,
                      }}
                    >
                      {episode.thumbnailUrl ? (
                        <Image
                          src={episode.thumbnailUrl}
                          alt=""
                          fill
                          sizes="(min-width: 700px) 224px, 160px"
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
                  className="whitespace-nowrap text-center text-stone-300"
                >
                  <span className="text-3xl font-semibold tabular-nums text-white min-[700px]:text-5xl">
                    {options.candidates.length}
                  </span>{" "}
                  <span className="text-base font-medium min-[700px]:text-xl">
                    videos
                  </span>
                </span>
              </div>
            ) : null}
          </div>

          {effectiveAuthLoginUrl ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="font-semibold text-white">{t("signInTitle")}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
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
                <div className="flex flex-col gap-2.5 text-sm font-semibold">
                  <span>{t("languageLabel")}</span>
                  <LanguageCombobox
                    options={languages}
                    value={languageSlug}
                    disabled={busy}
                    onChange={setLanguageSlug}
                    compact
                    triggerClassName="border-white/15 bg-stone-900/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-white/10 focus-visible:ring-amber-400"
                  />
                </div>
                <label className="flex flex-col gap-2.5 text-sm font-semibold">
                  <span>{t("qualityLabel")}</span>
                  <select
                    data-testid="watch-collection-download-quality"
                    value={effectiveTier ?? ""}
                    disabled={busy || !effectiveTier}
                    onChange={(event) =>
                      setSelectedTier(event.target.value as DownloadTier)
                    }
                    className="scheme-dark h-14 rounded-xl border border-white/15 bg-stone-900/70 px-4 text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-colors hover:border-white/25 hover:bg-white/10 focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
                  >
                    {(options?.commonTiers ?? []).map((tier) => (
                      <option key={tier} value={tier}>
                        {t(tierMessageKey(tier))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {loadState.status === "loading" ? (
                <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-sm text-stone-300">
                  <LoaderCircle className="animate-spin" size={18} />
                  {t("loading")}
                </div>
              ) : null}
              {loadState.status === "error" ? (
                <div className="rounded-2xl bg-white/5 p-4 text-sm text-stone-300">
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
                <p className="rounded-2xl bg-white/5 p-4 text-sm text-stone-300">
                  {t("noDownloads")}
                </p>
              ) : null}
              {options && options.skipped.length > 0 ? (
                <div className="text-sm text-amber-300">
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

              {directoryPickerSupported ? (
                <Button
                  variant="ghost"
                  data-testid="watch-collection-download-folder"
                  disabled={busy}
                  onClick={chooseDirectory}
                  className="h-auto w-full justify-start border-white/15 bg-stone-900/70 px-4 py-3 text-stone-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/25 hover:bg-white/10 hover:text-white"
                >
                  <FolderOpen size={17} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {directory?.name
                      ? t("folderSelected", { name: directory.name })
                      : t("chooseFolder")}
                  </span>
                  <ChevronRight className="ml-auto text-stone-500" size={16} />
                </Button>
              ) : (
                <p className="text-xs leading-5 text-stone-400">
                  {t("browserFallback")}
                </p>
              )}

              {progress || result ? (
                <div
                  data-testid="watch-collection-download-progress"
                  aria-live="polite"
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>
                      {running && progress?.active
                        ? t("downloading", { title: progress.active.title })
                        : result?.canceled
                          ? t("canceled")
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
                    <p className="mt-3 text-sm text-amber-300">
                      {t("failedCount", { count: result?.failed.length ?? 0 })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="text-sm font-semibold text-brand-red"
                >
                  {error}
                </p>
              ) : null}

              <div
                data-testid="watch-collection-download-actions"
                className="flex justify-end gap-3 border-t border-white/10 pt-5"
              >
                <Button
                  variant="ghost"
                  data-testid="watch-collection-download-close"
                  onClick={close}
                >
                  {t("close")}
                </Button>
                {busy ? (
                  <Button
                    variant="pill"
                    data-testid="watch-collection-download-cancel"
                    onClick={cancelDownload}
                  >
                    <Square size={15} />
                    {t("cancel")}
                  </Button>
                ) : (
                  <Button
                    variant="pill"
                    data-testid="watch-collection-download-start"
                    disabled={
                      loadState.status !== "ready" ||
                      !effectiveTier ||
                      options?.candidates.length === 0
                    }
                    onClick={() =>
                      void startDownload(
                        result && result.failed.length > 0
                          ? failedCollectionDownloadItems(result)
                          : undefined,
                      )
                    }
                  >
                    <Download size={16} />
                    {result?.failed.length
                      ? t("retryFailed")
                      : result
                        ? t("downloadAgain")
                        : t("start")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
