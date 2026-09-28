import { Hono } from "hono"
import {
  UsageError,
  validateUsageWindow,
  type UsageReader,
} from "../../contracts/consumer-usage.js"
import { bearerToken } from "./auth.js"
export type UsageReportDeps = {
  reader: UsageReader
  authorize(secret: string | null): Promise<boolean>
}
export function createUsageReportRoutes(deps: UsageReportDeps): Hono {
  const app = new Hono()
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store")
    await next()
  })
  app.get("/", async (c) => {
    try {
      if (!(await deps.authorize(bearerToken(c.req.header("authorization")))))
        return c.json({ error: "forbidden" }, 403)
      const query = c.req.query()
      if (
        Object.keys(query).some(
          (key) => !["consumer", "from", "to"].includes(key),
        ) ||
        !query.from?.endsWith("Z") ||
        !query.to?.endsWith("Z")
      )
        return c.json({ error: "invalid_window" }, 400)
      const window = {
        consumerId: query.consumer ?? "",
        from: new Date(query.from),
        to: new Date(query.to),
      }
      validateUsageWindow(window)
      const report = await deps.reader.report(window)
      return c.json(report, report.coverageStatus === "unavailable" ? 503 : 200)
    } catch (error) {
      if (error instanceof UsageError && error.code !== "unavailable")
        return c.json(
          { error: error.code },
          error.code === "unknown_consumer" ? 404 : 400,
        )
      return c.json({ error: "usage_unavailable" }, 503)
    }
  })
  return app
}
