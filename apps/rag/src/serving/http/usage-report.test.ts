import { createHash } from "node:crypto"
import { reportAuthorizer } from "./usage-report-auth.js"
import { expect, it } from "vitest"
import { createUsageReportRoutes } from "./usage-report.js"
it("restricts reports independently of consumer ownership and exposes unavailable coverage", async () => {
  const app = createUsageReportRoutes({
    authorize: reportAuthorizer(
      JSON.stringify({
        jaco: createHash("sha256").update("synthetic-report").digest("hex"),
      }),
    ),
    reader: {
      report: async (w) => ({
        consumerId: w.consumerId,
        label: "synthetic",
        windowStart: w.from.toISOString(),
        windowEnd: w.to.toISOString(),
        requestCount: 0,
        successfulRequestCount: 0,
        lastActivityAt: null,
        generatedAt: new Date().toISOString(),
        completeThrough: null,
        coverageStatus: "unavailable",
      }),
    },
  })
  const url =
    "/?consumer=00000000-0000-4000-8000-000000000528&from=2026-09-29T00:00:00Z&to=2026-09-29T00:01:00Z"
  expect((await app.request(url)).status).toBe(403)
  expect(
    (await app.request(url, { headers: { authorization: "Bearer rag_owner" } }))
      .status,
  ).toBe(403)
  const response = await app.request(url, {
    headers: { authorization: "Bearer synthetic-report" },
  })
  expect(response.status).toBe(503)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toMatchObject({ coverageStatus: "unavailable" })
  expect(
    (
      await app.request(url.replace("00:00:00Z", "00:00:01Z"), {
        headers: { authorization: "Bearer synthetic-report" },
      })
    ).status,
  ).toBe(400)
})
