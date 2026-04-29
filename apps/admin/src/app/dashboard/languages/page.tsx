import { Languages } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { getAdminMessages } from "@/i18n/server"
import { loadLanguagesData } from "@/app/dashboard/ops-data"

export default async function LanguagesPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.languages
  const data = await loadLanguagesData()

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
          <PageSection title="Reference Languages" meta="CORE_SYNCED_ROWS">
            <DataTable
              columns={["Language", "State", "Updated"]}
              rows={data.rows.map((row) => [
                <div key={`${row.key}-title`}>
                  <div className="text-[13px] font-medium">{row.title}</div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {row.detail}
                  </div>
                </div>,
                <span
                  key={`${row.key}-status`}
                  className="status-pill border-white/15 text-[var(--color-text-muted)]"
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

          <PageSection title="Locale Signals" meta="COVERAGE_HEALTH">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Languages,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This route now surfaces live reference-language and locale usage data from the admin database, making it a real trust-check page for localization foundations."
          chips={[
            { label: "Source", value: "CORE_REFERENCE" },
            { label: "Scope", value: "LANGUAGE_FOUNDATION" },
            { label: "Surface", value: "REFERENCE_DATA" },
          ]}
        />
      </div>
    </div>
  )
}
