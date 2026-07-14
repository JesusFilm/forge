"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, FolderOpen, LoaderCircle, LogIn, Square } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  buildCollectionDownloadOptions,
  buildCollectionDownloadQueue,
  type CollectionDownloadEpisode,
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
import type { DownloadTier } from "@/components/watch/download-options"
import type { LanguageComboboxOption } from "@/components/watch/LanguageCombobox"
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
    const response = await loadWatchCollectionDownloads({
      collectionSlug,
      languageSlug,
    })
    if (requestVersion !== requestVersionRef.current) return
    if (!response.ok) {
      setLoadState({ status: "error" })
      return
    }
    const nextOptions = buildCollectionDownloadOptions(episodes, response.dubs)
    setLoadState({ status: "ready", options: nextOptions })
    setSelectedTier(nextOptions.commonTiers[0] ?? "highest")
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
    setError(null)
    setResult(null)

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

    const items =
      retryItems ??
      buildCollectionDownloadQueue({
        candidates: options.candidates,
        tier: effectiveTier,
        languageCode: languageCodeFor(selectedLanguage ?? {}),
        languageName: selectedLanguage?.name,
        languageSlug,
      })
    const controller = new AbortController()
    controllerRef.current = controller
    setProgress({
      active: items[0] ?? null,
      completed: [],
      failed: [],
      total: items.length,
    })
    const nextResult = await runCollectionDownloadQueue({
      items,
      signal: controller.signal,
      directory,
      onProgress: setProgress,
    })
    controllerRef.current = null
    setProgress({
      active: null,
      completed: nextResult.completed,
      failed: nextResult.failed,
      total: nextResult.total,
    })
    setResult(nextResult)
    if (nextResult.authRequired) {
      const refreshedSession = await resolveDownloadSessionAccess()
      if (!refreshedSession.ok && refreshedSession.reason === "auth-required") {
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
        className="w-full max-w-[min(92vw,680px)] border-0 bg-stone-950 p-0 text-stone-100 ring-0 sm:max-w-[680px]"
        overlayClassName="bg-black/85 supports-backdrop-filter:backdrop-blur-md"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("dialogTitle")}</DialogTitle>
        <div className="flex max-h-[86vh] flex-col gap-6 overflow-y-auto p-6 sm:p-8">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-amber-400 uppercase">
              {t("eyebrow")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
              {collectionTitle ?? t("dialogTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              {t("description")}
            </p>
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  <span>{t("languageLabel")}</span>
                  <select
                    data-testid="watch-collection-download-language"
                    value={languageSlug}
                    disabled={busy}
                    onChange={(event) => setLanguageSlug(event.target.value)}
                    className="h-12 rounded-xl border border-white/10 bg-white/5 px-4 text-stone-100 outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {languages.map((language) => (
                      <option key={language.slug} value={language.slug}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  <span>{t("qualityLabel")}</span>
                  <select
                    data-testid="watch-collection-download-quality"
                    value={effectiveTier ?? ""}
                    disabled={busy || !effectiveTier}
                    onChange={(event) =>
                      setSelectedTier(event.target.value as DownloadTier)
                    }
                    className="h-12 rounded-xl border border-white/10 bg-white/5 px-4 text-stone-100 outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
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
              {options && options.candidates.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-stone-300">
                  <p>
                    {t("availableCount", { count: options.candidates.length })}
                  </p>
                  {options.skipped.length > 0 ? (
                    <p className="mt-1 text-amber-300">
                      {t("skippedCount", { count: options.skipped.length })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {directoryPickerSupported ? (
                <Button
                  variant="ghost"
                  data-testid="watch-collection-download-folder"
                  disabled={busy}
                  onClick={chooseDirectory}
                  className="justify-start border-white/15 bg-white/5 text-stone-100 hover:bg-white/10 hover:text-white"
                >
                  <FolderOpen size={17} />
                  {directory?.name
                    ? t("folderSelected", { name: directory.name })
                    : t("chooseFolder")}
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

              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={close}>
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
