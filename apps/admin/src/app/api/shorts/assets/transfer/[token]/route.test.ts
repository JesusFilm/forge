import { expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => ({
  upload: vi.fn(async (..._args: unknown[]) => ({ reference: "fixture" })),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/studio-authoring/transfers", () => ({
  StudioTransferService: class {
    upload = fixtures.upload
  },
}))
import { PUT } from "./route"

it("forwards the PUT request cancellation signal alongside its body", async () => {
  const controller = new AbortController()
  const request = new Request("https://fixture.invalid/upload", {
    method: "PUT",
    body: "fixture",
    signal: controller.signal,
  })
  expect(
    (await PUT(request, { params: Promise.resolve({ token: "issued" }) }))
      .status,
  ).toBe(200)
  expect(fixtures.upload).toHaveBeenCalledWith(
    "issued",
    request.body,
    request.signal,
  )
  controller.abort()
  expect(request.signal.aborted).toBe(true)
})
