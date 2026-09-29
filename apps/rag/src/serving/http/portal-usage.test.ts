import { expect, it } from "vitest"
import { createPortal } from "./portal.js"
import { fixture } from "./portal-fixture.test-support.js"

it("lets every admitted portal user read any consumer report using their session and rechecks admission", async () => {
  const f = fixture()
  const app = createPortal({
    ...f.deps,
    usageReader: {
      report: async (w) => ({
        consumerId: w.consumerId,
        label: "Another consumer",
        windowStart: w.from.toISOString(),
        windowEnd: w.to.toISOString(),
        requestCount: 5,
        successfulRequestCount: 3,
        lastActivityAt: null,
        generatedAt: "2026-09-29T01:00:00Z",
        completeThrough: w.to.toISOString(),
        coverageStatus: "complete",
      }),
    },
  })
  const url =
    "/usage?consumer=00000000-0000-4000-8000-000000000528&from=2026-09-29T00:00:00Z&to=2026-09-29T00:01:00Z"
  expect((await app.request(url)).status).toBe(401)
  expect(
    (await app.request(url, { headers: { Authorization: "Bearer rag_owner" } }))
      .status,
  ).toBe(401)
  const login = await f.start()
  const callback = await f.callback(login.state, login.browser)
  const session = callback.headers
    .get("set-cookie")!
    .match(/__Host-rag_portal=[^;]+/)![0]
  const headers = { Cookie: session }
  const response = await app.request(url, { headers })
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toMatchObject({
    label: "Another consumer",
    requestCount: 5,
    successfulRequestCount: 3,
  })
  expect(
    (await app.request(url.replace("00:00:00Z", "00:00:01Z"), { headers }))
      .status,
  ).toBe(400)
  f.setAllowed(false)
  expect((await app.request(url, { headers })).status).toBe(401)
  f.setAllowed(true)
  f.setEligible(false)
  expect((await app.request(url, { headers })).status).toBe(401)
  f.setEligible(true)
  f.setAvailable(false)
  expect((await app.request(url, { headers })).status).toBe(503)
  f.setAvailable(true)
  await f.deps.sessions.revokeSession(session.split("=")[1])
  expect((await app.request(url, { headers })).status).toBe(401)
})
