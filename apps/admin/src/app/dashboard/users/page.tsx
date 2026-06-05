import { Shield } from "lucide-react"
import { revalidatePath } from "next/cache"
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
import { NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess as grantManagerAccessForUser,
  revokeManagerAccess as revokeManagerAccessForUser,
} from "@/services/user-access.service"

async function approveUser(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  const role = formData.get("role")

  if (typeof id !== "string" || (role !== "EDITOR" && role !== "ADMIN")) {
    return
  }

  await approveUserRole({ user, targetUserId: id, role })
  revalidatePath("/dashboard/users")
}

async function grantManagerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  if (typeof id !== "string") return

  try {
    await grantManagerAccessForUser({ user, targetUserId: id })
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}

async function revokeManagerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  if (typeof id !== "string") return

  try {
    await revokeManagerAccessForUser({ user, targetUserId: id })
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}

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
                  className="flex min-w-[180px] flex-wrap gap-2"
                >
                  {(row.productAccess ?? []).map((access) => (
                    <div
                      key={access.key}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span
                        className={`status-pill ${statusToneClass(access.statusTone)}`}
                      >
                        {access.label}: {access.statusLabel}
                        {access.roleLabel ? ` / ${access.roleLabel}` : ""}
                      </span>
                      {access.key === "manager" ? (
                        access.active ? (
                          <form action={revokeManagerAccess}>
                            <input type="hidden" name="id" value={row.key} />
                            <button
                              type="submit"
                              className="status-pill border-[var(--color-warning-border)] text-[var(--color-warning)]"
                            >
                              Revoke Manager
                            </button>
                          </form>
                        ) : (
                          <form action={grantManagerAccess}>
                            <input type="hidden" name="id" value={row.key} />
                            <button
                              type="submit"
                              className="status-pill border-[var(--color-success-border)] text-[var(--color-success)]"
                            >
                              Enable Manager
                            </button>
                          </form>
                        )
                      ) : null}
                    </div>
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

function statusToneClass(tone: string) {
  if (tone === "success") {
    return "border-[var(--color-success-border)] text-[var(--color-success)]"
  }
  if (tone === "warning") {
    return "border-[var(--color-warning-border)] text-[var(--color-warning)]"
  }
  if (tone === "danger") {
    return "border-[var(--color-danger-border)] text-[var(--color-danger)]"
  }
  return "border-[var(--color-hairline-strong)] text-[var(--color-text-muted)]"
}
