import { Filter, Plus } from "lucide-react"
import {
  DashboardPageHeader,
  InfoStrip,
  InsightGrid,
  OperatorRail,
  PageSection,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { loadVideoRows } from "@/app/dashboard/live-data"
import { getAdminMessages } from "@/i18n/server"

export default async function VideosPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.videos
  const principal = await requireSession()
  const videoRows = await loadVideoRows(principal)

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
          <div className="flex items-center gap-3">
            <SecondaryButton>
              <Filter className="h-4 w-4" strokeWidth={1.5} />
              {page.actions.filter}
            </SecondaryButton>
            <PrimaryButton>
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              {page.actions.primary}
            </PrimaryButton>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection title={page.table.title} meta={page.table.meta}>
            <table className="w-full border-collapse text-left">
              <thead className="hairline-strong-b bg-[var(--color-surface-inset)]">
                <tr>
                  {page.table.columns.map((column) => (
                    <th key={column} className="label-text px-4 py-3">
                      {column}
                    </th>
                  ))}
                  <th className="label-text px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {videoRows.map((video) => (
                  <tr
                    key={video.id}
                    className="hairline-b transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                  >
                    <td className="p-4 align-middle">
                      <div className="flex aspect-video w-[180px] items-end justify-end rounded-sm border border-white/5 bg-[linear-gradient(135deg,#151312,#292524)] p-2">
                        <span className="rounded-[2px] bg-black/50 px-1.5 py-0.5 font-mono text-[9px]">
                          {video.duration}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="text-[13px] font-medium">
                        {video.title}
                      </div>
                      <div className="mono-meta text-[var(--color-text-muted)]">
                        {video.id}
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
                      <button
                        type="button"
                        aria-label={messages.common.quickActions}
                        className="font-mono text-[14px] text-[var(--color-text-disabled)] transition-all duration-[120ms] ease-out hover:text-[var(--color-text-primary)]"
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
