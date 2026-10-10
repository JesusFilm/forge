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
import { cx, PrimaryButton } from "@/components/admin-ui"
import { canEditVideo } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import {
  loadVideoLibraryDetail,
  loadVideoLibraryPage,
} from "@/app/dashboard/live-data"
import { getAdminMessages } from "@/i18n/server"
import {
  hasActiveVideoLibraryFilters,
  parseVideoLibraryCategory,
  parseVideoLibraryCollection,
  parseVideoLibraryLanguage,
  parseVideoLibraryPage,
  parseVideoLibraryQuery,
  parseVideoLibrarySelectedVideo,
  parseVideoLibrarySelectedLocale,
  parseVideoLibrarySort,
  type VideoLibraryCategory,
  type VideoLibrarySort,
  videoLibraryHref,
} from "../video-library-utils"
import { VideoLibraryToolbar } from "./video-library-toolbar"
import { VideoDetailPage } from "./video-detail-page"
import { VideoSearchSocialEditor } from "./video-search-social-editor"
import { loadInitialVideoSearchSocialState } from "./video-search-social-data"

type VideosPageProps = {
  searchParams?: Promise<{
    page?: string | string[]
    q?: string | string[]
    collection?: string | string[]
    language?: string | string[]
    sort?: string | string[]
    type?: string | string[]
    video?: string | string[]
    locale?: string | string[]
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
    collection: string
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
      <strong className="font-semibold text-[var(--color-text-primary)]">
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
    "inline-flex h-8 items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 font-mono text-[11px] transition-all duration-[120ms] ease-out",
    !disabled &&
      "text-[var(--color-text-secondary)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
    disabled && "text-[var(--color-text-disabled)]",
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
      label: "text-[var(--color-danger)]",
      icon: "text-[var(--color-danger)]",
      thumbnail:
        "from-[color-mix(in_oklab,var(--color-danger)_22%,var(--color-surface))] to-[var(--color-surface)]",
      thumbnailPattern: "bg-[var(--color-danger)]/10",
      progress: "bg-[var(--color-success)]",
    }
  }

  if (label === "SHORT_FILM" || label === "TRAILER") {
    return {
      label: "text-[var(--color-warning)]",
      icon: "text-[var(--color-warning)]",
      thumbnail:
        "from-[color-mix(in_oklab,var(--color-warning)_20%,var(--color-surface))] to-[var(--color-surface)]",
      thumbnailPattern: "bg-[var(--color-warning)]/10",
      progress: "bg-[var(--color-success)]",
    }
  }

  return {
    label: "text-[var(--color-info)]",
    icon: "text-[var(--color-info)]",
    thumbnail:
      "from-[color-mix(in_oklab,var(--color-info)_18%,var(--color-surface))] to-[var(--color-surface)]",
    thumbnailPattern: "bg-[var(--color-info)]/10",
    progress: "bg-[var(--color-success)]",
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
        "relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:w-[168px]",
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
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg)] shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              </span>
            ) : (
              <Icon className={cx("h-6 w-6", tone.icon)} strokeWidth={1.7} />
            )}
          </span>
        </>
      )}
      <span className="absolute bottom-1.5 right-1.5 rounded-[2px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-[var(--color-text-primary)]">
        {video.duration}
      </span>
    </div>
  )
}

