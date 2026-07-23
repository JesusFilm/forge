"use client"

import type { Route } from "next"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  type MouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  LoaderCircle,
  Search,
  X,
} from "lucide-react"
import type { getAdminMessages } from "@/i18n/server"
import { ADMIN_NAVIGATION_PENDING_EVENT } from "@/components/admin-shell"
import {
  parseVideoLibraryCategory,
  parseVideoLibraryLanguage,
  parseVideoLibraryQuery,
  parseVideoLibrarySort,
  type VideoLibraryCategory,
  type VideoLibrarySort,
  videoLibraryHref,
  VIDEO_LIBRARY_MAX_QUERY_LENGTH,
} from "../video-library-utils"
import type { VideoLibraryLanguageOption } from "../live-data"

type VideosMessages = Awaited<
  ReturnType<typeof getAdminMessages>
>["pages"]["videos"]

type VideoLibraryToolbarProps = {
  category: VideoLibraryCategory
  collection: string
  language: string
  languageOptions: VideoLibraryLanguageOption[]
  page: VideosMessages
  query: string
  sort: VideoLibrarySort
}

type SelectOption = {
  label: string
  value: string
}

const LANGUAGE_MENU_WIDTH = 280
const LANGUAGE_MENU_VIEWPORT_GAP = 16

function fieldValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : undefined
}

function SelectControl({
  className,
  label,
  defaultValue,
  name,
  onChange,
  options,
}: {
  className?: string
  label: string
  defaultValue: string
  name: string
  onChange: (target: HTMLSelectElement) => void
  options: SelectOption[]
}) {
  return (
    <label className={`relative block min-w-0 shrink-0 ${className ?? ""}`}>
      <span className="sr-only">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange(event.currentTarget)}
        className="h-10 w-full appearance-none rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-3 pr-9 text-[12px] font-medium text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface-raised)]"
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
        strokeWidth={1.5}
      />
    </label>
  )
}

function optionMatchesSearch(option: SelectOption, search: string) {
  const query = search.replace(/\s+/g, " ").trim().toLocaleLowerCase("en")
  if (!query) return true

  return `${option.label} ${option.value}`
    .toLocaleLowerCase("en")
    .includes(query)
}

function languageMenuStyle(trigger: HTMLDivElement | null) {
  const rect = trigger?.getBoundingClientRect()
  if (!rect) return null

  const width = Math.min(
    LANGUAGE_MENU_WIDTH,
    window.innerWidth - LANGUAGE_MENU_VIEWPORT_GAP * 2,
  )
  const left = Math.min(
    Math.max(LANGUAGE_MENU_VIEWPORT_GAP, rect.left),
    window.innerWidth - width - LANGUAGE_MENU_VIEWPORT_GAP,
  )

  return {
    left,
    top: rect.bottom + 8,
    width,
  }
}

