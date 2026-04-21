import {
  Activity,
  ArrowUpRight,
  History,
  RefreshCcw,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import {
  DashboardPageHeader,
  InsightGrid,
  MetricCard,
  OperatorRail,
  PageSection,
  PrimaryButton,
  QueueList,
  StatusPill,
} from "@/components/admin-ui"
import { loadDashboardOpsData } from "@/app/dashboard/ops-data"
import { getAdminMessages } from "@/i18n/server"

export default async function DashboardPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.dashboard
  const data = await loadDashboardOpsData()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        title={page.title}
        description={page.description}
        action={
          <PrimaryButton>
            <RefreshCcw className="h-4 w-4" strokeWidth={1.5} />
            {page.action}
          </PrimaryButton>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.metrics.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            footer={card.footer}
            accent={card.accent}
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-8">
          <PageSection
            title={page.activitySection.title}
            meta={page.activitySection.meta}
            actions={
              <History className="h-4 w-4 text-[var(--color-text-muted)]" />
            }
          >
            <table className="w-full border-collapse text-left">
              <thead className="hairline-strong-b">
                <tr className="h-10">
                  {page.activitySection.columns.map((column, index) => (
                    <th
                      key={column}
                      className={`label-text px-4 ${index === page.activitySection.columns.length - 1 ? "text-right" : ""}`}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.activity.map((entry) => (
                  <tr
                    key={entry.key}
                    className="hairline-b h-10 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                  >
                    <td className="px-4 text-[13px]">{entry.title}</td>
                    <td className="px-4">
                      <StatusPill tone={entry.statusTone}>
                        {entry.statusLabel}
                      </StatusPill>
                    </td>
                    <td className="px-4 font-mono text-[12px] text-[var(--color-text-secondary)]">
                      {entry.detail}
                    </td>
                    <td className="px-4 text-right font-mono text-[11px] text-[var(--color-text-muted)]">
                      {entry.meta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PageSection>

          <PageSection
            title={page.signalSection.title}
            meta={page.signalSection.meta}
          >
            <div className="p-4">
              <InsightGrid
                items={data.signals.map((item, index) => ({
                  ...item,
                  icon:
                    index === 0
                      ? Activity
                      : index === 1
                        ? Workflow
                        : index === 2
                          ? ShieldCheck
                          : ArrowUpRight,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-4">
          <PageSection
            title={page.syncSection.title}
            meta={page.syncSection.meta}
            actions={
              <Activity className="h-4 w-4 text-[var(--color-text-muted)]" />
            }
          >
            <div className="grid gap-4 p-4">
              {data.syncPanels.map((panel) => (
                <div
                  key={panel.title}
                  className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[13px] font-medium">
                        {panel.title}
                      </div>
                      <div className="mt-1 font-mono text-[18px] font-medium">
                        {panel.lag}
                      </div>
                    </div>
                    <StatusPill tone={panel.stateTone}>
                      {panel.stateLabel}
                    </StatusPill>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="label-text">
                      {page.syncSection.drilldown}
                    </span>
                    <ArrowUpRight
                      className="h-4 w-4 text-[var(--color-text-muted)]"
                      strokeWidth={1.5}
                    />
                  </div>
                </div>
              ))}
            </div>
          </PageSection>

          <OperatorRail
            title={messages.common.operatorNotes}
            meta={messages.common.fieldGuide}
            notes="This landing page is now backed by live admin counts, persisted sync state, and recent activity across content and auth surfaces."
            chips={[
              { label: "Source", value: "LIVE_ADMIN_DB" },
              { label: "Scope", value: "OVERVIEW_OPERATIONS" },
              { label: "Surface", value: "EDITORIAL_CONTROL" },
            ]}
          />

          <PageSection title={page.watchlist.title} meta={page.watchlist.meta}>
            <QueueList
              items={data.watchlist.map((item) => ({
                title: item.title,
                meta: item.meta,
                detail: item.detail,
                status: { label: item.statusLabel, tone: item.statusTone },
              }))}
            />
          </PageSection>
        </div>
      </div>
    </div>
  )
}
