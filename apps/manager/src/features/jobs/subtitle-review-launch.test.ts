import { describe, expect, it, vi } from "vitest"
import {
  closeSubtitleReviewPopup,
  completeSubtitleReviewLaunch,
  openSubtitleReviewPopup,
} from "@/features/jobs/subtitle-review-launch"

function buildPopup() {
  return {
    opener: {},
    location: {
      href: "about:blank",
    },
    close: vi.fn(),
  }
}

describe("subtitle review launch helper", () => {
  it("navigates a pre-opened popup when the popup is available", () => {
    const popup = buildPopup()
    const openWindow = vi.fn(() => popup)
    const currentTab = { assign: vi.fn() }

    const target = openSubtitleReviewPopup(openWindow)
    completeSubtitleReviewLaunch(
      target,
      "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
      currentTab,
    )

    expect(openWindow).toHaveBeenCalledWith("about:blank", "_blank")
    expect(popup.opener).toBeNull()
    expect(popup.location.href).toBe(
      "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
    )
    expect(currentTab.assign).not.toHaveBeenCalled()
  })

  it("uses current-tab navigation when the popup is blocked", () => {
    const openWindow = vi.fn(() => null)
    const currentTab = { assign: vi.fn() }

    const target = openSubtitleReviewPopup(openWindow)
    completeSubtitleReviewLaunch(
      target,
      "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
      currentTab,
    )

    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(openWindow).toHaveBeenCalledWith("about:blank", "_blank")
    expect(openWindow).not.toHaveBeenCalledWith(
      "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
      "_blank",
      "noopener,noreferrer",
    )
    expect(currentTab.assign).toHaveBeenCalledWith(
      "https://subtitles.forge.test/edit?jobId=job-1&launch=abc",
    )
  })

  it("closes the pre-opened popup on launch failure", () => {
    const popup = buildPopup()

    closeSubtitleReviewPopup(popup)

    expect(popup.close).toHaveBeenCalled()
  })
})
