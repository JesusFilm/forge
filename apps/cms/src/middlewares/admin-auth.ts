import type { Core } from "@strapi/strapi"

/**
 * Middleware that validates the admin session token from the Authorization header.
 *
 * Strapi v5's `admin::isAuthenticatedAdmin` policy does not work on
 * content-API routes because the admin auth context is not loaded for
 * `/api/` requests.  This middleware validates the Bearer token using
 * the session manager (the same mechanism Strapi's own admin strategy uses)
 * so that content-API routes can be protected with admin authentication.
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sessionManager is not in Strapi's public types
      const manager = (strapi as Record<string, any>).sessionManager
      if (!manager) {
        ctx.status = 401
        ctx.body = { error: "Session manager not available" }
        return
      }

      const result = manager("admin").validateAccessToken(token)
      if (!result.isValid) {
        ctx.status = 401
        ctx.body = { error: "Invalid or expired admin token" }
        return
      }

      const isActive = await manager("admin").isSessionActive(
        result.payload.sessionId,
      )
      if (!isActive) {
        ctx.status = 401
        ctx.body = { error: "Admin session expired" }
        return
      }

      const admin = await strapi.db
        .query("admin::user")
        .findOne({ where: { id: result.payload.userId, isActive: true } })

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
