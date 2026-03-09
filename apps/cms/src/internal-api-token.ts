import type { Core } from "@strapi/strapi"

type StrapiLike = {
  admin?: {
    services?: Record<string, unknown>
  }
  db: {
    query: (uid: "admin::api-token") => {
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
  }
  log: {
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
}

type ApiTokenService = {
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

type ExistingApiToken = {
  id: number
  type: string
  accessKey: string | null
}

const INTERNAL_TOKEN_NAME = "forge-internal-api-token"
const PENDING_TOKEN_NAME = "forge-internal-api-token-pending"
const INTERNAL_TOKEN_DESCRIPTION =
  "Managed by startup from STRAPI_INTERNAL_API_TOKEN"

async function isTokenMatch(
  service: ApiTokenService,
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
  service: ApiTokenService,
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

  const typedStrapi = strapi as Core.Strapi & StrapiLike
  const apiTokenService = typedStrapi.admin?.services?.["api-token"] as
    | ApiTokenService
    | undefined

  if (!apiTokenService) {
    typedStrapi.log.warn(
      "Skipping internal API token bootstrap: service missing.",
    )
    return
  }

  const tokenQuery = typedStrapi.db.query("admin::api-token")
  const existingToken = await tokenQuery.findOne({
    where: { name: INTERNAL_TOKEN_NAME },
    select: ["id", "type", "accessKey"],
  })

  if (!existingToken) {
    await createReadOnlyToken(apiTokenService, accessKey, INTERNAL_TOKEN_NAME)
    typedStrapi.log.info("Ensured internal API token exists.")
    return
  }

  const matches = await isTokenMatch(apiTokenService, accessKey, existingToken)
  const isReadOnly = existingToken.type === "read-only"
  if (matches && isReadOnly) return

  typedStrapi.log.info(
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
    typedStrapi.log.error(
      "Internal API token rotation aborted: pending token verification failed.",
    )
    return
  }

  await tokenQuery.delete({ where: { id: existingToken.id } })
  await tokenQuery.update({
    where: { id: pendingToken.id },
    data: { name: INTERNAL_TOKEN_NAME },
  })

  typedStrapi.log.info("Internal API token rotated successfully.")
}