function VideoRow({
  page,
  state,
  video,
}: {
  page: Awaited<ReturnType<typeof getAdminMessages>>["pages"]["videos"]
  state: {
    category: VideoLibraryCategory
    collection: string
    currentPage: number
    language: string
    query: string
    sort: VideoLibrarySort
  }
  video: VideoLibraryRow
}) {
  const tone = videoTone(video.label)
  const percent = video.dubCoveragePercent
  const languages = video.dubLanguages
  const targetIdentifier = video.slug || video.id
  const targetHref = video.isCollectionTarget
    ? videoLibraryHref({
        category: "all",
        collection: targetIdentifier,
        language: state.language,
        page: 1,
        query: state.query,
        sort: state.sort,
      })
    : videoLibraryHref({
        category: state.category,
        collection: state.collection,
        language: state.language,
        page: state.currentPage,
        query: state.query,
        sort: state.sort,
        video: targetIdentifier,
      })
  const targetLabel = video.isCollectionTarget
    ? `${page.table.openCollectionLabel}: ${video.title}`
    : `${page.table.openDetailsLabel}: ${video.title}`

  return (
    <article className="group relative grid gap-4 border-b border-[var(--color-hairline)] px-4 py-4 transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[var(--color-surface-raised)] lg:grid-cols-[168px_minmax(0,1fr)_minmax(220px,300px)_104px] lg:items-center">
      <Link
        href={targetHref as Route}
        prefetch={false}
        aria-label={targetLabel}
        className="absolute inset-0 z-10 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-brand)]"
      />
      <VideoThumbnail video={video} />

      <div className="min-w-0">
        <h2 className="truncate text-[18px] font-semibold leading-6 text-[var(--color-text-primary)]">
          {video.title}
        </h2>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-[var(--color-text-muted)]">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
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
            className="h-1 w-1 rounded-full bg-[var(--color-hairline-strong)]"
          />
          <span className="max-w-[220px] truncate font-mono text-[11px] text-[var(--color-text-muted)]">
            {video.slug || video.id}
          </span>
          <span
            aria-hidden="true"
            className="h-1 w-1 rounded-full bg-[var(--color-hairline-strong)]"
          />
          <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            {sourceLabel(video)}
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="align-baseline font-mono text-[22px] font-semibold leading-none text-[var(--color-text-primary)]">
              {video.dubCount.toLocaleString("en")}
            </span>
            <span className="ml-2 align-baseline text-[12px] text-[var(--color-text-muted)]">
              {page.coverage.languagesDubbed}
            </span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-[var(--color-success)]">
            {percent}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
          <div
            className={cx("h-full rounded-full", tone.progress)}
            style={{ width: coverageWidth(percent) }}
          />
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
          {languages.length > 0 ? (
            languages.map((language) => (
              <span
                key={language.code}
                className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-1.5 py-1 font-mono text-[10px] font-semibold leading-none text-[var(--color-text-secondary)]"
              >
                {language.flagUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={language.flagUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-3 w-4 rounded-[1px] object-cover"
                  />
                ) : null}
                <span>{language.code}</span>
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-text-disabled)]">
              {page.coverage.noLanguages}
            </span>
          )}
          {video.dubOverflowCount > 0 ? (
            <span className="px-1 font-mono text-[11px] text-[var(--color-text-muted)]">
              {overflowLabel(page.coverage.overflow, video.dubOverflowCount)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative z-20 flex items-center justify-between gap-3 lg:flex-col lg:items-end">
        <time
          dateTime={video.updatedAtIso}
          title={video.updated}
          className="text-right"
        >
          <span className="block text-[12px] font-semibold leading-4 text-[var(--color-text-secondary)]">
            {video.updatedRelative}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-text-muted)]">
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-disabled)]"
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.6} />
          </button>
          {video.visitorUrl ? (
            <a
              href={video.visitorUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${page.table.openVisitorLabel}: ${video.title}`}
              title={page.table.openVisitorLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.6} />
            </a>
          ) : (
            <span
              aria-disabled="true"
              aria-label={page.table.noVisitorLinkLabel}
              title={page.table.noVisitorLinkLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-disabled)]"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.6} />
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
  const collection = parseVideoLibraryCollection(params.collection)
  const language = parseVideoLibraryLanguage(params.language)
  const selectedVideo = parseVideoLibrarySelectedVideo(params.video)
  const selectedLocale = parseVideoLibrarySelectedLocale(params.locale)
  const sort = parseVideoLibrarySort(params.sort)
  const paginationState = { category, collection, language, query, sort }
  const closeVideoHref = videoLibraryHref({
    page: requestedPage,
    ...paginationState,
  }) as Route

  if (selectedVideo) {
    const selectedVideoDetail = await loadVideoLibraryDetail(selectedVideo)

    if (selectedVideoDetail) {
      const canEditSearchSocial = canEditVideo(principal)
      const searchSocial = canEditSearchSocial
        ? await loadInitialVideoSearchSocialState({
            user: principal,
            videoId: selectedVideoDetail.key,
            requestedVideoLocaleId: selectedLocale || undefined,
          })
        : {
            initialOptions: [],
            initialLocale: null,
          }

      return (
        <VideoDetailPage
          backHref={closeVideoHref}
          detail={selectedVideoDetail}
          labels={page.detail}
          searchSocialEditor={
            <VideoSearchSocialEditor
              videoId={selectedVideoDetail.key}
              canEdit={canEditSearchSocial}
              initialOptions={searchSocial.initialOptions}
              initialLocale={searchSocial.initialLocale}
              mediaLibrary={{ rootLabel: "Library", folders: [], images: [] }}
              mediaLibraryInitiallyLoaded={false}
            />
          }
        />
      )
    }
  }

  const {
    rows: videoRows,
    pagination,
    languageOptions,
    collectionSummary,
  } = await loadVideoLibraryPage(principal, {
    category,
    collection,
    language,
    page: requestedPage,
    query,
    sort,
  })
  const toolbarStateKey = videoLibraryHref({
    page: 1,
    ...paginationState,
  })
  const hasActiveFilters = hasActiveVideoLibraryFilters({
    category,
    collection,
    language,
    query,
  })
  const rowState = {
    ...paginationState,
    currentPage: pagination.currentPage,
  }
  const clearCollectionHref = videoLibraryHref({
    category,
    language,
    page: 1,
    query,
    sort,
  }) as Route
  const rangeLabel = paginationSummary(
    page.table.pagination.summary,
    pagination,
  )
  const currentPageLabel = pageCountLabel(
    page.table.pagination.page,
    pagination,
  )

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="label-text mb-1">{page.eyebrow}</div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            {page.title}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            {headerDescription(page.description, pagination.total)}
          </p>
        </div>
        <PrimaryButton
          disabled
          aria-disabled="true"
          title={page.actions.primaryUnavailable}
          className="shrink-0 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          {page.actions.primary}
        </PrimaryButton>
      </header>

      <section aria-label={page.table.title}>
        <VideoLibraryToolbar
          key={toolbarStateKey}
          category={category}
          collection={collection}
          language={language}
          languageOptions={languageOptions}
          page={page}
          query={query}
          sort={sort}
        />
      </section>

      {collection ? (
        <section className="flex flex-col gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3 text-[13px] md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="label-text mb-1">{page.collection.title}</div>
            <div className="truncate text-[var(--color-text-primary)]">
              {collectionSummary?.title ?? page.collection.missing}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
              {collectionSummary
                ? page.collection.childCount.replace(
                    "{count}",
                    collectionSummary.childCount.toLocaleString("en"),
                  )
                : collection}
            </div>
          </div>
          <Link
            href={clearCollectionHref}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] px-3 font-mono text-[11px] font-semibold text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            {page.collection.clear}
          </Link>
        </section>
      ) : null}

      <section className="app-card min-w-0 overflow-hidden">
        {videoRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {hasActiveFilters ? page.table.emptySearch : page.table.empty}
          </div>
        ) : (
          videoRows.map((video) => (
            <VideoRow
              key={video.key}
              page={page}
              state={rowState}
              video={video}
            />
          ))
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] px-4 py-3 text-[12px] text-[var(--color-text-muted)] md:flex-row md:items-center md:justify-between">
          <span className="font-mono">{rangeLabel}</span>
          <div className="flex items-center gap-2">
            <PaginationControl
              href={paginationHref(pagination.currentPage - 1, paginationState)}
              disabled={!pagination.hasPrevious}
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              {page.table.pagination.previous}
            </PaginationControl>
            <span className="min-w-[96px] text-center font-mono text-[11px] text-[var(--color-text-muted)]">
              {currentPageLabel}
            </span>
            <PaginationControl
              href={paginationHref(pagination.currentPage + 1, paginationState)}
              disabled={!pagination.hasNext}
            >
              {page.table.pagination.next}
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </PaginationControl>
          </div>
        </div>
      </section>
    </div>
  )
}
