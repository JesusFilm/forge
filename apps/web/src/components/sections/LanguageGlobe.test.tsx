import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getWatchLanguageIndex } from "@/lib/language-index"
import { LanguageGlobe } from "./LanguageGlobe"
import { LanguageGlobeClient } from "./LanguageGlobeClient"

vi.mock("@/lib/language-index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/language-index")>()),
  getWatchLanguageIndex: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

const data = {
  t: "languageGlobe",
  sectionKey: "languages",
  heading: "Find your language",
  description: "Choose a destination",
  backgroundColor: "#071526",
  languageLimit: 12,
} as Parameters<typeof LanguageGlobe>[0]["data"]

describe("LanguageGlobe", () => {
  it("contains metadata failures inside the block", async () => {
    vi.mocked(getWatchLanguageIndex).mockRejectedValueOnce(
      new Error("upstream secret detail"),
    )
    vi.spyOn(console, "error").mockImplementation(() => {})

    const element = (await LanguageGlobe({ data })) as ReactElement<
      Parameters<typeof LanguageGlobeClient>[0]
    >

    expect(element.type).toBe(LanguageGlobeClient)
    expect(element.props).toMatchObject({
      sectionKey: "languages",
      heading: "Find your language",
      description: "Choose a destination",
      languages: [],
      metadataUnavailable: true,
    })
  })

  it("maps catalog labels, routes, and places into client entries", async () => {
    vi.mocked(getWatchLanguageIndex).mockResolvedValueOnce({
      languages: [
        {
          id: "spanish",
          coreId: null,
          nativeLabel: "Español",
          englishLabel: "Spanish",
          publicSlug: "spanish-latin-american",
          href: "/spanish-latin-american.html/videos",
          bcp47: "es-419",
          speakerCount: 10,
          regionNames: ["Latin America"],
          flagPngSrc: null,
        },
      ],
      regions: [],
      globeLocationsByPublicSlug: {
        "spanish-latin-american": [
          {
            countryId: "mexico",
            countryName: "Mexico",
            regionName: "Latin America",
            latitude: 23.6,
            longitude: -102.5,
            speakers: 10,
            primary: true,
            suggested: true,
            order: 0,
          },
        ],
      },
    })

    const element = (await LanguageGlobe({ data })) as ReactElement<
      Parameters<typeof LanguageGlobeClient>[0]
    >

    expect(element.props.metadataUnavailable).toBe(false)
    expect(element.props.languages).toEqual([
      {
        id: "spanish",
        nativeLabel: "Español",
        englishLabel: "Spanish",
        href: "/spanish-latin-american.html/videos",
        latitude: 23.6,
        longitude: -102.5,
      },
    ])
  })
})
