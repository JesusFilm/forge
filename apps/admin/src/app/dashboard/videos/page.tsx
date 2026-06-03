import type { ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  Layers,
  MoreVertical,
  Play,
  Plus,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { loadVideoLibraryPage } from "@/app/dashboard/live-data"
import { getAdminMessages } from "@/i18n/server"
import {
  hasActiveVideoLibraryFilters,
  parseVideoLibraryCategory,
  parseVideoLibraryLanguage,
  parseVideoLibraryPage,
  parseVideoLibraryQuery,
  parseVideoLibrarySort,
  type VideoLibraryCategory,
  type VideoLibrarySort,
  videoLibraryHref,
} from "../video-library-utils"
import { VideoLibraryToolbar } from "./video-library-toolbar"

type VideosPageProps = {
  searchParams?: Promise<{
    page?: string | string[]
    q?: string | string[]
    language?: string | string[]
    sort?: string | string[]
    type?: string | string[]
  }>
}

type VideoLibraryRow = Awaited<
  ReturnType<typeof loadVideoLibraryPage>
>["rows"][number]

type VideoTone = {
  label: string
  icon: string
  thumbnail: string
  thumbnailPattern: string
  progress: string
}

function paginationHref(
  page: number,
  state: {
    category: VideoLibraryCategory
    language: string
    query: string
    sort: VideoLibrarySort
  },
): Route {
  return videoLibraryHref({ page, ...state }) as Route
}

function paginationSummary(
  template: string,
  pagination: {
    rangeStart: number
    rangeEnd: number
    total: number
  },
) {
  return template
    .replace("{start}", pagination.rangeStart.toString())
    .replace("{end}", pagination.rangeEnd.toString())
    .replace("{total}", pagination.total.toString())
}

function pageCountLabel(
  template: string,
  pagination: {
    currentPage: number
    pageCount: number
  },
) {
  return template
    .replace("{current}", pagination.currentPage.toString())
    .replace("{count}", pagination.pageCount.toString())
}

function headerDescription(template: string, total: number) {
  const [before, after] = template.split("{total}")
  if (after === undefined) {
    return template
  }

  return (
    <>
      {before}
      <strong className="font-semibold text-[#f4f4f5]">
        {total.toLocaleString("en")}
      </strong>
      {after}
    </>
  )
}

function overflowLabel(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString("en"))
}

function paginationControlClass(disabled: boolean) {
  return cx(
    "inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#303039] px-3 font-mono text-[12px] transition-all duration-150 ease-out",
    !disabled &&
      "text-[#d8d8de] hover:border-[#4b4b57] hover:bg-[#27272e] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6dd6be]",
    disabled && "text-[#63636f]",
  )
}

function PaginationControl({
  children,
  disabled,
  href,
}: {
  children: ReactNode
  disabled: boolean
  href: Route
}) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={paginationControlClass(true)}>
        {children}
      </span>
    )
  }

  return (
    <Link href={href} className={paginationControlClass(false)}>
      {children}
    </Link>
  )
}

function videoTone(label: VideoLibraryRow["label"]): VideoTone {
  if (label === "FEATURE_FILM") {
    return {
      label: "text-[#ff5f68]",
      icon: "text-[#ffffff]",
      thumbnail: "from-[#4d1019] via-[#371018] to-[#21080d]",
      thumbnailPattern: "bg-[#ff6370]/12",
      progress: "from-[#65cbbb] to-[#63d787]",
    }
  }

  if (label === "SHORT_FILM" || label === "TRAILER") {
    return {
      label: "text-[#f0b34f]",
      icon: "text-[#edae4d]",
      thumbnail: "from-[#6b501f] via-[#4b3515] to-[#2c1b08]",
      thumbnailPattern: "bg-[#f0b34f]/12",
      progress: "from-[#63c7b9] to-[#63d787]",
    }
  }

  return {
    label: "text-[#6fb5ff]",
    icon: "text-[#6fb5ff]",
    thumbnail: "from-[#2b3f70] via-[#23335e] to-[#17233f]",
    thumbnailPattern: "bg-[#7ab8ff]/12",
    progress: "from-[#67c9bf] to-[#66d887]",
  }
}

function videoTypeLabel(video: VideoLibraryRow) {
  return (video.labelLabel ?? "Video").toUpperCase()
}

function sourceLabel(video: VideoLibraryRow) {
  return video.sourceLabel === "Internal"
    ? "Internal source"
    : `${video.sourceLabel} source`
}

function coverageWidth(percent: number) {
  if (percent <= 0) return "0%"
  return `${Math.max(2, percent)}%`
}

