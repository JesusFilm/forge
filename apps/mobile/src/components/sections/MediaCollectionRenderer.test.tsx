import { createElement } from "react"

import type {
  MediaCollectionItem,
  MediaCollectionSection,
} from "../../lib/sectionModels"
import { MediaCollectionRenderer } from "./MediaCollectionRenderer"

const sampleItem: MediaCollectionItem = {
  id: "item-1",
  titleOverride: "Easter Special",
  subtitleOverride: "Watch now",
  labelOverride: "Feature Film",
  collectionSize: "6 videos",
  imageUrl: null,
  linkToSectionKey: null,
  imageOverride: {
    url: "https://example.com/thumb.jpg",
    alternativeText: "Thumbnail",
  },
  video: {
    documentId: "v1",
    slug: "easter",
    title: "Easter Video",
    image: null,
  },
}

const baseSection: MediaCollectionSection = {
  kind: "mediaCollection",
  id: "mc-1",
  sectionKey: "videos",
  title: "Featured Videos",
  subtitle: "Curated for Easter",
  description: "Explore our collection of Easter videos.",
  categoryLabel: "EASTER",
  ctaLink: "https://example.com/all",
  showItemNumbers: true,
  footerText: "Updated weekly",
  variant: "carousel",
  items: [
    sampleItem,
    { ...sampleItem, id: "item-2", titleOverride: "Second Item" },
  ],
}

describe("MediaCollectionRenderer", () => {
  it("renders without throwing with all fields (carousel)", () => {
    expect(() =>
      createElement(MediaCollectionRenderer, { section: baseSection }),
    ).not.toThrow()
  })

  it.each(["carousel", "collection", "grid", "hero", "player"] as const)(
    "renders without throwing with variant %s",
    (variant) => {
      expect(() =>
        createElement(MediaCollectionRenderer, {
          section: { ...baseSection, variant },
        }),
      ).not.toThrow()
    },
  )

  it("renders without throwing with empty items", () => {
    expect(() =>
      createElement(MediaCollectionRenderer, {
        section: { ...baseSection, items: [] },
      }),
    ).not.toThrow()
  })

  it("renders without throwing with minimal fields", () => {
    const minimal: MediaCollectionSection = {
      kind: "mediaCollection",
      id: "mc-min",
      sectionKey: null,
      title: null,
      subtitle: null,
      description: null,
      categoryLabel: null,
      ctaLink: null,
      showItemNumbers: null,
      footerText: null,
      variant: "collection",
      items: [
        {
          id: "item-x",
          titleOverride: null,
          subtitleOverride: null,
          labelOverride: null,
          collectionSize: null,
          imageUrl: null,
          linkToSectionKey: null,
          imageOverride: null,
          video: null,
        },
      ],
    }
    expect(() =>
      createElement(MediaCollectionRenderer, { section: minimal }),
    ).not.toThrow()
  })

  it("renders without throwing with showItemNumbers false", () => {
    expect(() =>
      createElement(MediaCollectionRenderer, {
        section: { ...baseSection, showItemNumbers: false },
      }),
    ).not.toThrow()
  })

  it("renders without throwing for carousel with no images", () => {
    const noImageItem: MediaCollectionItem = {
      id: "item-no-img",
      titleOverride: "No Image Video",
      subtitleOverride: null,
      labelOverride: null,
      collectionSize: "3 chapters",
      imageUrl: null,
      linkToSectionKey: null,
      imageOverride: null,
      video: null,
    }
    expect(() =>
      createElement(MediaCollectionRenderer, {
        section: {
          ...baseSection,
          variant: "carousel",
          items: [noImageItem],
        },
      }),
    ).not.toThrow()
  })

  it("renders without throwing for carousel with null categoryLabel", () => {
    expect(() =>
      createElement(MediaCollectionRenderer, {
        section: {
          ...baseSection,
          variant: "carousel",
          categoryLabel: null,
        },
      }),
    ).not.toThrow()
  })
})
