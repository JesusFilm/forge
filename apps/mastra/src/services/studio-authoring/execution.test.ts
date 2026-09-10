import { expect, test, vi } from "vitest"
import { serializeStudioInstructions } from "./execution"
test("work failure unlocks and returns the connection", async () => {
  const connection = { query: vi.fn().mockResolvedValue({}), release: vi.fn() }
  await expect(
    serializeStudioInstructions(
      { connect: async () => connection },
      async () => {
        throw new Error("native failure")
      },
    ),
  ).rejects.toThrow("native failure")
  expect(connection.query).toHaveBeenLastCalledWith(
    "SELECT pg_advisory_unlock(457)",
  )
  expect(connection.release).toHaveBeenCalledExactlyOnceWith()
})
test("unlock failure destroys the session rather than returning a possibly held lock", async () => {
  const connection = {
    query: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("unlock failed")),
    release: vi.fn(),
  }
  await expect(
    serializeStudioInstructions(
      { connect: async () => connection },
      async () => "saved",
    ),
  ).rejects.toThrow("unlock failed")
  expect(connection.release).toHaveBeenCalledExactlyOnceWith(true)
})
