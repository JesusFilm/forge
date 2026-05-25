import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { z } from "zod"

import { env } from "@/config/env"
import { authRegistryPool, queryAuthRegistry } from "@/db/client"

const developerAdminScope = "developer:admin"
const internalAppKeys = ["admin", "manager", "mastra-studio", "developer"]

const userRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  membershipStatus: z.enum(["active", "disabled", "invited", "suspended"]),
})

const environmentRowSchema = z.object({
  appId: z.string(),
  appKey: z.string(),
  appName: z.string(),
  environmentId: z.string(),
  environmentKey: z.string(),
  kind: z.enum(["local", "preview", "staging", "production"]),
  clientId: z.string(),
  defaultScopes: z.array(z.string()),
})

const grantRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  userName: z.string(),
  appId: z.string(),
  appKey: z.string(),
  appName: z.string(),
  environmentId: z.string(),
  environmentKey: z.string(),
  kind: z.enum(["local", "preview", "staging", "production"]),
  status: z.enum(["approved", "pending", "rejected", "revoked"]),
  reason: z.string().nullable(),
  scopes: z.array(z.string()),
  updatedAt: z.date(),
})

type UserRow = z.infer<typeof userRowSchema>
type EnvironmentRow = z.infer<typeof environmentRowSchema>
type GrantRow = z.infer<typeof grantRowSchema>

export type AccessUser = UserRow
export type AccessEnvironment = EnvironmentRow
export type AccessGrant = GrantRow

export type AccessRegistry = {
  users: AccessUser[]
  environments: AccessEnvironment[]
  grants: AccessGrant[]
}

export async function canManageInternalAccess(userId: string) {
  const [grant] = await queryAuthRegistry<{ id: string }>(
    `
      select g.id
      from app_grant g
      join registered_app a on a.id = g.app_id
      join app_environment e on e.id = g.environment_id
      join app_grant_scope gs on gs.grant_id = g.id
      join scope s on s.id = gs.scope_id
      where a.key = 'developer'
        and e.client_id = $1
        and g.subject_type = 'user'
        and g.user_id = $2
        and g.status = 'approved'
        and s.key = $3
      limit 1
    `,
    [env.AUTH_DEVELOPER_CLIENT_ID, userId, developerAdminScope],
  )

  return Boolean(grant)
}

export async function getAccessRegistry(): Promise<AccessRegistry> {
  const [users, environments, grants] = await Promise.all([
    queryAuthRegistry<UserRow>(`
      select id, name, email, membership_status as "membershipStatus"
      from "user"
      order by email asc
    `),
    queryAuthRegistry<EnvironmentRow>(
      `
        select
          a.id as "appId",
          a.key as "appKey",
          a.display_name as "appName",
          e.id as "environmentId",
          e.key as "environmentKey",
          e.kind,
          e.client_id as "clientId",
          e.default_scopes as "defaultScopes"
        from registered_app a
        join app_environment e on e.app_id = a.id
        where a.key = any($1)
        order by a.display_name asc, e.created_at asc
      `,
      [internalAppKeys],
    ),
    queryAuthRegistry<GrantRow>(
      `
        select
          g.id,
          g.user_id as "userId",
          u.email as "userEmail",
          u.name as "userName",
          a.id as "appId",
          a.key as "appKey",
          a.display_name as "appName",
          e.id as "environmentId",
          e.key as "environmentKey",
          e.kind,
          g.status,
          g.reason,
          coalesce(array_agg(s.key order by s.key) filter (where s.key is not null), '{}') as scopes,
          g.updated_at as "updatedAt"
        from app_grant g
        join "user" u on u.id = g.user_id
        join registered_app a on a.id = g.app_id
        join app_environment e on e.id = g.environment_id
        left join app_grant_scope gs on gs.grant_id = g.id
        left join scope s on s.id = gs.scope_id
        where g.subject_type = 'user'
          and a.key = any($1)
        group by g.id, u.email, u.name, a.id, a.key, a.display_name, e.id, e.key, e.kind
        order by g.updated_at desc
      `,
      [internalAppKeys],
    ),
  ])

  return {
    users: z.array(userRowSchema).parse(users),
    environments: z.array(environmentRowSchema).parse(environments),
    grants: z.array(grantRowSchema).parse(grants),
  }
}

