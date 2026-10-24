import { expect, it, vi } from "vitest"
const fixtures = vi.hoisted(() => ({ call: vi.fn(), run: vi.fn() }))
vi.mock("@/config/env", () => ({ env: { STUDIO_MUX_INGEST_ENABLED: "true" } }))
vi.mock("./studio-render-transport", () => ({
  studioRenderClient: () => ({ call: fixtures.call }),
}))
vi.mock("./studio-mux-runner", () => ({ runStudioMuxCandidate: fixtures.run }))
import { dispatchStudioMux } from "./studio-mux-dispatch"
it("isolates a failed candidate and advances a bounded cursor beyond processing work", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    id: `attempt-${i}`,
    createdAt: new Date(i).toISOString(),
  }))
  fixtures.call.mockResolvedValue(rows)
  fixtures.run.mockImplementation(async (id: string) => {
    if (id === "attempt-0") throw new Error("invalid first candidate")
  })
  const cursor = await dispatchStudioMux(new AbortController().signal, null)
  expect(fixtures.run.mock.calls.map((call) => call[0])).toEqual(
    rows.slice(0, 5).map((row) => row.id),
  )
  expect(cursor).toEqual(rows[4])
  fixtures.call.mockResolvedValue(rows.slice(5))
  expect(await dispatchStudioMux(new AbortController().signal, cursor)).toEqual(
    rows[6],
  )
  expect(fixtures.call).toHaveBeenLastCalledWith("mux-pending", rows[4])
  fixtures.call.mockResolvedValue([])
  expect(
    await dispatchStudioMux(new AbortController().signal, rows[6]),
  ).toBeNull()
})
