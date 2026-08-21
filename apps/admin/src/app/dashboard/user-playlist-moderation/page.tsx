import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireAdminSession } from "@/auth/session"
import {
  DashboardPageHeader,
  PageSection,
  PrimaryButton,
} from "@/components/admin-ui"
import { prisma } from "@/db/client"
import { getUserPlaylistGraphqlRuntime } from "@/graphql/user-playlist-runtime"
import { getAdminMessages } from "@/i18n/server"
import {
  USER_PLAYLIST_REPORT_CATEGORIES,
  type UserPlaylistReportCategory,
} from "@/services/user-playlist-report.service"
import {
  ModerationQueue,
  type ModerationQueueLabels,
  type PlaylistReportGroup,
} from "./moderation-queue"

type ModerationSearchParams = {
  after?: string
  category?: string
}

function validCategory(value: string | undefined) {
  return USER_PLAYLIST_REPORT_CATEGORIES.includes(
    value as UserPlaylistReportCategory,
  )
    ? (value as UserPlaylistReportCategory)
    : undefined
}

function validCursor(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined
}

function groupReports(
  reports: Array<{
    reportId: string
    playlistId: string
    category: UserPlaylistReportCategory
    detailPlainText: string | null
    detailStatus: "AVAILABLE" | "ABSENT" | "EXPIRED" | "UNAVAILABLE"
    createdAt: Date
  }>,
): PlaylistReportGroup[] {
  const groups = new Map<string, PlaylistReportGroup>()
  for (const report of reports) {
    const group = groups.get(report.playlistId) ?? {
      playlistId: report.playlistId,
      reports: [],
    }
    group.reports.push({
      reportId: report.reportId,
      category: report.category,
      detailPlainText: report.detailPlainText,
      detailStatus: report.detailStatus,
      createdAt: report.createdAt.toISOString(),
    })
    groups.set(report.playlistId, group)
  }
  return [...groups.values()]
}

function nextPageHref(
  nextCursor: string,
  category: UserPlaylistReportCategory | undefined,
) {
  const params = new URLSearchParams({ after: nextCursor })
  if (category) params.set("category", category)
  return `/dashboard/user-playlist-moderation?${params.toString()}` as Route
}

export default async function UserPlaylistModerationPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<ModerationSearchParams>
}) {
  const principal = await requireAdminSession()
  if (!hasPermission(principal, "moderate:user-playlists")) {
    redirect("/dashboard")
  }

  const params = await searchParams
  const category = validCategory(params.category)
  const after = validCursor(params.after)
  const messages = await getAdminMessages()
  const page = messages.pages.playlistModeration
  const queue = await getUserPlaylistGraphqlRuntime(prisma)
    .moderation()
    .listReports(
      {
        first: 50,
        ...(after ? { after } : {}),
        ...(category ? { category } : {}),
      },
      principal,
    )
  const groups = groupReports(queue.items)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />

      <PageSection
        title={page.queueTitle}
        meta={page.queueMeta}
        actions={
          <form
            method="get"
            className="flex flex-wrap items-end justify-end gap-2"
          >
            <label>
              <span className="sr-only">{page.filters.category}</span>
              <select
                name="category"
                defaultValue={category ?? ""}
                className="h-8 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-2 text-[12px]"
              >
                <option value="">{page.filters.allCategories}</option>
                {USER_PLAYLIST_REPORT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {page.categories[value]}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton type="submit">{page.filters.apply}</PrimaryButton>
            {category || after ? (
              <Link
                href="/dashboard/user-playlist-moderation"
                className="inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                {page.filters.clear}
              </Link>
            ) : null}
          </form>
        }
      >
        {groups.length === 0 ? (
          <div className="p-6" role="status">
            <h2 className="text-[15px] font-medium">{page.emptyTitle}</h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
              {page.emptyDescription}
            </p>
          </div>
        ) : (
          <ModerationQueue
            groups={groups}
            labels={page.queue as ModerationQueueLabels}
          />
        )}

        {queue.nextCursor ? (
          <div className="border-t border-[var(--color-hairline)] px-4 py-3 text-right">
            <Link
              href={nextPageHref(queue.nextCursor, category)}
              className="inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              {page.nextPage}
            </Link>
          </div>
        ) : null}
      </PageSection>
    </div>
  )
}
