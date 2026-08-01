"use client"

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ImageIcon,
  LoaderCircle,
  Search,
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { cx } from "@/components/admin-ui"
import type { MediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import { ImagePickerBrowser } from "@/app/dashboard/experiences/experience-editor/image-picker-browser"
import {
  loadVideoSearchSocialLocaleAction,
  loadVideoSearchSocialMediaLibraryAction,
  saveVideoSearchSocialAction,
  searchVideoSearchSocialLocalesAction,
  type VideoSearchSocialLoadResult,
  type VideoSearchSocialMediaLibraryResult,
  type VideoSearchSocialSaveResult,
  type VideoSearchSocialSearchResult,
} from "./video-search-social-actions"
import type {
  VideoSearchSocialLocaleData,
  VideoSearchSocialLocaleOption,
} from "./video-search-social-data"

type Draft = {
  searchTitle: string
  searchDescription: string
  socialImageAssetId: string | null
}

type PendingIntent =
  | { kind: "locale"; option: VideoSearchSocialLocaleOption }
  | { kind: "navigation"; href: string }

type VideoSearchSocialEditorProps = {
  videoId: string
  canEdit: boolean
  initialOptions: VideoSearchSocialLocaleOption[]
  initialLocale: VideoSearchSocialLocaleData | null
  mediaLibrary: MediaLibraryBrowserData
  mediaLibraryInitiallyLoaded?: boolean
  searchAction?: (input: {
    videoId: string
    query: string
  }) => Promise<VideoSearchSocialSearchResult>
  loadAction?: (input: {
    videoLocaleId: string
  }) => Promise<VideoSearchSocialLoadResult>
  loadMediaLibraryAction?: () => Promise<VideoSearchSocialMediaLibraryResult>
  saveAction?: (input: {
    videoLocaleId: string
    searchTitle: string | null
    searchDescription: string | null
    socialImageAssetId: string | null
  }) => Promise<VideoSearchSocialSaveResult>
}

function draftFromLocale(locale: VideoSearchSocialLocaleData | null): Draft {
  return {
    searchTitle: locale?.searchTitle ?? "",
    searchDescription: locale?.searchDescription ?? "",
    socialImageAssetId: locale?.socialImageAssetId ?? null,
  }
}

function normalizedDraft(draft: Draft) {
  return {
    searchTitle: draft.searchTitle.trim() || null,
    searchDescription: draft.searchDescription.trim() || null,
    socialImageAssetId: draft.socialImageAssetId,
  }
}

function localeIdentity(option: VideoSearchSocialLocaleOption) {
  return [option.languageCode, option.languageSlug, option.locale]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" / ")
}

function statusClass(status: VideoSearchSocialLocaleOption["status"]) {
  return status === "PUBLISHED"
    ? "text-[var(--color-success)]"
    : "text-[var(--color-warning)]"
}

