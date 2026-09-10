/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { ExperienceSectionRenderer } from "./index"

const config = vi.hoisted(() => ({ WATCH_FOR_YOU_ENABLED: "true" }))
vi.mock("@/env", () => ({ env: config }))
vi.mock("next-intl", () => ({ useLocale: () => "fr" }))
vi.mock("@/components/recommendations/WatchForYouRecommendations", () => ({
  WatchForYouRecommendations: (props: {
    title?: string
    locale: string
    audioLanguageSlug: string
    sectionKey?: string
  }) => (
    <section
      data-locale={props.locale}
      data-language={props.audioLanguageSlug}
      data-section-key={props.sectionKey}
    >
      {props.title}
    </section>
  ),
}))

describe("HomepageRecommendations block dispatch", () => {
  it("renders authored content with independent locale/audio context and obeys the serving flag", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const section = {
      __typename: "HomepageRecommendationsBlock" as const,
      t: "homepageRecommendations",
      sectionKey: "recommended",
      title: "Recommended for You",
    }
    try {
      await act(async () => {
        root.render(
          <ExperienceSectionRenderer section={section} languageSlug="hindi" />,
        )
        await import("./HomepageRecommendations")
      })
      expect(container.textContent).toBe("Recommended for You")
      expect(container.firstElementChild?.getAttribute("data-locale")).toBe(
        "fr",
      )
      expect(container.firstElementChild?.getAttribute("data-language")).toBe(
        "hindi",
      )
      expect(
        container.firstElementChild?.getAttribute("data-section-key"),
      ).toBe("recommended")
      config.WATCH_FOR_YOU_ENABLED = "false"
      await act(async () =>
        root.render(
          <ExperienceSectionRenderer section={section} languageSlug="hindi" />,
        ),
      )
      expect(container.innerHTML).toBe("")
    } finally {
      await act(async () => root.unmount())
      config.WATCH_FOR_YOU_ENABLED = "true"
    }
  })
})
