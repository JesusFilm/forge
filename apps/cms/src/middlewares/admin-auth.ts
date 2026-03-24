import type { Core } from "@strapi/strapi"

/**
 * Middleware that validates the admin JWT from the Authorization header.
 *
 * Strapi v5's `admin::isAuthenticatedAdmin` policy does not work on
 * content-API routes because the admin auth context is not loaded for
 * `/api/` requests.  This middleware manually decodes the Bearer token
 * using the admin JWT service so that content-API routes can be
 * protected with admin authentication.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  return async (
    ctx: {
      request: { headers: Record<string, string | undefined> }
      state: Record<string, unknown>
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

    try {
      const payload = await strapi.admin.services.token.decodeJwtToken(token)
      // Verify the admin user still exists and is active
      const admin = await strapi.db
        .query("admin::user")
        .findOne({ where: { id: payload.id, isActive: true } })

      if (!admin) {
        ctx.status = 401
        ctx.body = { error: "Admin user not found or inactive" }
        return
      }

      ctx.state.admin = admin
    } catch {
      ctx.status = 401
      ctx.body = { error: "Invalid or expired admin token" }
      return
    }

    await next()
  }
}
