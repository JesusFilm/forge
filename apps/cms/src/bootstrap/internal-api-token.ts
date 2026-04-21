import type { Core } from "@strapi/strapi"

type ExistingApiToken = {
  id: number
  type: string
  accessKey: string | null
}

const INTERNAL_TOKEN_NAME = "forge-internal-api-token"
const INTERNAL_TOKEN_DESCRIPTION =
  "Managed by startup from STRAPI_INTERNAL_API_TOKEN"
const EMBEDDING_OVERRIDE_TOKEN_NAME = "forge-embedding-override-api-token"
const EMBEDDING_OVERRIDE_TOKEN_DESCRIPTION =
  "Managed by startup from STRAPI_EMBEDDING_OVERRIDE_TOKEN"
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
    hash?: (accessKey: string) => string | Promise<string>
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

async function createInternalToken(
  strapi: Core.Strapi,
  hashFn: (key: string) => string,
  accessKey: string,
  name: string,
  description: string,
): Promise<void> {
  const encryptionService = strapi.admin?.services?.["encryption"] as
    | { encrypt: (value: string) => string }
    | undefined
  const hashedKey = hashFn(accessKey)
  const encryptedKey = encryptionService?.encrypt(accessKey)

  await (
    strapi.db.query("admin::api-token") as unknown as {
      create: (input: { data: Record<string, unknown> }) => Promise<unknown>
    }
  ).create({
    data: {
      name,
      description,
      type: "full-access",
      accessKey: hashedKey,
      ...(encryptedKey != null && { encryptedKey }),
      lifespan: null,
      expiresAt: null,
    },
  })
}

type ManagedTokenConfig = {
  accessKey?: string
  name: string
  description: string
}

async function ensureManagedApiToken(
  strapi: Core.Strapi,
  { accessKey, name, description }: ManagedTokenConfig,
): Promise<void> {
  if (!accessKey) return

  // Strapi admin internals are weakly typed; keep casts local (see apps/cms/AGENTS.md).
  const apiTokenService = strapi.admin?.services?.["api-token"] as
    | {
        hash?: (accessKey: string) => string
        check?: (accessKey: string, hashedAccessKey: string) => Promise<boolean>
      }
    | undefined

  if (!apiTokenService?.hash) {
    strapi.log.warn(
      "Skipping internal API token bootstrap: service or hash function missing.",
    )
    return
  }

  const hashFn = apiTokenService.hash
  const pendingName = `${name}-pending`

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
      where: { name },
      select: ["id", "type", "accessKey"],
    })

    if (!existingToken) {
      await createInternalToken(strapi, hashFn, accessKey, name, description)
      strapi.log.info(`Ensured managed API token exists: ${name}.`)
      return
    }

    const matches = await isTokenMatch(
      apiTokenService,
      accessKey,
      existingToken,
    )
    const isFullAccess = existingToken.type === "full-access"
    if (matches && isFullAccess) return

    strapi.log.info(
      `Rotating managed API token ${name} id=${existingToken.id} type=${existingToken.type}.`,
    )

    const stalePendingToken = await tokenQuery.findOne({
      where: { name: pendingName },
      select: ["id"],
    })

    if (stalePendingToken) {
      await tokenQuery.delete({ where: { id: stalePendingToken.id } })
    }

    await createInternalToken(
      strapi,
      hashFn,
      accessKey,
      pendingName,
      description,
    )

    const pendingToken = await tokenQuery.findOne({
      where: { name: pendingName },
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
      data: { name },
    })

    strapi.log.info(`Managed API token rotated successfully: ${name}.`)
  })
}

export async function ensureInternalApiToken(
  strapi: Core.Strapi,
  accessKey?: string,
): Promise<void> {
  await ensureManagedApiToken(strapi, {
    accessKey,
    name: INTERNAL_TOKEN_NAME,
    description: INTERNAL_TOKEN_DESCRIPTION,
  })
}

export async function ensureEmbeddingApiTokens(
  strapi: Core.Strapi,
  input: {
    overrideAccessKey?: string
  },
): Promise<void> {
  await ensureManagedApiToken(strapi, {
    accessKey: input.overrideAccessKey,
    name: EMBEDDING_OVERRIDE_TOKEN_NAME,
    description: EMBEDDING_OVERRIDE_TOKEN_DESCRIPTION,
  })
}
