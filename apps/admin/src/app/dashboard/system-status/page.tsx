import { AlertTriangle, Database, Link2, RefreshCcw } from "lucide-react"
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
import { getAdminMessages } from "@/i18n/server"

export default async function SystemStatusPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.systemStatus

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <PrimaryButton>
            <RefreshCcw className="h-4 w-4" strokeWidth={1.5} />
            {page.action}
          </PrimaryButton>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        {page.metrics.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            footer={card.footer}
            accent={"accent" in card ? card.accent : undefined}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection title={page.matrix.title} meta={page.matrix.meta}>
            <table className="w-full border-collapse text-left">
              <thead className="hairline-strong-b">
                <tr className="h-10">
                  {page.matrix.columns.map((column) => (
                    <th key={column} className="label-text px-4">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.matrix.rows.map((row) => (
                  <tr
                    key={`${row.entity}-${row.source}`}
                    className="hairline-b h-12 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
                  >
                    <td className="px-4 text-[13px] font-medium">
                      {row.entity}
                    </td>
                    <td className="px-4 font-mono text-[11px] text-[var(--color-text-muted)]">
                      {row.source}
                    </td>
                    <td className="px-4">
                      <StatusPill tone={row.statusTone}>
                        {row.statusLabel}
                      </StatusPill>
                    </td>
                    <td className="px-4 font-mono text-[11px]">{row.lag}</td>
                    <td className="px-4 font-mono text-[11px] text-[var(--color-text-secondary)]">
                      {row.throughput}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PageSection>

          <PageSection title={page.incidents.title} meta={page.incidents.meta}>
            <QueueList
              items={page.incidents.items.map((item) => ({
                title: item.title,
                meta: item.meta,
                detail: item.detail,
                status: { label: item.statusLabel, tone: item.statusTone },
              }))}
            />
          </PageSection>
        </div>

        <div className="flex flex-col gap-6">
          <PageSection title={page.telemetry.title} meta={page.telemetry.meta}>
            <div className="p-4">
              <InsightGrid
                items={page.telemetry.insights.map((item, index) => ({
                  ...item,
                  icon:
                    index === 0
                      ? Link2
                      : index === 1
                        ? RefreshCcw
                        : index === 2
                          ? AlertTriangle
                          : Database,
                }))}
              />
            </div>
          </PageSection>

          <OperatorRail
            title={messages.common.operatorNotes}
            meta={messages.common.fieldGuide}
            notes={page.rail.notes}
            chips={page.rail.chips}
          />
        </div>
      </div>
    </div>
  )
}
