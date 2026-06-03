import { Languages } from "lucide-react"
import {
  DashboardPageHeader,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { getAdminMessages } from "@/i18n/server"
import { loadLanguagesData } from "@/app/dashboard/ops-data"
import { LanguageDiagnostics } from "@/app/dashboard/languages/language-diagnostics"

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
          <PageSection
            title="Language Diagnostics"
            meta="FULL_REFERENCE_BROWSER"
          >
            <div className="p-4">
              <LanguageDiagnostics
                rows={data.diagnosticRows}
                diagnostics={data.diagnostics}
              />
            </div>
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
          notes="This route surfaces searchable reference-language diagnostics, locale usage, and sync provenance from the admin database."
          chips={[
            { label: "Source", value: "CORE_REFERENCE" },
            { label: "Scope", value: "LANGUAGE_FOUNDATION" },
            { label: "Surface", value: "READ_ONLY_DIAGNOSTICS" },
          ]}
        />
      </div>
    </div>
  )
}
