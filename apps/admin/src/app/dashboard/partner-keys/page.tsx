// Partner API keys — read-only dashboard view (Unit 6 of plan 002).
//
// Operator-facing audit trail for partner bearer tokens issued via the
// `pnpm --filter @forge/admin partner-keys` CLI. The list includes
// revoked rows so an operator can see "this key was revoked on date X
// by user Y" without a separate query.
//
// Mutations (create / revoke / rotate) live in the CLI, not in the UI.
// Empty state points at the CLI command.

import {
  DashboardPageHeader,
  DataTable,
  PageSection,
  StatusPill,
} from "@/components/admin-ui"
import { requireAdminSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import {
  listPartnerKeys,
  type PartnerApiKeySummary,
} from "@/services/partner-api-key.service"

type UserMap = Map<string, { id: string; email: string; name: string }>

/**
 * Resolve the union of `createdById` / `revokedById` FK ids on a set
 * of summaries into a single Prisma round-trip. Returns a map keyed by
 * user id; missing ids are simply absent from the map.
 */
async function loadActorMap(
  summaries: readonly PartnerApiKeySummary[],
): Promise<UserMap> {
  const ids = new Set<string>()
  for (const row of summaries) {
    if (row.createdById) ids.add(row.createdById)
    if (row.revokedById) ids.add(row.revokedById)
  }
  if (ids.size === 0) {
    return new Map()
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, email: true, name: true },
  })
  return new Map(users.map((u) => [u.id, u]))
}

function formatDate(value: Date | null, fallback: string): string {
  if (!value) return fallback
  return value.toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

function resolveActor(
  id: string | null,
  actors: UserMap,
  fallback: string,
): string {
  if (!id) return "—"
  const actor = actors.get(id)
  if (!actor) return fallback
  return actor.email
}

export default async function PartnerKeysPage() {
  await requireAdminSession()
  const messages = await getAdminMessages()
  const page = messages.pages.partnerKeys

  // Always include revoked so the dashboard surfaces the full audit
  // trail. The service is already sorted by lastUsedAt DESC NULLS LAST,
  // createdAt DESC so active integrations float to the top.
  const rows = await listPartnerKeys({ includeRevoked: true })
  const actors = await loadActorMap(rows)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />

      {rows.length === 0 ? (
        <PageSection title={page.title} meta="PARTNER_API_KEYS">
          <div className="flex flex-col gap-2 p-6">
            <h2 className="text-[15px] font-medium">{page.emptyTitle}</h2>
            <p className="font-mono text-[12px] text-[var(--color-text-muted)]">
              {page.emptyDescription}
            </p>
          </div>
        </PageSection>
      ) : (
        <PageSection title={page.title} meta="PARTNER_API_KEYS">
          <DataTable
            columns={[
              page.columns.keyId,
              page.columns.name,
              page.columns.owner,
              page.columns.status,
              page.columns.lastUsed,
              page.columns.createdAt,
              page.columns.createdBy,
              page.columns.revokedBy,
            ]}
            rows={rows.map((row) => {
              const isRevoked = row.revokedAt !== null
              return [
                <span
                  key={`${row.id}-keyId`}
                  className="mono-meta text-[var(--color-text-primary)]"
                >
                  {row.keyId}
                </span>,
                <div key={`${row.id}-name`}>
                  <div className="text-[13px] font-medium">{row.name}</div>
                  {row.note ? (
                    <div className="mono-meta text-[var(--color-text-muted)]">
                      {row.note}
                    </div>
                  ) : null}
                </div>,
                <span
                  key={`${row.id}-owner`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {row.ownerEmail}
                </span>,
                <StatusPill
                  key={`${row.id}-status`}
                  tone={isRevoked ? "warning" : "success"}
                >
                  {isRevoked ? page.statusRevoked : page.statusActive}
                </StatusPill>,
                <span
                  key={`${row.id}-lastUsed`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {formatDate(row.lastUsedAt, page.neverUsed)}
                </span>,
                <span
                  key={`${row.id}-createdAt`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {formatDate(row.createdAt, "—")}
                </span>,
                <span
                  key={`${row.id}-createdBy`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {resolveActor(row.createdById, actors, page.unknownUser)}
                </span>,
                <span
                  key={`${row.id}-revokedBy`}
                  className="mono-meta text-[var(--color-text-muted)]"
                >
                  {resolveActor(row.revokedById, actors, page.unknownUser)}
                </span>,
              ]
            })}
          />
        </PageSection>
      )}
    </div>
  )
}
