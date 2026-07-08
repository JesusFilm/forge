import {
  buildWatchHomeModelFromVideos,
  type WatchHomeVideoInput,
} from "../model"
import {
  buildWatchHomeSectionsFromExperience,
  resolveWatchHomeModel,
} from "../experienceAdapter"

const configModel = buildWatchHomeModelFromVideos({ videos: [] })

// A video whose coreId matches a frozen-config section source, so the config
// model actually resolves shelves (not the empty-videos model above). Guards the
// emergency fallback body against bitrot after the config split (R7).
function configVideo(coreId: string): WatchHomeVideoInput {
  return {
    documentId: `doc-${coreId}`,
    coreId,
    slug: `${coreId}-slug`,
    label: "COLLECTION",
    durationSeconds: null,
    images: [
      {
        url: null,
        thumbnail: null,
        mobileCinematicHigh: `https://img.example/${coreId}.jpg`,
        mobileCinematicLow: null,
        videoStill: null,
      },
    ],
    locales: [
      {
        title: `${coreId} title`,
        description: null,
        snippet: null,
        imageAlt: null,
      },
    ],
    children: [],
  }
}

const experienceSections = buildWatchHomeSectionsFromExperience([
  {
    __typename: "MediaCollectionBlock",
    sectionKey: "s",
    title: "T",
    mediaCollectionVariant: "carousel",
    items: [{ videoSlug: "x", titleOverride: "X" }],
  } as { __typename: string } & Record<string, unknown>,
])

describe("resolveWatchHomeModel", () => {
  it("uses the Experience body when ≥1 shelf, keeping the config carousel (AE1, R4)", () => {
    const { model, usedExperience } = resolveWatchHomeModel({
      configModel,
      experienceSections,
    })
    expect(usedExperience).toBe(true)
    expect(model.sections).toBe(experienceSections)
    // The hero carousel is always the config-sourced one, untouched (R4).
    expect(model.carousel).toBe(configModel.carousel)
  })

  it("falls back to the config model when zero shelves (AE6, R6)", () => {
    const { model, usedExperience } = resolveWatchHomeModel({
      configModel,
      experienceSections: [],
    })
    expect(usedExperience).toBe(false)
    expect(model).toBe(configModel)
  })

  it("renders the frozen config shelves on fallback, not an empty body (R7, AE2)", () => {
    const configWithShelves = buildWatchHomeModelFromVideos({
      videos: [configVideo("1_jf-0-0"), configVideo("2_GOJ-0-0")],
    })
    // Precondition: the fixture actually produced config shelves, so the
    // assertion below can't pass vacuously on an empty body.
    expect(configWithShelves.sections.length).toBeGreaterThan(0)

    const { model, usedExperience } = resolveWatchHomeModel({
      configModel: configWithShelves,
      experienceSections: [],
    })
    expect(usedExperience).toBe(false)
    expect(model.sections).toBe(configWithShelves.sections)
    expect(model.sections.length).toBeGreaterThan(0)
  })
})
