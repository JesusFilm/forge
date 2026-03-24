import { timingSafeEqual } from "node:crypto"

/**
 * Middleware that validates the x-snapshot-secret header against
 * the DATA_SNAPSHOT_SECRET env var using timing-safe comparison.
 *
 * @see docs/solutions/platform/new-app-ci-and-deployment-patterns.md
 */
export default () => {
  return async (
    ctx: {
      request: { headers: Record<string, string | undefined> }
      status: number
      body: unknown
    },
    next: () => Promise<void>,
  ) => {
    const secret = ctx.request.headers["x-snapshot-secret"]
    const expected = process.env.DATA_SNAPSHOT_SECRET

    if (!expected) {
      ctx.status = 503
      ctx.body = { error: "DATA_SNAPSHOT_SECRET not configured" }
      return
    }

    if (!secret) {
      ctx.status = 401
      ctx.body = { error: "Missing x-snapshot-secret header" }
      return
    }

    const a = Buffer.from(String(secret))
    const b = Buffer.from(expected)

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      ctx.status = 401
      ctx.body = { error: "Invalid secret" }
      return
    }

    await next()
  }
}
