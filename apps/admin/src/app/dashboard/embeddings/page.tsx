import { revalidatePath } from "next/cache"
import { Database, Sparkles } from "lucide-react"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
} from "@/components/admin-ui"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { getAdminMessages } from "@/i18n/server"
import { loadEmbeddingsData } from "@/app/dashboard/ops-data"
import { prisma } from "@/db/client"
import { createServices } from "@/services"

export default async function EmbeddingsPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.embeddings
  const principal = await requireSession()
  const data = await loadEmbeddingsData()
  const canTrigger = hasPermission(principal, "write:experiences")

  async function triggerEmbeddingAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    if (!hasPermission(user, "write:experiences")) {
      return
    }

    const localeId = String(formData.get("localeId") ?? "").trim()
    if (!localeId) {
      return
    }

    const services = createServices(prisma)
    await services.experience.triggerEmbedding({ localeId, user })
    revalidatePath("/dashboard/embeddings")
  }

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
            title="Manual Embedding Trigger"
            meta="LOCALE_ID / SERVER_ACTION / WORKFLOW_DISPATCH"
            actions={
              <Sparkles
                className="h-4 w-4 text-[var(--color-text-muted)]"
                strokeWidth={1.5}
              />
            }
          >
            <form action={triggerEmbeddingAction} className="grid gap-3 p-4">
              <label className="grid gap-2">
                <span className="label-text">Experience locale ID</span>
                <input
                  type="text"
                  name="localeId"
                  placeholder="clocale_..."
                  disabled={!canTrigger || !data.providerReady}
                  className="h-10 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3 font-mono text-[12px] text-[var(--color-text-primary)] outline-none"
                />
              </label>
              <div className="flex items-center justify-between gap-4">
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {data.providerReady
                    ? "Dispatches the existing experience embedding workflow for a specific locale row."
                    : "Embedding provider env is missing, so manual dispatch is currently disabled."}
                </p>
                <button
                  type="submit"
                  disabled={!canTrigger || !data.providerReady}
                  className="inline-flex h-8 items-center gap-2 rounded-sm bg-[var(--color-brand)] px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out hover:bg-[var(--color-brand-pressed)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run Embedding
                </button>
              </div>
            </form>
          </PageSection>

          <PageSection title="Embedding Coverage" meta="RECENT_LOCALE_ROWS">
            <DataTable
              columns={["Locale Row", "State", "Updated"]}
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

          <PageSection title="Vector Signals" meta="RETRIEVAL_READINESS">
            <div className="p-4">
              <InsightGrid
                items={data.insights.map((item) => ({
                  ...item,
                  icon: Database,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes="This surface is now backed by real embedding coverage data and the existing workflow trigger path rather than a decorative placeholder."
          chips={[
            {
              label: "Provider",
              value: data.providerReady ? "CONFIGURED" : "MISSING",
            },
            {
              label: "Trigger",
              value: canTrigger ? "EDITOR_OR_ADMIN" : "READ_ONLY",
            },
            { label: "Surface", value: "VECTOR_OPERATIONS" },
          ]}
        />
      </div>
    </div>
  )
}
