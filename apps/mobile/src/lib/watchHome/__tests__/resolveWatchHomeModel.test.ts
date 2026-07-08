import { buildWatchHomeModelFromVideos } from "../model"
import {
  buildWatchHomeSectionsFromExperience,
  resolveWatchHomeModel,
} from "../experienceAdapter"

const configModel = buildWatchHomeModelFromVideos({ videos: [] })

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
})