function SearchableLanguageControl({
  className,
  label,
  name,
  noResultsLabel,
  onSelect,
  options,
  placeholder,
  value,
}: {
  className?: string
  label: string
  name: string
  noResultsLabel: string
  onSelect: (value: string, form: HTMLFormElement) => void
  options: SelectOption[]
  placeholder: string
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [menuStyle, setMenuStyle] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const controlId = useId()
  const listboxId = `${controlId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedOption =
    options.find((option) => option.value === value) ??
    options.find((option) => option.value === "") ??
    options[0]

  const filteredOptions = useMemo(
    () => options.filter((option) => optionMatchesSearch(option, searchValue)),
    [options, searchValue],
  )

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    const handleViewportChange = () => setOpen(false)

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [open])

  function toggleOpen() {
    if (open) {
      setOpen(false)
      return
    }

    setSearchValue("")
    setMenuStyle(languageMenuStyle(rootRef.current))
    setOpen(true)
  }

  function selectOption(
    optionValue: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    const form = event.currentTarget.form
    setOpen(false)
    if (form) onSelect(optionValue, form)
  }

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 shrink-0 ${className ?? ""}`}
    >
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        onClick={toggleOpen}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-left text-[12px] font-medium text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:border-[var(--color-brand)] focus-visible:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        role="combobox"
      >
        <span className="min-w-0 truncate">
          {selectedOption?.label ?? value}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]"
          strokeWidth={1.5}
        />
      </button>

      {open ? (
        <div
          className="fixed z-40 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          style={menuStyle ?? undefined}
        >
          <label className="mb-1 flex h-9 items-center gap-2 rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2">
            <Search
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
            <span className="sr-only">{label}</span>
            <input
              ref={searchInputRef}
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.currentTarget.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
            />
          </label>

          <div
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto overscroll-contain py-0.5 [scrollbar-width:thin]"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = option.value === value

                return (
                  <button
                    key={option.value || "all"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={(event) => selectOption(option.value, event)}
                    className="flex h-8 w-full items-center justify-between gap-3 rounded-[2px] px-2 text-left text-[12px] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-surface-raised)] focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none"
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    <Check
                      aria-hidden="true"
                      className={
                        selected
                          ? "h-3.5 w-3.5 shrink-0 text-[var(--color-success)] opacity-100"
                          : "h-3.5 w-3.5 shrink-0 opacity-0"
                      }
                      strokeWidth={1.5}
                    />
                  </button>
                )
              })
            ) : (
              <div className="px-2 py-4 text-center text-[12px] text-[var(--color-text-muted)]">
                {noResultsLabel}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function VideoLibraryToolbar({
  category,
  collection,
  language,
  languageOptions,
  page,
  query,
  sort,
}: VideoLibraryToolbarProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const categoryOptions: SelectOption[] = [
    { value: "all", label: page.tabs.all },
    { value: "collections", label: page.tabs.collections },
    { value: "episodes", label: page.tabs.episodes },
    { value: "features", label: page.tabs.features },
    { value: "shortFilms", label: page.tabs.shortFilms },
    { value: "series", label: page.tabs.series },
  ]

  const languageSelectOptions: SelectOption[] = [
    { value: "", label: page.filters.allLanguages },
    ...languageOptions,
  ]

  const sortOptions: SelectOption[] = [
    { value: "recent", label: page.sort.options.recent },
    { value: "oldest", label: page.sort.options.oldest },
    { value: "created", label: page.sort.options.created },
    { value: "createdOldest", label: page.sort.options.createdOldest },
  ]

  function submitForm(
    form: HTMLFormElement,
    overrides: { language?: string } = {},
  ) {
    const formData = new FormData(form)
    const href = videoLibraryHref({
      page: 1,
      query: parseVideoLibraryQuery(fieldValue(formData.get("q"))),
      category: parseVideoLibraryCategory(fieldValue(formData.get("type"))),
      collection,
      language: parseVideoLibraryLanguage(
        overrides.language ?? fieldValue(formData.get("language")),
      ),
      sort: parseVideoLibrarySort(fieldValue(formData.get("sort"))),
    })

    const currentHref = `${window.location.pathname}${window.location.search}`
    if (href === currentHref) {
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(true)
    window.dispatchEvent(new Event(ADMIN_NAVIGATION_PENDING_EVENT))
    router.push(href as Route)
  }

  function submitContainingForm(target: HTMLSelectElement) {
    target.form?.requestSubmit()
  }

  function submitLanguageFilter(nextLanguage: string, form: HTMLFormElement) {
    submitForm(form, { language: nextLanguage })
  }

  const clearHref = videoLibraryHref({
    page: 1,
    category,
    collection,
    language,
    sort,
  }) as Route

  return (
    <form
      action="/dashboard/videos"
      method="get"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        submitForm(event.currentTarget)
      }}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="min-w-0">
        <label htmlFor="video-library-search" className="sr-only">
          {page.search.label}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <input
            id="video-library-search"
            name="q"
            type="search"
            maxLength={VIDEO_LIBRARY_MAX_QUERY_LENGTH}
            defaultValue={query}
            placeholder={page.search.placeholder}
            className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-9 pr-16 font-mono text-[12px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface-raised)]"
          />
          {query ? (
            <Link
              href={clearHref}
              aria-label={page.search.clear}
              className="absolute right-9 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </Link>
          ) : null}
          <button
            type="submit"
            aria-label={page.search.submit}
            title={page.search.submit}
            disabled={isSubmitting}
            className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-wait disabled:opacity-70"
          >
            <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        {query ? (
          <p className="mt-2 font-mono text-[11px] text-[var(--color-text-muted)]">
            {page.search.active.replace("{query}", query)}
          </p>
        ) : null}
      </div>

      <div
        aria-label={page.actions.filter}
        className="-mx-1 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]"
      >
        <SelectControl
          className="w-[168px]"
          label={page.filters.categoryLabel}
          name="type"
          defaultValue={category}
          options={categoryOptions}
          onChange={submitContainingForm}
        />

        <SearchableLanguageControl
          className="w-[190px]"
          label={page.filters.languageLabel}
          name="language"
          value={language}
          options={languageSelectOptions}
          placeholder={page.filters.languageSearchPlaceholder}
          noResultsLabel={page.filters.languageNoResults}
          onSelect={submitLanguageFilter}
        />

        <div className="relative w-[210px] shrink-0">
          <ArrowUpDown
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <div className="[&_select]:pl-9">
            <SelectControl
              label={page.sort.label}
              name="sort"
              defaultValue={sort}
              options={sortOptions}
              onChange={submitContainingForm}
            />
          </div>
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {isSubmitting ? page.filters.loading : page.filters.ready}
      </span>
      {isSubmitting ? (
        <div
          role="status"
          className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 font-mono text-[11px] font-semibold text-[var(--color-success)]"
        >
          <LoaderCircle
            className="h-3.5 w-3.5 animate-spin text-[var(--color-success)]"
            strokeWidth={1.5}
          />
          {page.filters.loading}
        </div>
      ) : null}
    </form>
  )
}
