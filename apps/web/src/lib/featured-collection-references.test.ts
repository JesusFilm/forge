import { describe, expect, it } from "vitest"
import { collectFeaturedCollectionReferences } from "./featured-collection-references"

describe("collectFeaturedCollectionReferences", () => {
  it("collects authored collection parents and cards recursively and ignores the dynamic feed", () => {
    expect(
      collectFeaturedCollectionReferences([
        {
          __typename: "MediaCollectionBlock",
          itemsSource: "manual",
          mediaDefaultCollectionSlug: "the-parent-collection",
          items: [
            {
              videoId: "collection-id",
              coreId: "collection-core-id",
              videoSlug: "featured-collection",
            },
          ],
        },
        {
          __typename: "SectionBlock",
          sectionContent: [
            {
              __typename: "VideoCarouselBlock",
              itemsSource: "manual",
              items: [{ coreId: "nested-id", videoSlug: "nested-slug" }],
            },
          ],
        },
        {
          __typename: "MediaCollectionBlock",
          itemsSource: "dynamicCollections",
          items: [{ videoId: "must-not-be-collected" }],
        },
      ]),
    ).toEqual({
      ids: ["collection-id", "nested-id"],
      slugs: ["the-parent-collection"],
    })
  })
})