function VideoThumbnail({ video }: { video: VideoLibraryRow }) {
  const tone = videoTone(video.label)
  const isFeature = video.label === "FEATURE_FILM"
  const Icon =
    video.label === "COLLECTION" || video.label === "SERIES" ? Layers : Film

  return (
    <div
      className={cx(
        "relative aspect-video w-full overflow-hidden rounded-[12px] border border-white/10 bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:w-[250px]",
        tone.thumbnail,
      )}
    >
      {video.previewImageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={video.previewImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.48))]"
          />
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className={cx(
              "absolute inset-0 opacity-60 [background-image:linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:22px_100%]",
              tone.thumbnailPattern,
            )}
          />
          <span className="absolute inset-0 flex items-center justify-center">
            {isFeature ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#111114] shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
            ) : (
              <Icon className={cx("h-7 w-7", tone.icon)} strokeWidth={1.7} />
            )}
          </span>
        </>
      )}
      <span className="absolute bottom-2.5 right-2.5 rounded-[5px] bg-black/72 px-2 py-1 font-mono text-[12px] font-semibold leading-none text-[#eeeeef]">
        {video.duration}
      </span>
    </div>
  )
}

function VideoRow({
  page,
  video,
}: {
  page: Awaited<ReturnType<typeof getAdminMessages>>["pages"]["videos"]
  video: VideoLibraryRow
}) {
  const tone = videoTone(video.label)
  const percent = video.dubCoveragePercent
  const languages = video.dubLanguages

  return (
    <article className="grid gap-6 border-b border-[#25252b] px-5 py-7 last:border-b-0 md:px-7 xl:grid-cols-[250px_minmax(300px,1fr)_minmax(300px,520px)_142px] xl:items-center">
      <VideoThumbnail video={video} />

      <div className="min-w-0">
        <h2 className="truncate text-[24px] font-semibold leading-8 text-[#f3f3f5]">
          {video.title}
        </h2>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[15px] leading-5 text-[#777783]">
          <span
            className={cx(
              "inline-flex items-center gap-2 font-semibold tracking-normal",
              tone.label,
            )}
          >
            {video.label === "COLLECTION" || video.label === "SERIES" ? (
              <Layers className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <Film className="h-4 w-4" strokeWidth={1.8} />
            )}
            {videoTypeLabel(video)}
          </span>
          <span
            aria-hidden="true"
            className="h-1 w-1 rounded-full bg-[#4a4a54]"
          />
          <span className="max-w-[260px] truncate font-mono text-[#74747f]">
            {video.slug || video.id}
          </span>
          <span
            aria-hidden="true"
            className="h-1 w-1 rounded-full bg-[#4a4a54]"
          />
          <span className="inline-flex items-center gap-2 text-[#85858e]">
            <span className="h-2 w-2 rounded-full bg-[#57d47a]" />
            {sourceLabel(video)}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <span className="align-baseline text-[34px] font-semibold leading-none text-[#f4f4f6]">
              {video.dubCount.toLocaleString("en")}
            </span>
            <span className="ml-3 align-baseline text-[16px] text-[#777783]">
              {page.coverage.languagesDubbed}
            </span>
          </div>
          <span className="font-mono text-[13px] font-semibold text-[#62ceb9]">
            {percent}%
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#29292f]">
          <div
            className={cx(
              "h-full rounded-full bg-gradient-to-r",
              tone.progress,
            )}
            style={{ width: coverageWidth(percent) }}
          />
        </div>
        <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2">
          {languages.length > 0 ? (
            languages.map((language) => (
              <span
                key={language}
                className="rounded-[6px] bg-[#2b2b31] px-3 py-1.5 font-mono text-[13px] font-semibold leading-none text-[#b6b6bd]"
              >
                {language}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-[#686874]">
              {page.coverage.noLanguages}
            </span>
          )}
          {video.dubOverflowCount > 0 ? (
            <span className="px-2 font-mono text-[14px] text-[#7c7c87]">
              {overflowLabel(page.coverage.overflow, video.dubOverflowCount)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 xl:flex-col xl:items-end">
        <time
          dateTime={video.updatedAtIso}
          title={video.updated}
          className="text-right"
        >
          <span className="block text-[15px] font-semibold leading-5 text-[#b4b4bd]">
            {video.updatedRelative}
          </span>
          <span className="mt-1 block font-mono text-[13px] text-[#696975]">
            {video.updatedDateShort}
          </span>
        </time>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label={page.actions.rowActionsUnavailable}
            title={page.actions.rowActionsUnavailable}
            className="inline-flex h-12 w-12 items-center justify-center rounded-[10px] border border-[#2f2f38] text-[#858590] transition-all duration-150 ease-out hover:border-[#464650] hover:bg-[#24242a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6dd6be]"
          >
            <MoreVertical className="h-5 w-5" strokeWidth={1.6} />
          </button>
          {video.visitorUrl ? (
            <a
              href={video.visitorUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${page.table.openVisitorLabel}: ${video.title}`}
              title={page.table.openVisitorLabel}
              className="inline-flex h-12 w-12 items-center justify-center rounded-[10px] border border-[#2f2f38] text-[#858590] transition-all duration-150 ease-out hover:border-[#595965] hover:bg-[#292930] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6dd6be]"
            >
              <ExternalLink className="h-5 w-5" strokeWidth={1.6} />
            </a>
          ) : (
            <span
              aria-disabled="true"
              aria-label={page.table.noVisitorLinkLabel}
              title={page.table.noVisitorLinkLabel}
              className="inline-flex h-12 w-12 items-center justify-center rounded-[10px] border border-[#2f2f38] text-[#555561]"
            >
              <ExternalLink className="h-5 w-5" strokeWidth={1.6} />
              <span className="sr-only">{page.table.noVisitorLinkLabel}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

export default async function VideosPage({
  searchParams,
}: VideosPageProps = {}) {
  const messages = await getAdminMessages()
  const page = messages.pages.videos
  const principal = await requireSession()
  const params = (await searchParams) ?? {}
  const requestedPage = parseVideoLibraryPage(params.page)
  const query = parseVideoLibraryQuery(params.q)
  const category = parseVideoLibraryCategory(params.type)
  const language = parseVideoLibraryLanguage(params.language)
  const sort = parseVideoLibrarySort(params.sort)
  const {
    rows: videoRows,
    pagination,
    languageOptions,
  } = await loadVideoLibraryPage(principal, {
    category,
    language,
    page: requestedPage,
    query,
    sort,
  })
  const paginationState = { category, language, query, sort }
  const toolbarStateKey = videoLibraryHref({
    page: 1,
    ...paginationState,
  })
  const hasActiveFilters = hasActiveVideoLibraryFilters({
    category,
    language,
    query,
  })
  const rangeLabel = paginationSummary(
    page.table.pagination.summary,
    pagination,
  )
  const currentPageLabel = pageCountLabel(
    page.table.pagination.page,
    pagination,
  )

  return (
    <div className="-mx-6 -my-6 min-h-full bg-[#08080a] px-6 py-8 text-[#f3f3f5]">
      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-7">
        <header className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_270px] xl:items-start">
          <div>
            <h1 className="text-[40px] font-semibold leading-tight tracking-normal text-[#f4f4f5]">
              {page.title}
            </h1>
            <p className="mt-3 text-[20px] leading-7 text-[#a0a0a8]">
              {headerDescription(page.description, pagination.total)}
            </p>
          </div>
          <div className="flex xl:justify-end">
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={page.actions.primaryUnavailable}
              className="inline-flex h-[62px] items-center gap-3 rounded-[12px] bg-[#d54f55] px-7 text-[20px] font-semibold text-white shadow-[0_12px_28px_rgba(213,79,85,0.22)] transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-95"
            >
              <Plus className="h-6 w-6" strokeWidth={1.8} />
              {page.actions.primary}
            </button>
          </div>
        </header>

        <section aria-label={page.table.title}>
          <VideoLibraryToolbar
            key={toolbarStateKey}
            category={category}
            language={language}
            languageOptions={languageOptions}
            page={page}
            query={query}
            sort={sort}
          />
        </section>

        <section className="overflow-hidden rounded-[18px] border border-[#303039] bg-[#1b1b1f] shadow-[0_16px_50px_rgba(0,0,0,0.28)]">
          {videoRows.length === 0 ? (
            <div className="px-6 py-16 text-center text-[15px] text-[#8b8b95]">
              {hasActiveFilters ? page.table.emptySearch : page.table.empty}
            </div>
          ) : (
            videoRows.map((video) => (
              <VideoRow key={video.key} page={page} video={video} />
            ))
          )}

          <div className="flex flex-col gap-3 border-t border-[#25252b] px-5 py-4 text-[13px] text-[#858590] md:flex-row md:items-center md:justify-between md:px-7">
            <span className="font-mono">{rangeLabel}</span>
            <div className="flex items-center gap-2">
              <PaginationControl
                href={paginationHref(
                  pagination.currentPage - 1,
                  paginationState,
                )}
                disabled={!pagination.hasPrevious}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                {page.table.pagination.previous}
              </PaginationControl>
              <span className="min-w-[104px] text-center font-mono text-[12px] text-[#a7a7b0]">
                {currentPageLabel}
              </span>
              <PaginationControl
                href={paginationHref(
                  pagination.currentPage + 1,
                  paginationState,
                )}
                disabled={!pagination.hasNext}
              >
                {page.table.pagination.next}
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              </PaginationControl>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
