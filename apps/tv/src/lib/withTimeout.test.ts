import { withTimeout } from "./withTimeout"

describe("withTimeout", () => {
  it("resolves with the promise value when it beats the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok")
  })

  it("rejects when the promise outlasts the deadline", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 100))
    await expect(withTimeout(slow, 10)).rejects.toThrow("Resolution timed out")
  })

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const slow = new Promise((resolve) => setTimeout(resolve, 100))
    await expect(withTimeout(slow, 1000, controller.signal)).rejects.toThrow(
      "Aborted",
    )
  })
})