export function VideoSearchSocialEditor({
  videoId,
  canEdit,
  initialOptions,
  initialLocale,
  mediaLibrary,
  mediaLibraryInitiallyLoaded = true,
  searchAction = searchVideoSearchSocialLocalesAction,
  loadAction = loadVideoSearchSocialLocaleAction,
  loadMediaLibraryAction = loadVideoSearchSocialMediaLibraryAction,
  saveAction = saveVideoSearchSocialAction,
}: VideoSearchSocialEditorProps) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState(initialOptions)
  const [searchState, setSearchState] = useState<
    "initial" | "loading" | "loaded" | "error"
  >("initial")
  const [locale, setLocale] = useState(initialLocale)
  const [draft, setDraft] = useState(() => draftFromLocale(initialLocale))
  const persistedDraft = useMemo(() => draftFromLocale(locale), [locale])
  const [loadingLocale, setLoadingLocale] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [message, setMessage] = useState("")
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLibrary, setPickerLibrary] = useState(mediaLibrary)
  const [pickerLibraryLoaded, setPickerLibraryLoaded] = useState(
    mediaLibraryInitiallyLoaded,
  )
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null)
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  const dirty = useMemo(
    () =>
      JSON.stringify(normalizedDraft(draft)) !==
      JSON.stringify(normalizedDraft(persistedDraft)),
    [draft, persistedDraft],
  )
  const selectedAsset =
    pickerLibrary.images.find(
      (asset) => asset.id === draft.socialImageAssetId,
    ) ??
    locale?.socialImage ??
    null
  const effectiveTitle =
    draft.searchTitle.trim() || locale?.sourceTitle || "No title available"
  const effectiveDescription =
    draft.searchDescription.trim() ||
    locale?.sourceDescription ||
    "No description available"

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    const onDocumentClick = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented) return
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest("a[href]")
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      setPendingIntent({ kind: "navigation", href: destination.href })
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onDocumentClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onDocumentClick, true)
    }
  }, [dirty])

  async function runSearch(event?: FormEvent) {
    event?.preventDefault()
    setSearchState("loading")
    setMessage("Searching video locales…")
    let result: VideoSearchSocialSearchResult
    try {
      result = await searchAction({ videoId, query })
    } catch {
      setSearchState("error")
      setMessage("Video locales could not be loaded. Please try again.")
      return
    }
    if (!result.ok) {
      setSearchState("error")
      setMessage(result.message)
      return
    }
    setOptions(result.options)
    setSearchState("loaded")
    setMessage(
      result.options.length === 0
        ? "No video locales match this search."
        : `${result.options.length} video locales loaded.`,
    )
  }

  async function loadLocale(option: VideoSearchSocialLocaleOption) {
    setLoadingLocale(true)
    setErrorCode(null)
    setMessage(`Loading ${option.languageName}…`)
    let result: VideoSearchSocialLoadResult
    try {
      result = await loadAction({ videoLocaleId: option.id })
    } catch {
      setLoadingLocale(false)
      setErrorCode("LOAD_FAILED")
      setMessage("Search metadata could not be loaded. Please try again.")
      errorSummaryRef.current?.focus()
      return
    }
    if (!result.ok) {
      setLoadingLocale(false)
      setMessage(result.message)
      setErrorCode(result.code)
      errorSummaryRef.current?.focus()
      return
    }
    setLocale(result.data)
    const nextDraft = draftFromLocale(result.data)
    setDraft(nextDraft)
    setLoadingLocale(false)
    setMessage(`${result.data.languageName} is ready to edit.`)
  }

  function requestLocale(option: VideoSearchSocialLocaleOption) {
    if (option.id === locale?.videoLocaleId) return
    if (dirty) {
      setPendingIntent({ kind: "locale", option })
      return
    }
    void loadLocale(option)
  }

  function completeIntent(intent: PendingIntent) {
    setPendingIntent(null)
    if (intent.kind === "locale") {
      void loadLocale(intent.option)
      return
    }
    window.location.assign(intent.href)
  }

  async function save(): Promise<boolean> {
    if (!locale || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    setErrorCode(null)
    setMessage("Saving Search and Social metadata…")
    const submitted = normalizedDraft(draft)
    let result: VideoSearchSocialSaveResult
    try {
      result = await saveAction({
        videoLocaleId: locale.videoLocaleId,
        ...submitted,
      })
    } catch {
      savingRef.current = false
      setSaving(false)
      setErrorCode("SAVE_FAILED")
      setMessage("Search metadata could not be saved. Please try again.")
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0)
      return false
    }
    savingRef.current = false
    setSaving(false)
    if (!result.ok) {
      setErrorCode(result.code)
      setMessage(result.message)
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0)
      return false
    }

    const persisted: Draft = {
      searchTitle: result.data.searchTitle ?? "",
      searchDescription: result.data.searchDescription ?? "",
      socialImageAssetId: result.data.socialImageAssetId,
    }
    setDraft(persisted)
    setLocale((current) =>
      current
        ? {
            ...current,
            searchTitle: result.data.searchTitle,
            searchDescription: result.data.searchDescription,
            socialImageAssetId: result.data.socialImageAssetId,
            socialImage:
              pickerLibrary.images.find(
                (asset) => asset.id === result.data.socialImageAssetId,
              ) ?? null,
          }
        : current,
    )
    setMessage("Search and Social metadata saved.")
    return true
  }

  async function saveAndContinue() {
    const intent = pendingIntent
    if (!intent) return
    if (await save()) completeIntent(intent)
  }

  function discardAndContinue() {
    const intent = pendingIntent
    if (!intent) return
    setDraft(persistedDraft)
    completeIntent(intent)
  }

  async function openMediaPicker() {
    if (pickerLibraryLoaded) {
      setPickerOpen(true)
      return
    }

    setPickerLoading(true)
    setErrorCode(null)
    setMessage("Loading Media Libraryâ€¦")
    let result: VideoSearchSocialMediaLibraryResult
    try {
      result = await loadMediaLibraryAction()
    } catch {
      setPickerLoading(false)
      setErrorCode("LOAD_FAILED")
      setMessage("Media Library could not be loaded. Please try again.")
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0)
      return
    }
    setPickerLoading(false)
    if (!result.ok) {
      setErrorCode(result.code)
      setMessage(result.message)
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0)
      return
    }
    setPickerLibrary(result.data)
    setPickerLibraryLoaded(true)
    setPickerOpen(true)
    setMessage("Media Library loaded.")
  }

  if (!canEdit) {
    return (
      <section className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-4 py-4">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          Search &amp; Social
        </h2>
        <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
          Administrator access is required to edit crawler metadata.
        </p>
      </section>
    )
  }

  const fieldsInvalid = errorCode === "INVALID_INPUT"

  return (
    <section
      aria-labelledby="video-search-social-title"
      className="min-w-0 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)]"
    >
      <div className="border-b border-[var(--color-hairline)] px-4 py-4">
        <div className="label-text">Media Library</div>
        <h2
          id="video-search-social-title"
          className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]"
        >
          Search &amp; Social
        </h2>
        <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--color-text-muted)]">
          Override crawler and sharing metadata for one exact locale. The video
          title, description, publication status, and player stay unchanged.
        </p>
      </div>

      <div className="grid min-w-0 gap-5 p-4 lg:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]">
        <div className="min-w-0">
          <form role="search" onSubmit={runSearch} className="grid gap-2">
            <label htmlFor="video-locale-search" className="label-text">
              Find a locale
            </label>
            <div className="flex min-w-0 gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input
                  id="video-locale-search"
                  type="search"
                  value={query}
                  maxLength={120}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Language, code, slug, or title"
                  className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-9 pr-3 font-mono text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)]"
                />
              </div>
              <button
                type="submit"
                disabled={searchState === "loading"}
                className="inline-flex h-10 items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] disabled:cursor-wait disabled:opacity-60"
              >
                {searchState === "loading" ? "Searching…" : "Search"}
              </button>
            </div>
          </form>

          <div className="mt-3 min-h-40 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            {searchState === "loading" ? (
              <div
                role="status"
                className="flex items-center gap-2 p-4 text-[13px] text-[var(--color-text-muted)]"
              >
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading
                locales
              </div>
            ) : searchState === "error" ? (
              <div
                role="alert"
                className="grid gap-3 p-4 text-[13px] text-[var(--color-text-muted)]"
              >
                <span>Locales could not be loaded.</span>
                <button
                  type="button"
                  onClick={() => void runSearch()}
                  className="w-fit text-[var(--color-brand)] underline"
                >
                  Retry
                </button>
              </div>
            ) : options.length === 0 ? (
              <div
                role="status"
                className="p-4 text-[13px] text-[var(--color-text-muted)]"
              >
                No video locales match this search.
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-[var(--color-hairline)] overflow-y-auto">
                {options.map((option) => {
                  const selected = option.id === locale?.videoLocaleId
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        onClick={() => requestLocale(option)}
                        className={cx(
                          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-brand)]",
                          selected && "bg-[var(--color-surface-raised)]",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                            {option.languageName}
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                            {localeIdentity(option) || option.id}
                          </span>
                          <span
                            className={cx(
                              "mt-1 block font-mono text-[10px] font-semibold",
                              statusClass(option.status),
                            )}
                          >
                            {option.status}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-[var(--color-text-muted)]">
            Results are bounded; search reaches locales beyond the detail
            sample.
          </p>
        </div>

        <div className="min-w-0" aria-busy={loadingLocale || saving}>
          <div
            ref={errorSummaryRef}
            tabIndex={-1}
            role={errorCode ? "alert" : "status"}
            className="sr-only"
          >
            {message}
          </div>
          {loadingLocale ? (
            <div
              role="status"
              className="flex min-h-56 items-center justify-center gap-2 rounded-sm border border-[var(--color-hairline)] text-[13px] text-[var(--color-text-muted)]"
            >
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading selected
              locale
            </div>
          ) : !locale ? (
            <div className="flex min-h-56 items-center justify-center rounded-sm border border-dashed border-[var(--color-hairline)] px-6 text-center text-[13px] text-[var(--color-text-muted)]">
              Select a locale to edit its Search and Social metadata.
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
              className="grid gap-5"
            >
              <header className="flex flex-col gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                    {locale.languageName}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {[locale.languageCode, locale.languageSlug, locale.locale]
                      .filter(Boolean)
                      .join(" / ") || locale.videoLocaleId}
                  </div>
                </div>
                <span
                  className={cx(
                    "font-mono text-[11px] font-semibold",
                    statusClass(locale.status),
                  )}
                >
                  {locale.status}
                </span>
              </header>

              <fieldset
                disabled={saving}
                className="grid min-w-0 gap-5 disabled:opacity-70"
              >
                <div className="grid gap-3 rounded-sm border border-[var(--color-hairline)] p-3">
                  <div>
                    <div className="label-text">
                      Source video copy — read only
                    </div>
                    <div className="mt-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
                      {locale.sourceTitle || "No localized video title"}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-[var(--color-text-muted)]">
                      {locale.sourceDescription ||
                        "No localized video description"}
                    </p>
                  </div>
                </div>

                <label className="grid gap-1.5" htmlFor="search-title">
                  <span className="flex items-center justify-between gap-3">
                    <span className="label-text">Search title override</span>
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      {draft.searchTitle.length} / 60 suggested
                    </span>
                  </span>
                  <input
                    id="search-title"
                    value={draft.searchTitle}
                    maxLength={10_000}
                    aria-invalid={fieldsInvalid || undefined}
                    aria-describedby="search-title-help"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        searchTitle: event.currentTarget.value,
                      }))
                    }
                    className="h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)] aria-[invalid=true]:border-[var(--color-danger)]"
                  />
                  <span
                    id="search-title-help"
                    className="text-[11px] text-[var(--color-text-muted)]"
                  >
                    Blank uses the localized video title. This is the complete
                    final title, including any brand text.
                  </span>
                </label>

                <label className="grid gap-1.5" htmlFor="search-description">
                  <span className="flex items-center justify-between gap-3">
                    <span className="label-text">
                      Search description override
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                      {draft.searchDescription.length} / 160 suggested
                    </span>
                  </span>
                  <textarea
                    id="search-description"
                    value={draft.searchDescription}
                    rows={5}
                    maxLength={10_000}
                    aria-invalid={fieldsInvalid || undefined}
                    aria-describedby="search-description-help"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        searchDescription: event.currentTarget.value,
                      }))
                    }
                    className="resize-y rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-[13px] leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)] aria-[invalid=true]:border-[var(--color-danger)]"
                  />
                  <span
                    id="search-description-help"
                    className="text-[11px] text-[var(--color-text-muted)]"
                  >
                    Blank uses the localized video description.
                  </span>
                </label>

                <div className="grid gap-3 rounded-sm border border-[var(--color-hairline)] p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="label-text">Social image override</div>
                      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                        Public, ready images only. 1200×630 is recommended.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {draft.socialImageAssetId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              socialImageAssetId: null,
                            }))
                            setMessage(
                              "Social image cleared. Existing video image fallback will be used.",
                            )
                          }}
                          className="h-9 rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                        >
                          Clear
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pickerLoading}
                        onClick={() => void openMediaPicker()}
                        className="h-9 rounded-sm border border-[var(--color-brand)] px-3 text-[12px] font-semibold text-[var(--color-brand)] hover:bg-[var(--color-surface-raised)] disabled:cursor-wait disabled:opacity-60"
                      >
                        {pickerLoading
                          ? "Loadingâ€¦"
                          : draft.socialImageAssetId
                            ? "Replace"
                            : "Select"}
                      </button>
                    </div>
                  </div>
                  {selectedAsset ? (
                    <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                      <div className="aspect-video overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)]">
                        {selectedAsset.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedAsset.previewUrl}
                            alt={selectedAsset.altText ?? ""}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="h-6 w-6 text-[var(--color-text-muted)]" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {selectedAsset.displayName}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {selectedAsset.width && selectedAsset.height
                            ? `${selectedAsset.width}×${selectedAsset.height} / `
                            : ""}
                          {selectedAsset.mimeType} / {selectedAsset.id}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[12px] text-[var(--color-text-muted)]">
                      Using the existing video image fallback.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
                  <div className="label-text">Effective crawler preview</div>
                  <div className="text-[18px] leading-6 text-[#8ab4f8]">
                    {effectiveTitle}
                  </div>
                  <div className="font-mono text-[11px] text-[var(--color-success)]">
                    jesusfilm.org › watch › {locale.slug}
                  </div>
                  <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
                    {effectiveDescription}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    Preview only. Search engines may rewrite titles or
                    descriptions.
                  </p>
                </div>
              </fieldset>

              <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-hairline)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex min-h-5 items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
                  {errorCode ? (
                    <AlertCircle className="h-4 w-4 text-[var(--color-danger)]" />
                  ) : message.includes("saved") ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
                  ) : null}
                  <span aria-live="polite">
                    {message ||
                      (dirty ? "Unsaved changes" : "No unsaved changes")}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={!dirty || saving}
                  className="inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-sm border border-[var(--color-brand)] bg-[var(--color-brand)] px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:border-[var(--color-hairline)] disabled:bg-[var(--color-surface-raised)] disabled:text-[var(--color-text-disabled)]"
                >
                  {saving ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : null}
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ImagePickerBrowser
        open={pickerOpen}
        mediaLibrary={pickerLibrary}
        query={pickerQuery}
        selectedFolderId={pickerFolderId}
        selectedAssetId={draft.socialImageAssetId}
        canClearImage={Boolean(draft.socialImageAssetId)}
        canUpload={false}
        uploadAction={async () => ({ ok: false, error: "forbidden" })}
        onQueryChange={setPickerQuery}
        onSelectFolder={setPickerFolderId}
        onSelectImage={(asset) => {
          setDraft((current) => ({ ...current, socialImageAssetId: asset.id }))
          setPickerOpen(false)
          setMessage(`${asset.displayName} selected as the social image.`)
        }}
        onClearImage={() => {
          setDraft((current) => ({ ...current, socialImageAssetId: null }))
          setPickerOpen(false)
          setMessage(
            "Social image cleared. Existing video image fallback will be used.",
          )
        }}
        onClose={() => setPickerOpen(false)}
      />

      {pendingIntent ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
            aria-describedby="unsaved-description"
            className="w-full max-w-md rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-5 shadow-2xl"
          >
            <h3
              id="unsaved-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              Save your changes?
            </h3>
            <p
              id="unsaved-description"
              className="mt-2 text-[13px] leading-5 text-[var(--color-text-muted)]"
            >
              This locale has unsaved Search and Social metadata. Save it,
              discard it, or cancel to keep editing.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPendingIntent(null)}
                className="h-10 rounded-sm border border-[var(--color-hairline)] text-[12px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={discardAndContinue}
                className="h-10 rounded-sm border border-[var(--color-hairline)] text-[12px] text-[var(--color-danger)]"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveAndContinue()}
                className="h-10 rounded-sm bg-[var(--color-brand)] text-[12px] font-semibold text-white disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
