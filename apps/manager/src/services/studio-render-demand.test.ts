import { describe, expect, it, vi } from "vitest"
import { createStudioRenderDemandHandler } from "./studio-render-demand"
const key = "d".repeat(64)
const request = (token = key) =>
  new Request("https://manager.test/api/shorts/render-demand", {
    headers: { authorization: `Bearer ${token}` },
  })
const setup = (overrides = {}) => {
  const pending = vi.fn(async () => ["attempt-private-id"])
  return {
    pending,
    handler: createStudioRenderDemandHandler({
      key,
      forbiddenKeys: ["w".repeat(64)],
      poolId: "forge-proxmox",
      workerId: "forge-render-1",
      enabled: () => true,
      pending,
      ...overrides,
    }),
  }
}
describe("read-only render demand", () => {
  it("exposes only fixed identity and boolean demand with no cache", async () => {
    const { handler, pending } = setup()
    const res = await handler(request())
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      version: 1,
      poolId: "forge-proxmox",
      workerId: "forge-render-1",
      profileId: expect.stringContaining("studio-render-4/"),
      enabled: true,
      hasPending: true,
    })
    expect(pending).toHaveBeenCalledOnce()
  })
  it("rejects worker and generic tokens before reading canonical state", async () => {
    const { handler, pending } = setup()
    expect((await handler(request("w".repeat(64)))).status).toBe(401)
    expect((await handler(request("generic-manager-key"))).status).toBe(401)
    expect(pending).not.toHaveBeenCalled()
    expect(
      (await setup({ forbiddenKeys: [key] }).handler(request())).status,
    ).toBe(503)
    expect((await setup({ key: undefined }).handler(request())).status).toBe(
      503,
    )
  })
  it("honors disabled claims without calling Admin", async () => {
    const { handler, pending } = setup({ enabled: () => false })
    expect(await (await handler(request())).json()).toMatchObject({
      enabled: false,
      hasPending: false,
    })
    expect(pending).not.toHaveBeenCalled()
  })
  it("distinguishes an empty queue from malformed or failed queries", async () => {
    expect(
      await (
        await setup({ pending: async () => [] }).handler(request())
      ).json(),
    ).toMatchObject({ hasPending: false })
    for (const value of [null, {}, [1], Array(101).fill("id")])
      expect(
        (await setup({ pending: async () => value }).handler(request())).status,
      ).toBe(503)
    expect(
      (
        await setup({
          pending: async () => {
            throw Error("private backend error")
          },
        }).handler(request())
      ).status,
    ).toBe(503)
  })
  it("bounds timeout and keeps the slot until uncancellable work ends", async () => {
    let finish!: (ids: string[]) => void
    const { handler } = setup({
      timeoutMs: 10,
      pending: () =>
        new Promise<string[]>((resolve) => {
          finish = resolve
        }),
    })
    const res = await handler(request())
    expect(res.status).toBe(503)
    expect((await handler(request())).status).toBe(503)
    finish([])
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
