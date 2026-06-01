import type { ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  ImageIcon,
  Plus,
} from "lucide-react"
import {
  DashboardPageHeader,
  InfoStrip,
  InsightGrid,
  OperatorRail,
  PageSection,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
  cx,
} from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { loadVideoLibraryPage } from "@/app/dashboard/live-data"
import { getAdminMessages } from "@/i18n/server"
import { parseVideoLibraryPage } from "../video-library-utils"

type VideosPageProps = {
  searchParams?: Promise<{
    page?: string | string[]
  }>
}

function paginationHref(page: number): Route {
  return (
    page <= 1 ? "/dashboard/videos" : `/dashboard/videos?page=${page}`
  ) as Route
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

function paginationControlClass(disabled: boolean) {
  return cx(
    "inline-flex h-8 items-center gap-1 rounded-sm border border-[var(--color-hairline)] px-2 font-mono text-[11px] transition-all duration-[120ms] ease-out",
    !disabled && "hover:bg-[var(--color-surface-raised)]",
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

export default async function VideosPage({
  searchParams,
}: VideosPageProps = {}) {
  const messages = await getAdminMessages()
  const page = messages.pages.videos
  const principal = await requireSession()
  const params = (await searchParams) ?? {}
  const requestedPage = parseVideoLibraryPage(params.page)
  const { rows: videoRows, pagination } = await loadVideoLibraryPage(
    principal,
    { page: requestedPage },
  )

  return (
    <div className="flex flex-col gap-6">
      <InfoStrip
        items={page.infoStrip.items}
        trailing={page.infoStrip.trailing}
      />

      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <div className="flex flex-col items-start gap-1 md:items-end">
            <div className="flex items-center gap-3">
              <SecondaryButton
                disabled
                title={page.actions.filterUnavailable}
                aria-describedby="video-actions-unavailable"
              >
                <Filter className="h-4 w-4" strokeWidth={1.5} />
                {page.actions.filter}
              </SecondaryButton>
              <PrimaryButton
                disabled
                title={page.actions.primaryUnavailable}
                aria-describedby="video-actions-unavailable"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                {page.actions.primary}
              </PrimaryButton>
            </div>
            <span
              id="video-actions-unavailable"
              className="font-mono text-[10px] text-[var(--color-text-muted)]"
            >
              {page.actions.filterUnavailable} {page.actions.primaryUnavailable}
            </span>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection title={page.table.title} meta={page.table.meta}>
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full border-collapse text-left">
                <thead className="hairline-strong-b bg-[var(--color-surface-inset)]">
                  <tr>
                    {page.table.columns.map((column) => (
                      <th key={column} className="label-text px-4 py-3">
                        {column}
                      </th>
                    ))}
                    <th className="label-text w-12 px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {videoRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={page.table.columns.length + 1}
                        className="px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]"
                      >
                        {page.table.empty}
                      </td>
                    </tr>
                  ) : (
                    videoRows.map((video) => (
                      <tr
                        key={video.key}
                        className="hairline-b transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                      >
                        <td className="p-4 align-middle">
                          <div className="relative flex aspect-video w-[150px] items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-[linear-gradient(135deg,#151312,#292524)]">
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
                                  className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.55))]"
                                />
                              </>
                            ) : (
                              <ImageIcon
                                className="h-5 w-5 text-[var(--color-text-disabled)]"
                                strokeWidth={1.5}
                              />
                            )}
                            <span className="absolute bottom-2 right-2 rounded-[2px] bg-black/60 px-1.5 py-0.5 font-mono text-[9px]">
                              {video.duration}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex max-w-[280px] flex-col gap-2">
                            <div>
                              <div className="truncate text-[13px] font-medium">
                                {video.title}
                              </div>
                              <div className="mono-meta truncate text-[var(--color-text-muted)]">
                                {video.id}
                              </div>
                            </div>
                            {video.labelLabel ? (
                              <div>
                                <StatusPill tone="muted">
                                  {video.labelLabel}
                                </StatusPill>
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <StatusPill tone={video.sourceTone}>
                            {video.sourceLabel}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                            {video.dubs}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className="mono-meta text-[var(--color-text-muted)]">
                            {video.updated}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {video.visitorUrl ? (
                            <a
                              href={video.visitorUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`${page.table.openVisitorLabel}: ${video.title}`}
                              title={page.table.openVisitorLabel}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
                            >
                              <ExternalLink
                                className="h-4 w-4"
                                strokeWidth={1.5}
                              />
                            </a>
                          ) : (
                            <span
                              aria-disabled="true"
                              aria-label={page.table.noVisitorLinkLabel}
                              title={page.table.noVisitorLinkLabel}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-disabled)]"
                            >
                              <ExternalLink
                                className="h-4 w-4"
                                strokeWidth={1.5}
                              />
                              <span className="sr-only">
                                {page.table.noVisitorLinkLabel}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="hairline-strong-t flex flex-col gap-3 px-4 py-3 text-[12px] text-[var(--color-text-muted)] md:flex-row md:items-center md:justify-between">
              <span className="font-mono">
                {paginationSummary(page.table.pagination.summary, pagination)}
              </span>
              <div className="flex items-center gap-2">
                <PaginationControl
                  href={paginationHref(pagination.currentPage - 1)}
                  disabled={!pagination.hasPrevious}
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {page.table.pagination.previous}
                </PaginationControl>
                <span className="min-w-[96px] text-center font-mono text-[11px]">
                  {pageCountLabel(page.table.pagination.page, pagination)}
                </span>
                <PaginationControl
                  href={paginationHref(pagination.currentPage + 1)}
                  disabled={!pagination.hasNext}
                >
                  {page.table.pagination.next}
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                </PaginationControl>
              </div>
            </div>
          </PageSection>

          <PageSection title={page.signals.title} meta={page.signals.meta}>
            <div className="p-4">
              <InsightGrid
                items={page.signals.insights.map((item, index) => ({
                  ...item,
                  icon: index % 2 === 0 ? Filter : Plus,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes={page.rail.notes}
          chips={page.rail.chips}
        />
      </div>
    </div>
  )
}
