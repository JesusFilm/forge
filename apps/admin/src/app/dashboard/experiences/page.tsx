import { Filter, Layers3 } from "lucide-react"
import { revalidatePath } from "next/cache"
import {
  DashboardPageHeader,
  DataTable,
  InsightGrid,
  OperatorRail,
  PageSection,
  StatusPill,
} from "@/components/admin-ui"
import { ExperiencesActions } from "@/app/dashboard/experiences/experiences-actions"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { loadExperienceRows } from "@/app/dashboard/live-data"
import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import { createServices } from "@/services"
import { ForbiddenError } from "@/services/errors"

export default async function ExperiencesPage() {
  const messages = await getAdminMessages()
  const page = messages.pages.experiences
  const principal = await requireSession()
  const canCreate = hasPermission(principal, "write:experiences")
  const experienceRows = await loadExperienceRows(principal)

  async function createExperienceAction(formData: FormData) {
    "use server"

    const user = await requireSession()
    if (!hasPermission(user, "write:experiences")) {
      return { ok: false as const, error: "forbidden" as const }
    }

    const services = createServices(prisma)
    const title = String(formData.get("title") ?? "").trim()
    const locale = String(formData.get("locale") ?? "").trim() || "en"
    const slug = String(formData.get("slug") ?? "").trim()

    if (!title || !slug) {
      return { ok: false as const, error: "unknown" as const }
    }

    try {
      await services.experience.create({
        input: {
          title,
          locale,
          slug,
          isTemplate: false,
          blocks: [],
        },
        user,
      })
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return { ok: false as const, error: "forbidden" as const }
      }
      return { ok: false as const, error: "unknown" as const }
    }

    revalidatePath("/dashboard/experiences")
    return { ok: true as const }
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <ExperiencesActions
            canCreate={canCreate}
            createAction={createExperienceAction}
            labels={{
              filter: page.actions.filter,
              primary: page.actions.primary,
              modalTitle: page.modal.title,
              modalDescription: page.modal.description,
              titleLabel: page.modal.titleLabel,
              localeLabel: page.modal.localeLabel,
              slugLabel: page.modal.slugLabel,
              cancel: page.modal.cancel,
              submit: page.modal.submit,
              localeHelp: page.modal.localeHelp,
              noPermission: page.modal.noPermission,
              createFailed: page.modal.createFailed,
            }}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <div className="flex flex-col gap-6">
          <PageSection
            title={page.table.title}
            meta={page.table.meta}
            actions={
              <Layers3 className="h-4 w-4 text-[var(--color-text-muted)]" />
            }
          >
            <DataTable
              columns={page.table.columns}
              selectedRow={experienceRows.length > 0 ? 0 : undefined}
              rows={experienceRows.map((row) => [
                <div key={`${row.slug}-title`}>
                  <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {row.title}
                  </div>
                  <div className="mono-meta text-[var(--color-text-muted)]">
                    {row.slug}
                  </div>
                </div>,
                <span key={`${row.slug}-owner`} className="text-[13px]">
                  {row.owner}
                </span>,
                <StatusPill key={`${row.slug}-status`} tone={row.statusTone}>
                  {row.statusLabel}
                </StatusPill>,
                <div
                  key={`${row.slug}-embedding`}
                  className="flex items-center gap-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                  <span className="mono-meta text-[var(--color-text-secondary)]">
                    {row.embedding}
                  </span>
                </div>,
                <span
                  key={`${row.slug}-updated`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {row.updated}
                </span>,
              ])}
            />
          </PageSection>

          <PageSection title={page.signals.title} meta={page.signals.meta}>
            <div className="p-4">
              <InsightGrid
                items={page.signals.insights.map((item, index) => ({
                  ...item,
                  icon: index % 2 === 0 ? Layers3 : Filter,
                }))}
              />
            </div>
          </PageSection>
        </div>

        <OperatorRail
          title={messages.common.operatorNotes}
          meta={messages.common.fieldGuide}
          notes={page.rail.notes}
          chips={page.rail.chips}
        />
      </div>
    </div>
  )
}
