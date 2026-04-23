import { ImageIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { revalidatePath } from "next/cache"
import { DashboardPageHeader, StatusPill } from "@/components/admin-ui"
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
    const isTemplate = formData.get("isTemplate") === "on"

    if (!title || !slug) {
      return { ok: false as const, error: "unknown" as const }
    }

    try {
      await services.experience.create({
        input: {
          title,
          locale,
          slug,
          isTemplate,
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
              routeTemplateLabel: page.modal.routeTemplateLabel,
              routeTemplateHelp: page.modal.routeTemplateHelp,
              cancel: page.modal.cancel,
              submit: page.modal.submit,
              localeHelp: page.modal.localeHelp,
              noPermission: page.modal.noPermission,
              createFailed: page.modal.createFailed,
            }}
          />
        }
      />

      <section aria-label={page.title}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {experienceRows.map((row) => (
            <Link
              key={`${row.key}-${row.locale}`}
              href={
                `/dashboard/experiences/${row.key}?locale=${row.locale}` as Route
              }
              className="group overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              <article>
                <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-surface)]">
                  {row.preview.imageUrl ? (
                    <div
                      className="h-full w-full bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${JSON.stringify(row.preview.imageUrl)})`,
                      }}
                      aria-hidden="true"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[var(--color-surface)]">
                      <ImageIcon
                        className="h-6 w-6 text-[var(--color-text-disabled)]"
                        strokeWidth={1.5}
                      />
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 pt-12">
                    <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 text-white underline-offset-2 group-hover:underline">
                      {row.title}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="mono-meta min-w-0 truncate text-[var(--color-text-muted)]">
                    {row.slug}
                  </div>
                  <StatusPill tone={row.statusTone}>
                    {row.statusLabel}
                  </StatusPill>
                </div>
              </article>
            </Link>
          ))}

          {experienceRows.length === 0 ? (
            <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-6 text-center">
              <div className="text-[14px] font-semibold">
                {page.empty.title}
              </div>
              <div className="mx-auto mt-1 max-w-md text-[13px] leading-6 text-[var(--color-text-muted)]">
                {page.empty.description}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