export async function approveInternalAccessGrant(input: {
  actorUserId: string
  environmentId: string
  reason: string
  scopes: string[]
  userId: string
}) {
  const scopes = normalizeGrantScopes(input.scopes)
  if (scopes.length === 0) {
    throw new Error("Choose at least one scope to grant.")
  }

  const client = await authRegistryPool.connect()
  try {
    await client.query("begin")

    const environment = await getInternalEnvironmentForUpdate(
      client,
      input.environmentId,
    )
    assertScopesAllowedForEnvironment(environment, scopes)

    const existingGrant = await client.query<{ id: string }>(
      `
        select id
        from app_grant
        where environment_id = $1
          and user_id = $2
          and subject_type = 'user'
        order by created_at asc
        limit 1
      `,
      [input.environmentId, input.userId],
    )

    const grantId = existingGrant.rows[0]?.id ?? randomUUID()
    if (existingGrant.rows[0]) {
      await client.query(
        `
          update app_grant
          set
            app_id = $1,
            status = 'approved',
            approved_at = now(),
            revoked_at = null,
            reason = $2,
            updated_at = now()
          where id = $3
        `,
        [environment.appId, input.reason, grantId],
      )
    } else {
      await client.query(
        `
          insert into app_grant (
            id,
            app_id,
            environment_id,
            subject_type,
            user_id,
            status,
            approved_at,
            reason,
            created_at,
            updated_at
          )
          values ($1, $2, $3, 'user', $4, 'approved', now(), $5, now(), now())
        `,
        [
          grantId,
          environment.appId,
          input.environmentId,
          input.userId,
          input.reason,
        ],
      )
    }

    await client.query("delete from app_grant_scope where grant_id = $1", [
      grantId,
    ])
    for (const scope of scopes) {
      await client.query(
        `
          insert into app_grant_scope (id, grant_id, scope_id, created_at)
          select $1, $2, id, now()
          from scope
          where key = $3
        `,
        [randomUUID(), grantId, scope],
      )
    }

    await client.query(
      `
        insert into auth_audit_event (
          id,
          event_type,
          severity,
          actor_user_id,
          app_id,
          metadata,
          created_at
        )
        values (
          $1,
          'developer.internal_access.approved',
          'info',
          $2,
          $3,
          $4::jsonb,
          now()
        )
      `,
      [
        randomUUID(),
        input.actorUserId,
        environment.appId,
        JSON.stringify({
          environmentId: input.environmentId,
          grantId,
          scopes,
          userId: input.userId,
        }),
      ],
    )

    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export async function revokeInternalAccessGrant(input: {
  actorUserId: string
  grantId: string
  reason: string
}) {
  const client = await authRegistryPool.connect()
  try {
    await client.query("begin")

    const grant = await client.query<{
      appId: string
      appKey: string
      clientId: string
      scopes: string[]
      userId: string
    }>(
      `
        select
          g.app_id as "appId",
          g.user_id as "userId",
          a.key as "appKey",
          e.client_id as "clientId",
          coalesce(array_agg(s.key order by s.key) filter (where s.key is not null), '{}') as scopes
        from app_grant g
        join registered_app a on a.id = g.app_id
        join app_environment e on e.id = g.environment_id
        left join app_grant_scope gs on gs.grant_id = g.id
        left join scope s on s.id = gs.scope_id
        where g.id = $1
          and g.subject_type = 'user'
          and a.key = any($2)
        group by g.id, a.key, e.client_id
        limit 1
      `,
      [input.grantId, internalAppKeys],
    )
    const targetGrant = grant.rows[0]
    const appId = targetGrant?.appId
    if (!appId) {
      throw new Error("Grant not found.")
    }
    if (
      targetGrant.userId === input.actorUserId &&
      targetGrant.appKey === "developer" &&
      targetGrant.clientId === env.AUTH_DEVELOPER_CLIENT_ID &&
      targetGrant.scopes.includes(developerAdminScope)
    ) {
      throw new Error("You cannot revoke your current Developer admin grant.")
    }

    await client.query(
      `
        update app_grant
        set
          status = 'revoked',
          revoked_at = now(),
          reason = $1,
          updated_at = now()
        where id = $2
      `,
      [input.reason, input.grantId],
    )

    await client.query(
      `
        insert into auth_audit_event (
          id,
          event_type,
          severity,
          actor_user_id,
          app_id,
          metadata,
          created_at
        )
        values (
          $1,
          'developer.internal_access.revoked',
          'warning',
          $2,
          $3,
          $4::jsonb,
          now()
        )
      `,
      [
        randomUUID(),
        input.actorUserId,
        appId,
        JSON.stringify({
          grantId: input.grantId,
          reason: input.reason,
        }),
      ],
    )

    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

export function editableScopesForEnvironment(environment: AccessEnvironment) {
  const scopes = environment.defaultScopes.filter((scope) =>
    scope.endsWith(":access"),
  )

  if (environment.appKey === "developer") {
    scopes.push(developerAdminScope)
  }

  return [...new Set(scopes)].sort()
}

export function formatEnum(value: string) {
  return value.replaceAll("_", " ")
}

function normalizeGrantScopes(scopes: string[]) {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]
}

async function getInternalEnvironmentForUpdate(
  client: PoolClient,
  environmentId: string,
) {
  const environment = await client.query<EnvironmentRow>(
    `
      select
        a.id as "appId",
        a.key as "appKey",
        a.display_name as "appName",
        e.id as "environmentId",
        e.key as "environmentKey",
        e.kind,
        e.client_id as "clientId",
        e.default_scopes as "defaultScopes"
      from app_environment e
      join registered_app a on a.id = e.app_id
      where e.id = $1
        and a.key = any($2)
      limit 1
    `,
    [environmentId, internalAppKeys],
  )

  const [parsed] = z.array(environmentRowSchema).parse(environment.rows)
  if (!parsed) {
    throw new Error("Environment not found.")
  }
  return parsed
}

function assertScopesAllowedForEnvironment(
  environment: AccessEnvironment,
  scopes: string[],
) {
  const allowedScopes = new Set(editableScopesForEnvironment(environment))
  const disallowedScopes = scopes.filter((scope) => !allowedScopes.has(scope))
  if (disallowedScopes.length > 0) {
    throw new Error(`Scope not allowed: ${disallowedScopes.join(", ")}`)
  }
}
