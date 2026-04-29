import { Settings } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { requireAdminSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadSettingsData } from "@/app/dashboard/ops-data"

export default async function SettingsPage() {
  await requireAdminSession()
  const messages = await getAdminMessages()
  const page = messages.pages.settings
  const data = await loadSettingsData()

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
            title="Runtime Configuration"
            meta="ENV_BACKED_GUARDRAILS"
          >
            <DataTable
              columns={["Setting", "State", "Context"]}
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
                      : row.statusTone === "danger"
                        ? "text-[var(--color-danger)] border-[var(--color-danger-border)]"
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

          <PageSection title="Configuration Signals" meta="OPS_POSTURE">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Settings,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This route is now tied to the validated env posture of the admin app, so operators can confirm auth, sync, storage, and workflow readiness directly from the running branch."
          chips={[
            { label: "Source", value: "VALIDATED_ENV" },
            { label: "Mode", value: "READ_ONLY_POSTURE" },
            { label: "Surface", value: "RUNTIME_SETTINGS" },
          ]}
        />
      </div>
    </div>
  )
}
