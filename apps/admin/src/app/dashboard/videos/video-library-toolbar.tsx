"use client"

import type { Route } from "next"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  LoaderCircle,
  Search,
  X,
} from "lucide-react"
import type { getAdminMessages } from "@/i18n/server"
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

export function VideoLibraryToolbar({
  category,
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

  function submitForm(form: HTMLFormElement) {
    const formData = new FormData(form)
    const href = videoLibraryHref({
      page: 1,
      query: parseVideoLibraryQuery(fieldValue(formData.get("q"))),
      category: parseVideoLibraryCategory(fieldValue(formData.get("type"))),
      language: parseVideoLibraryLanguage(fieldValue(formData.get("language"))),
      sort: parseVideoLibrarySort(fieldValue(formData.get("sort"))),
    })

    const currentHref = `${window.location.pathname}${window.location.search}`
    if (href === currentHref) {
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(true)
    router.push(href as Route)
  }

  function submitContainingForm(target: HTMLSelectElement) {
    target.form?.requestSubmit()
  }

  const clearHref = videoLibraryHref({
    page: 1,
    category,
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

        <SelectControl
          className="w-[190px]"
          label={page.filters.languageLabel}
          name="language"
          defaultValue={language}
          options={languageSelectOptions}
          onChange={submitContainingForm}
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
