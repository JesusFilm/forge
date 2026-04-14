import { Image } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { getAdminMessages } from "@/i18n/server"
import { loadMediaData } from "@/app/dashboard/ops-data"

export default async function MediaPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.media
  const data = await loadMediaData()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {data.metrics.map((card) => (
          <div key={card.label} className="app-card flex flex-col gap-2 p-4">
            <span className="label-text">{card.label}</span>
            <span className="font-mono text-xl font-medium">{card.value}</span>
            <span className="font-mono text-[10px] uppercase text-[var(--color-text-muted)]">
              {card.footer}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection
            title="Recent Media Rows"
            meta="IMAGES / DOWNLOADS / SUBTITLES"
          >
            <DataTable
              columns={["Asset", "State", "Updated"]}
              rows={data.rows.map((row) => [
                <div key={`${row.key}-title`}>
                  <div className="text-[13px] font-medium">{row.title}</div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {row.detail}
                  </div>
                </div>,
                <span
                  key={`${row.key}-status`}
                  className={`status-pill ${
                    row.statusTone === "success"
                      ? "text-[var(--color-success)] border-[var(--color-success-border)]"
                      : "text-[var(--color-warning)] border-[var(--color-warning-border)]"
                  }`}
                >
                  {row.statusLabel}
                </span>,
                <span
                  key={`${row.key}-meta`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {row.meta}
                </span>,
              ])}
            />
          </PageSection>

          <PageSection title="Asset Signals" meta="LIBRARY_POSTURE">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Image,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This route now inspects persisted media-adjacent rows in the admin database rather than pointing at a future asset library concept."
          chips={[
            { label: "Source", value: "VIDEO_MEDIA_ROWS" },
            { label: "Mode", value: "READ_ONLY_CATALOG" },
            { label: "Surface", value: "MEDIA_OPERATIONS" },
          ]}
        />
      </div>
    </div>
  )
}
