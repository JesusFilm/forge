import { z } from "zod"

import { queryAuthRegistry } from "@/db/client"

const grantRowSchema = z.object({
  id: z.string(),
  appId: z.string(),
  appKey: z.string(),
  appName: z.string(),
  environmentId: z.string(),
  environmentKind: z.enum(["local", "preview", "staging", "production"]),
  subjectType: z.enum(["user", "service"]),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  serviceKey: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected", "revoked"]),
  reason: z.string().nullable(),
  approvedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
  scopes: z.array(z.string()),
})

const legacyAccessSurfaceSchema = z.object({
  key: z.string(),
  appKey: z.string(),
  appName: z.string(),
  surface: z.string(),
  currentOwner: z.string(),
  migrationTarget: z.string(),
  status: z.enum(["inventory", "migrate", "retire"]),
})

export type AppAccessGrant = z.infer<typeof grantRowSchema>
export type LegacyAccessSurface = z.infer<typeof legacyAccessSurfaceSchema>

export type AccessControlSummary = {
  grantCount: number
  approvedGrantCount: number
  pendingGrantCount: number
  legacySurfaceCount: number
}

export const LEGACY_ACCESS_SURFACES = [
  {
    key: "admin-user-roles",
    appKey: "admin",
    appName: "Jesus Film Admin",
    surface: "apps/admin/src/app/dashboard/users/page.tsx",
    currentOwner: "Admin User.role and dashboard role approval",
    migrationTarget: "Auth-owned app grants managed from Developer",
    status: "migrate",
  },
  {
    key: "manager-membership",
    appKey: "manager",
    appName: "Jesus Film Manager",
    surface: "apps/admin/prisma/schema.prisma ManagerMembership",
    currentOwner: "Admin ManagerMembership plus /api/manager/session",
    migrationTarget: "Auth-owned Manager access grants managed from Developer",
    status: "migrate",
  },
  {
    key: "mastra-studio-access",
    appKey: "mastra-studio",
    appName: "Jesus Film Mastra Studio",
    surface: "apps/mastra-gateway/src/app/admin/page.tsx",
    currentOwner: "Mastra Gateway StudioAccess records and /admin UI",
    migrationTarget:
      "Auth-owned Mastra Studio access grants managed from Developer",
    status: "migrate",
  },
] satisfies LegacyAccessSurface[]

export async function listAppAccessGrants({
  appId,
}: {
  appId?: string
} = {}): Promise<AppAccessGrant[]> {
  const rows = await queryAuthRegistry<AppAccessGrant>(
    `
      select
        g.id,
        g.app_id as "appId",
        a.key as "appKey",
        a.display_name as "appName",
        g.environment_id as "environmentId",
        e.kind as "environmentKind",
        g.subject_type as "subjectType",
        u.email as "userEmail",
        u.name as "userName",
        g.service_key as "serviceKey",
        g.status,
        g.reason,
        g.approved_at as "approvedAt",
        g.revoked_at as "revokedAt",
        g.created_at as "createdAt",
        coalesce(array_agg(s.key order by s.key) filter (where s.key is not null), '{}') as scopes
      from app_grant g
      join registered_app a on a.id = g.app_id
      join app_environment e on e.id = g.environment_id
      left join "user" u on u.id = g.user_id
      left join app_grant_scope gs on gs.grant_id = g.id
      left join scope s on s.id = gs.scope_id
      where ($1::text is null or g.app_id = $1)
      group by
        g.id,
        a.key,
        a.display_name,
        e.kind,
        u.email,
        u.name
      order by g.created_at desc
    `,
    [appId ?? null],
  )

  return z.array(grantRowSchema).parse(rows)
}

export function listLegacyAccessSurfaces(): LegacyAccessSurface[] {
  return z.array(legacyAccessSurfaceSchema).parse(LEGACY_ACCESS_SURFACES)
}

export function summarizeAccessControl(
  grants: readonly AppAccessGrant[],
  legacySurfaces: readonly LegacyAccessSurface[] = LEGACY_ACCESS_SURFACES,
): AccessControlSummary {
  return {
    grantCount: grants.length,
    approvedGrantCount: grants.filter((grant) => grant.status === "approved")
      .length,
    pendingGrantCount: grants.filter((grant) => grant.status === "pending")
      .length,
    legacySurfaceCount: legacySurfaces.length,
  }
}

export function grantSubjectLabel(grant: AppAccessGrant) {
  if (grant.subjectType === "service") return grant.serviceKey ?? "service"
  return grant.userEmail ?? grant.userName ?? "user"
}
