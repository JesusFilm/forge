import { Shield } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { requireAdminSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadUsersData } from "@/app/dashboard/ops-data"

export default async function UsersPage() {
  await requireAdminSession()
  const messages = await getAdminMessages()
  const page = messages.pages.users
  const data = await loadUsersData()

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
          <PageSection title="User Directory" meta="AUTH_SSO / ROLES">
            <DataTable
              columns={["Principal", "Status", "Updated"]}
              rows={data.rows.map((row) => [
                <div key={`${row.key}-title`}>
                  <div className="text-[13px] font-medium">{row.title}</div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {row.detail}
                  </div>
                </div>,
                <div key={`${row.key}-status`} className="flex flex-wrap gap-2">
                  <span
                    className={`status-pill ${
                      row.statusTone === "success"
                        ? "text-[var(--color-success)] border-[var(--color-success-border)]"
                        : "text-[var(--color-warning)] border-[var(--color-warning-border)]"
                    }`}
                  >
                    {row.statusLabel}
                  </span>
                </div>,
                <span
                  key={`${row.key}-meta`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {row.meta}
                </span>,
              ])}
            />
          </PageSection>

          <PageSection title="Permission Signals" meta="ACCESS_HEALTH">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Shield,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This route is read-only. App access and permission management is moving to Developer instead of being edited inside Admin."
          chips={[
            { label: "Source", value: "ADMIN_DB" },
            { label: "Model", value: "ROLE_PLUS_ABAC" },
            { label: "Surface", value: "READ_ONLY" },
          ]}
        />
      </div>
    </div>
  )
}
