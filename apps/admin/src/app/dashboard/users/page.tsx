import { Check, Shield } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { requireAdminSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import {
  loadUsersData,
  type DashboardStatusTone,
} from "@/app/dashboard/ops-data"
import {
  approveUser,
  updateManagerAccess,
  updateMastraStudioAccess,
} from "@/app/dashboard/users/actions"

type UsersRow = Awaited<ReturnType<typeof loadUsersData>>["rows"][number]
type ProductAccessItem = UsersRow["productAccess"][number]

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
              columns={["Principal", "Status", "Product Access", "Updated"]}
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
                  {row.statusLabel === "VIEWER" ? (
                    <>
                      <form action={approveUser}>
                        <input type="hidden" name="id" value={row.key} />
                        <input type="hidden" name="role" value="EDITOR" />
                        <button
                          type="submit"
                          className="status-pill border-[var(--color-success-border)] text-[var(--color-success)]"
                        >
                          Approve Editor
                        </button>
                      </form>
                      <form action={approveUser}>
                        <input type="hidden" name="id" value={row.key} />
                        <input type="hidden" name="role" value="ADMIN" />
                        <button
                          type="submit"
                          className="status-pill border-[var(--color-warning-border)] text-[var(--color-warning)]"
                        >
                          Approve Admin
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>,
                <div
                  key={`${row.key}-products`}
                  className="flex min-w-[320px] flex-col gap-2"
                >
                  {row.productAccess.map((access) => (
                    <ProductAccessControl
                      key={access.key}
                      access={access}
                      userId={row.key}
                      userTitle={row.title}
                    />
                  ))}
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
          notes="This route reflects persisted admin user roles and product grants mapped from Auth SSO identities. Manager access is explicit and does not inherit from Admin roles."
          chips={[
            { label: "Source", value: "ADMIN_DB" },
            { label: "Model", value: "ROLE_PLUS_ABAC" },
            { label: "Surface", value: "ACCESS_CONTROL" },
          ]}
        />
      </div>
    </div>
  )
}

function ProductAccessControl({
  access,
  userId,
  userTitle,
}: {
  access: ProductAccessItem
  userId: string
  userTitle: string
}) {
  const select = (
    <select
      name="role"
      aria-label={`${access.label} app access role for ${userTitle}`}
      defaultValue={access.selectedRole}
      disabled={access.disabled}
      className={`h-8 min-w-[142px] rounded-sm border bg-[var(--color-surface-raised)] px-2 font-mono text-[11px] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface)] disabled:opacity-60 ${statusToneClass(access.statusTone)}`}
    >
      {access.roleOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )

  const formAction =
    access.key === "manager"
      ? updateManagerAccess
      : access.key === "mastra-studio"
        ? updateMastraStudioAccess
        : null

  if (formAction && access.backed && !access.disabled) {
    return (
      <form
        action={formAction}
        className="grid grid-cols-[86px_minmax(142px,1fr)_32px] items-center gap-2"
      >
        <input type="hidden" name="id" value={userId} />
        <input type="hidden" name="email" value={userTitle} />
        <span className="label-text text-[10px]">{access.label}</span>
        {select}
        <button
          type="submit"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          title={`Apply ${access.label} role`}
          aria-label={`Apply ${access.label} role`}
        >
          <Check className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </form>
    )
  }

  return (
    <div className="grid grid-cols-[86px_minmax(142px,1fr)_70px] items-center gap-2">
      <span className="label-text text-[10px]">{access.label}</span>
      {select}
      <span className="mono-meta text-[10px] text-[var(--color-text-muted)]">
        {access.helperText}
      </span>
    </div>
  )
}

function statusToneClass(tone: DashboardStatusTone) {
  if (tone === "success") {
    return "border-[var(--color-success-border)] text-[var(--color-success)]"
  }
  if (tone === "warning") {
    return "border-[var(--color-warning-border)] text-[var(--color-warning)]"
  }
  if (tone === "danger") {
    return "border-[var(--color-danger-border)] text-[var(--color-danger)]"
  }
  if (tone === "info") {
    return "border-[var(--color-info-border)] text-[var(--color-info)]"
  }
  return "border-[var(--color-hairline-strong)] text-[var(--color-text-muted)]"
}
