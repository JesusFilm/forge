import { describe, expect, it } from "vitest"

import { GET } from "./route"

describe("developer health route", () => {
  it("returns an ok health response", async () => {
    const response = await GET()
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "developer",
    })
  })
})
