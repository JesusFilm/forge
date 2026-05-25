import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { middleware } from "./middleware"

describe("manager middleware", () => {
  it("redirects unauthenticated dashboard requests to login with returnTo", () => {
    const response = middleware(
      new NextRequest(
        "http://localhost:3002/dashboard/jobs/job-1?languageId=529",
      ),
    )

    expect(response.status).toBe(307)
    const location = response.headers.get("location")
    expect(location).toBe(
      "http://localhost:3002/login?returnTo=%2Fdashboard%2Fjobs%2Fjob-1%3FlanguageId%3D529",
    )
  })

  it("does not redirect public login requests", () => {
    const response = middleware(
      new NextRequest("http://localhost:3002/login?error=forbidden"),
    )

    expect(response.headers.get("location")).toBeNull()
  })
})
