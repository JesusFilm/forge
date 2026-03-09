import type { Core } from "@strapi/strapi"

const INTERNAL_TOKEN_NAME = "forge-internal-api-token"
const INTERNAL_TOKEN_DESCRIPTION =
  "Managed by startup from STRAPI_INTERNAL_API_TOKEN"

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
} | null

async function isTokenMatch(
  service: ApiTokenService,
  accessKey: string,
  existingToken: ExistingApiToken,
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
  strapi: Core.Strapi,
  service: ApiTokenService,
  accessKey: string,
): Promise<void> {
  await service.create({
    name: INTERNAL_TOKEN_NAME,
    description: INTERNAL_TOKEN_DESCRIPTION,
    type: "read-only",
    accessKey,
    lifespan: null,
  })
  strapi.log.info("Ensured internal API token exists.")
}

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const accessKey = process.env.STRAPI_INTERNAL_API_TOKEN
    if (!accessKey) return

    const apiTokenService = strapi.admin?.services?.["api-token"] as
      | ApiTokenService
      | undefined

    if (!apiTokenService) {
      strapi.log.warn("Skipping internal API token bootstrap: service missing.")
      return
    }

    const existingToken = (await strapi.db.query("admin::api-token").findOne({
      where: { name: INTERNAL_TOKEN_NAME },
      select: ["id", "type", "accessKey"],
    })) as ExistingApiToken

    if (!existingToken) {
      await createReadOnlyToken(strapi, apiTokenService, accessKey)
      return
    }

    const matches = await isTokenMatch(
      apiTokenService,
      accessKey,
      existingToken,
    )
    const isReadOnly = existingToken.type === "read-only"
    if (matches && isReadOnly) return

    await strapi.db.query("admin::api-token").delete({
      where: { id: existingToken.id },
    })
    await createReadOnlyToken(strapi, apiTokenService, accessKey)
  },

  destroy(/* { strapi }: { strapi: Core.Strapi } */) {},
}
