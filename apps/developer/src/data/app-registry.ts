import { z } from "zod"

import { queryAuthRegistry } from "@/db/client"

const environmentOrder = {
  local: 0,
  preview: 1,
  staging: 2,
  production: 3,
} as const

const appRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  trustTier: z.enum(["first_party", "partner", "external"]),
  ownerType: z.enum(["jesus_film", "partner", "external"]),
  ownerName: z.string().nullable(),
  status: z.enum(["active", "suspended", "archived"]),
})

const environmentRowSchema = z.object({
  id: z.string(),
  appId: z.string(),
  key: z.string(),
  kind: z.enum(["local", "preview", "staging", "production"]),
  clientId: z.string(),
  redirectUris: z.array(z.string()),
  allowedOrigins: z.array(z.string()),
  defaultScopes: z.array(z.string()),
  status: z.enum(["pending", "approved", "rejected", "revoked"]),
  autoApprove: z.boolean(),
})

type RegistryAppRow = z.infer<typeof appRowSchema>
type RegistryEnvironmentRow = z.infer<typeof environmentRowSchema>

export type RegistryEnvironment = {
  id: string
  key: string
  kind: keyof typeof environmentOrder
  clientId: string
  redirectUris: string[]
  allowedOrigins: string[]
  defaultScopes: string[]
  status: "pending" | "approved" | "rejected" | "revoked"
  autoApprove: boolean
}

export type RegistryApp = {
  id: string
  key: string
  displayName: string
  description: string | null
  trustTier: "first_party" | "partner" | "external"
  ownerType: "jesus_film" | "partner" | "external"
  ownerName: string | null
  status: "active" | "suspended" | "archived"
  environments: RegistryEnvironment[]
}

export type RegistrySummary = {
  appCount: number
  environmentCount: number
  productionCount: number
  pendingReviewCount: number
}

export async function listRegisteredApps(): Promise<RegistryApp[]> {
  const [apps, environments] = await Promise.all([
    queryAuthRegistry<RegistryAppRow>(`
      select
        id,
        key,
        display_name as "displayName",
        description,
        trust_tier as "trustTier",
        owner_type as "ownerType",
        owner_name as "ownerName",
        status
      from registered_app
      order by created_at asc
    `),
    queryAuthRegistry<RegistryEnvironmentRow>(`
      select
        id,
        app_id as "appId",
        key,
        kind,
        client_id as "clientId",
        redirect_uris as "redirectUris",
        allowed_origins as "allowedOrigins",
        default_scopes as "defaultScopes",
        status,
        auto_approve as "autoApprove"
      from app_environment
      order by created_at asc
    `),
  ])

  const parsedApps = z.array(appRowSchema).parse(apps)
  const parsedEnvironments = z.array(environmentRowSchema).parse(environments)
  const environmentsByAppId = new Map<string, RegistryEnvironmentRow[]>()
  for (const environment of parsedEnvironments) {
    environmentsByAppId.set(environment.appId, [
      ...(environmentsByAppId.get(environment.appId) ?? []),
      environment,
    ])
  }

  return parsedApps.map((app) => ({
    id: app.id,
    key: app.key,
    displayName: app.displayName,
    description: app.description,
    trustTier: app.trustTier,
    ownerType: app.ownerType,
    ownerName: app.ownerName,
    status: app.status,
    environments: sortEnvironments(environmentsByAppId.get(app.id) ?? []),
  }))
}

export async function getRegisteredApp(
  id: string,
): Promise<RegistryApp | null> {
  const [app] = z.array(appRowSchema).parse(
    await queryAuthRegistry<RegistryAppRow>(
      `
        select
          id,
          key,
          display_name as "displayName",
          description,
          trust_tier as "trustTier",
          owner_type as "ownerType",
          owner_name as "ownerName",
          status
        from registered_app
        where id = $1
        limit 1
      `,
      [id],
    ),
  )

  if (!app) return null

  const environments = z.array(environmentRowSchema).parse(
    await queryAuthRegistry<RegistryEnvironmentRow>(
      `
        select
          id,
          app_id as "appId",
          key,
          kind,
          client_id as "clientId",
          redirect_uris as "redirectUris",
          allowed_origins as "allowedOrigins",
          default_scopes as "defaultScopes",
          status,
          auto_approve as "autoApprove"
        from app_environment
        where app_id = $1
        order by created_at asc
      `,
      [id],
    ),
  )

  return {
    id: app.id,
    key: app.key,
    displayName: app.displayName,
    description: app.description,
    trustTier: app.trustTier,
    ownerType: app.ownerType,
    ownerName: app.ownerName,
    status: app.status,
    environments: sortEnvironments(environments),
  }
}

export function summarizeRegistry(apps: RegistryApp[]): RegistrySummary {
  const environments = apps.flatMap((app) => app.environments)

  return {
    appCount: apps.length,
    environmentCount: environments.length,
    productionCount: environments.filter(
      (environment) => environment.kind === "production",
    ).length,
    pendingReviewCount: environments.filter(
      (environment) => environment.status === "pending",
    ).length,
  }
}

export function formatEnum(value: string) {
  return value.replaceAll("_", " ")
}

function sortEnvironments(
  environments: Array<RegistryEnvironment | RegistryEnvironmentRow>,
): RegistryEnvironment[] {
  return [...environments].sort((left, right) => {
    return environmentOrder[left.kind] - environmentOrder[right.kind]
  })
}
