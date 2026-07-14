import { describe, expect, it } from "vitest"

import { sleepUnlessAborted } from "./abortable-sleep"

describe("sleepUnlessAborted", () => {
  it("returns immediately when the request budget aborts during backoff", async () => {
    const controller = new AbortController()
    const pending = sleepUnlessAborted(
      async () => new Promise(() => {}),
      30_000,
      controller.signal,
    )

    controller.abort()

    await expect(pending).resolves.toBe(false)
  })
})
