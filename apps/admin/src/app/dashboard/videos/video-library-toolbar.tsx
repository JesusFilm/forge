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
  label,
  defaultValue,
  name,
  onChange,
  options,
}: {
  label: string
  defaultValue: string
  name: string
  onChange: (target: HTMLSelectElement) => void
  options: SelectOption[]
}) {
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => onChange(event.currentTarget)}
        className="h-[62px] w-full appearance-none rounded-[13px] border border-[#303039] bg-[#1c1c20] pl-5 pr-12 text-[17px] font-semibold text-[#d6d6dc] outline-none transition-all duration-150 ease-out hover:border-[#4b4b57] hover:bg-[#222228] focus:border-[#5a5a66] focus:ring-2 focus:ring-[#6dd6be]/25"
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8d8d98]"
        strokeWidth={1.7}
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
      className="grid gap-4 xl:grid-cols-[minmax(320px,620px)_minmax(220px,260px)_minmax(220px,260px)_270px]"
    >
      <div className="min-w-0">
        <label htmlFor="video-library-search" className="sr-only">
          {page.search.label}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-[#73737f]"
            strokeWidth={1.6}
          />
          <input
            id="video-library-search"
            name="q"
            type="search"
            maxLength={VIDEO_LIBRARY_MAX_QUERY_LENGTH}
            defaultValue={query}
            placeholder={page.search.placeholder}
            className="h-[62px] w-full rounded-[13px] border border-[#303039] bg-[#1c1c20] pl-16 pr-28 text-[18px] text-[#ededf0] outline-none transition-all duration-150 ease-out placeholder:text-[#777782] focus:border-[#5a5a66] focus:bg-[#222228] focus:ring-2 focus:ring-[#6dd6be]/25"
          />
          {query ? (
            <Link
              href={clearHref}
              aria-label={page.search.clear}
              className="absolute right-14 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[#94949f] transition-all duration-150 ease-out hover:bg-[#2a2a31] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6dd6be]"
            >
              <X className="h-5 w-5" strokeWidth={1.7} />
            </Link>
          ) : null}
          <button
            type="submit"
            aria-label={page.search.submit}
            title={page.search.submit}
            disabled={isSubmitting}
            className="absolute right-4 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[#9fded3] transition-all duration-150 ease-out hover:bg-[#2a2a31] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6dd6be] disabled:cursor-wait disabled:opacity-70"
          >
            <ArrowRight className="h-5 w-5" strokeWidth={1.7} />
          </button>
        </div>
        {query ? (
          <p className="mt-2 font-mono text-[12px] text-[#777783]">
            {page.search.active.replace("{query}", query)}
          </p>
        ) : null}
      </div>

      <SelectControl
        label={page.filters.categoryLabel}
        name="type"
        defaultValue={category}
        options={categoryOptions}
        onChange={submitContainingForm}
      />

      <SelectControl
        label={page.filters.languageLabel}
        name="language"
        defaultValue={language}
        options={languageSelectOptions}
        onChange={submitContainingForm}
      />

      <div className="relative">
        <ArrowUpDown
          aria-hidden="true"
          className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8d8d98]"
          strokeWidth={1.7}
        />
        <div className="[&_select]:pl-14">
          <SelectControl
            label={page.sort.label}
            name="sort"
            defaultValue={sort}
            options={sortOptions}
            onChange={submitContainingForm}
          />
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        {isSubmitting ? page.filters.loading : page.filters.ready}
      </span>
      {isSubmitting ? (
        <div
          role="status"
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#303039] bg-[#222228] px-3 font-mono text-[12px] font-semibold text-[#c8f4ea] xl:col-span-4"
        >
          <LoaderCircle
            className="h-4 w-4 animate-spin text-[#6dd6be]"
            strokeWidth={1.8}
          />
          {page.filters.loading}
        </div>
      ) : null}
    </form>
  )
}
