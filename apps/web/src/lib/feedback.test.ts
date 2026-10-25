/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import { collectFeedbackDiagnostics } from "./feedback"

describe("collectFeedbackDiagnostics", () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Mobile",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Tablet",
    ],
  ])("identifies iOS before the Mac OS token", (userAgent, device) => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent)

    expect(collectFeedbackDiagnostics()).toMatchObject({
      operatingSystem: "iOS",
      device,
    })
  })
})
