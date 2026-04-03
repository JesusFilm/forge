import type { Core } from "@strapi/strapi"

/**
 * Middleware that validates Bearer tokens against Strapi's API token store.
 *
 * Strapi v5 custom routes with `auth: false` bypass all built-in auth.
 * Removing `auth: false` enables the Users & Permissions plugin, which
 * requires admin-configured role permissions — not API token auth.
 *
 * This middleware bridges the gap: keep `auth: false` to bypass U&P,
 * but validate the Bearer token against Strapi's hashed API token table.
 *
 * Usage in route config:
 *   config: {
 *     auth: false,
 *     middlewares: ["global::api-token-auth"],
 *   }
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  return async (
    ctx: {
      request: { headers: Record<string, string | undefined> }
      status: number
      body: unknown
    },
    next: () => Promise<void>,
  ) => {
    const authorization = ctx.request.headers["authorization"]

    if (!authorization?.startsWith("Bearer ")) {
      ctx.status = 401
      ctx.body = { error: "Missing or invalid Authorization header" }
      return
    }

    const token = authorization.slice(7)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Strapi admin services are not in public types
    const apiTokenService = (strapi.admin as any)?.services?.["api-token"] as
      | {
          hash?: (accessKey: string) => string
          getBy?: (filter: { accessKey: string }) => Promise<{
            id: number
            type: string
            expiresAt: string | null
          } | null>
        }
      | undefined

    if (!apiTokenService?.hash || !apiTokenService?.getBy) {
      ctx.status = 503
      ctx.body = { error: "API token service not available" }
      return
    }

    const hashedToken = apiTokenService.hash(token)
    const apiToken = await apiTokenService.getBy({ accessKey: hashedToken })

    if (!apiToken) {
      ctx.status = 401
      ctx.body = { error: "Invalid API token" }
      return
    }

    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      ctx.status = 401
      ctx.body = { error: "API token expired" }
      return
    }

    await next()
  }
}
