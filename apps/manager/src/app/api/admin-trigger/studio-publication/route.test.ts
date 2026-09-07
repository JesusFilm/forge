import { it, expect, vi } from "vitest"
const mocks = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock("@/config/env", () => ({
  env: { ADMIN_TRIGGER_API_KEYS: "owned-key" },
}))
vi.mock("@/services/studio-publication", () => ({
  prepareScheduledPublication: mocks.prepare,
}))
import { POST } from "./route"
it("requires service bearer and cannot accept interactive cookies as scheduler authority", async () => {
  const result = await POST(
    new Request("https://manager.test/api/admin-trigger/studio-publication", {
      method: "POST",
      headers: { cookie: "session=human" },
      body: "{}",
    }),
  )
  expect(result.status).toBe(401)
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it("reports preparation failures as known not submitted without claiming publication", async () => {
  mocks.prepare.mockRejectedValue(new Error("UNREADY"))
  const r = await POST(
    new Request("https://manager.test/api/admin-trigger/studio-publication", {
      method: "POST",
      headers: { authorization: "Bearer owned-key" },
      body: "{}",
    }),
  )
  expect(r.status).toBe(409)
  expect(await r.json()).toEqual({
    error: "UNREADY",
    submission: "not-submitted",
  })
})
