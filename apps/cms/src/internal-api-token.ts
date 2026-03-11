import type { Core } from "@strapi/strapi"

type ExistingApiToken = {
  id: number
  type: string
  accessKey: string | null
}

const INTERNAL_TOKEN_NAME = "forge-internal-api-token"
const PENDING_TOKEN_NAME = "forge-internal-api-token-pending"
const INTERNAL_TOKEN_DESCRIPTION =
  "Managed by startup from STRAPI_INTERNAL_API_TOKEN"
const TOKEN_BOOTSTRAP_LOCK_ID = 703021

async function withTokenBootstrapLock(
  strapi: Core.Strapi,
  run: () => Promise<void>,
): Promise<void> {
  const isPostgres = process.env.DATABASE_CLIENT === "postgres"
  const dbWithRaw = strapi.db as unknown as {
    connection?: {
      client?: {
        acquireConnection?: () => Promise<{
          query?: (sql: string, bindings?: unknown[]) => Promise<unknown>
        }>
        releaseConnection?: (connection: unknown) => Promise<void> | void
      }
      raw?: (sql: string, bindings?: unknown[]) => Promise<unknown>
    }
  }
  const connection = dbWithRaw.connection
  const raw = connection?.raw
  if (!isPostgres || typeof raw !== "function") {
    await run()
    return
  }

  const client = connection?.client
  if (
    !client ||
    typeof client.acquireConnection !== "function" ||
    typeof client.releaseConnection !== "function"
  ) {
    await raw("SELECT pg_advisory_lock(?)", [TOKEN_BOOTSTRAP_LOCK_ID])
    try {
      await run()
    } finally {
      await raw("SELECT pg_advisory_unlock(?)", [TOKEN_BOOTSTRAP_LOCK_ID])
    }
    return
  }

  const session = await client.acquireConnection()
  try {
    if (typeof session.query !== "function") {
      throw new Error("Postgres advisory lock session does not expose query().")
    }
    await session.query("SELECT pg_advisory_lock($1)", [
      TOKEN_BOOTSTRAP_LOCK_ID,
    ])
    await run()
  } finally {
    try {
      if (typeof session.query === "function") {
        await session.query("SELECT pg_advisory_unlock($1)", [
          TOKEN_BOOTSTRAP_LOCK_ID,
        ])
      }
    } finally {
      await client.releaseConnection(session)
    }
  }
}

async function isTokenMatch(
  service: {
    check?: (accessKey: string, hashedAccessKey: string) => Promise<boolean>
    hash?: (accessKey: string) => Promise<string>
  },
  accessKey: string,
  existingToken: ExistingApiToken | null,
): Promise<boolean> {
  if (!existingToken?.accessKey) return false
  if (typeof service.check === "function") {
    return Boolean(await service.check(accessKey, existingToken.accessKey))
  }
  if (typeof service.hash === "function") {
    return (await service.hash(accessKey)) === existingToken.accessKey
  }
  return false
}

async function createReadOnlyToken(
  service: {
    create: (input: {
      name: string
      description: string
      type: "read-only"
      accessKey: string
      lifespan: null
    }) => Promise<unknown>
  },
  accessKey: string,
  name: string,
): Promise<void> {
  await service.create({
    name,
    description: INTERNAL_TOKEN_DESCRIPTION,
    type: "read-only",
    accessKey,
    lifespan: null,
  })
}

export async function ensureInternalApiToken(
  strapi: Core.Strapi,
  accessKey?: string,
): Promise<void> {
  if (!accessKey) return

  // Strapi admin internals are weakly typed; keep casts local (see apps/cms/AGENTS.md).
  const apiTokenService = strapi.admin?.services?.["api-token"] as
    | {
        create: (input: {
          name: string
          description: string
          type: "read-only"
          accessKey: string
          lifespan: null
        }) => Promise<unknown>
        check?: (accessKey: string, hashedAccessKey: string) => Promise<boolean>
        hash?: (accessKey: string) => Promise<string>
      }
    | undefined

  if (!apiTokenService) {
    strapi.log.warn("Skipping internal API token bootstrap: service missing.")
    return
  }

  await withTokenBootstrapLock(strapi, async () => {
    const tokenQuery = strapi.db.query("admin::api-token") as unknown as {
      findOne: (input: {
        where: { name?: string; id?: number }
        select?: Array<"id" | "type" | "accessKey">
      }) => Promise<ExistingApiToken | null>
      delete: (input: { where: { id: number } }) => Promise<unknown>
      update: (input: {
        where: { id: number }
        data: { name: string }
      }) => Promise<unknown>
    }
    const existingToken = await tokenQuery.findOne({
      where: { name: INTERNAL_TOKEN_NAME },
      select: ["id", "type", "accessKey"],
    })

    if (!existingToken) {
      await createReadOnlyToken(apiTokenService, accessKey, INTERNAL_TOKEN_NAME)
      strapi.log.info("Ensured internal API token exists.")
      return
    }

    const matches = await isTokenMatch(
      apiTokenService,
      accessKey,
      existingToken,
    )
    const isReadOnly = existingToken.type === "read-only"
    if (matches && isReadOnly) return

    strapi.log.info(
      `Rotating internal API token id=${existingToken.id} type=${existingToken.type}.`,
    )

    const stalePendingToken = await tokenQuery.findOne({
      where: { name: PENDING_TOKEN_NAME },
      select: ["id"],
    })

    if (stalePendingToken) {
      await tokenQuery.delete({ where: { id: stalePendingToken.id } })
    }

    await createReadOnlyToken(apiTokenService, accessKey, PENDING_TOKEN_NAME)

    const pendingToken = await tokenQuery.findOne({
      where: { name: PENDING_TOKEN_NAME },
      select: ["id"],
    })

    if (!pendingToken) {
      strapi.log.error(
        "Internal API token rotation aborted: pending token verification failed.",
      )
      return
    }

    await tokenQuery.delete({ where: { id: existingToken.id } })
    await tokenQuery.update({
      where: { id: pendingToken.id },
      data: { name: INTERNAL_TOKEN_NAME },
    })

    strapi.log.info("Internal API token rotated successfully.")
  })
}
