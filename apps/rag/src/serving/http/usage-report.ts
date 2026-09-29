import { Hono, type Context } from "hono"
import {
  UsageError,
  validateUsageWindow,
  type UsageReader,
  type UsageWindow,
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
      return await usageReportResponse(c, deps.reader)
    } catch {
      return c.json({ error: "usage_unavailable" }, 503)
    }
  })
  return app
}

// Authentication belongs to each caller; validation and counting semantics are shared.
export async function usageReportResponse(
  c: Context,
  reader: UsageReader,
): Promise<Response> {
  try {
    const window = reportWindow(reportQuery(c))
    const report = await reader.report(window)
    return c.json(report)
  } catch (error) {
    return reportErrorResponse(c, error)
  }
}

function reportQuery(c: Context): Record<string, string> {
  const query = c.req.query()
  if (
    Object.keys(query).some(
      (key) =>
        !["consumer", "from", "to"].includes(key) ||
        c.req.queries(key)?.length !== 1,
    )
  )
    throw new UsageError("invalid_window")
  return query
}
function reportWindow(query: Record<string, string>): UsageWindow {
  if (!query.from?.endsWith("Z") || !query.to?.endsWith("Z"))
    throw new UsageError("invalid_window")
  const window = {
    consumerId: query.consumer ?? "",
    from: new Date(query.from),
    to: new Date(query.to),
  }
  validateUsageWindow(window)
  return window
}

/** Portal comparison pages check admission once, then read at most 20 reports. */
export async function usageReportsResponse(
  c: Context,
  reader: UsageReader,
): Promise<Response> {
  try {
    const query = reportQuery(c)
    const ids = (query.consumer ?? "").split(",")
    if (ids.length > 20 || new Set(ids).size !== ids.length)
      throw new UsageError("invalid_window")
    const windows = ids.map((consumer) => reportWindow({ ...query, consumer }))
    const reports = []
    // Serial reads bound database concurrency; each report keeps its own snapshot.
    for (const window of windows) reports.push(await reader.report(window))
    return c.json({ reports })
  } catch (error) {
    return reportErrorResponse(c, error)
  }
}

function reportErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof UsageError && error.code !== "unavailable")
    return c.json(
      { error: error.code },
      error.code === "unknown_consumer" ? 404 : 400,
    )
  return c.json({ error: "usage_unavailable" }, 503)
}
