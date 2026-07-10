import { describe, expect, it } from "vitest"

import { transformAlgoliaVideoHits } from "./algolia-video-transform"

describe("transformAlgoliaVideoHits", () => {
  it("maps Algolia video hits into Forge search results", () => {
    expect(
      transformAlgoliaVideoHits({
        preferredLanguage: {
          coreId: "529",
          englishName: "Spanish, Castilian",
          nativeName: "Español",
          bcp47: "es-ES",
          publicSlug: "spanish-castilian",
          regionNames: ["Europe"],
        },
        hits: [
          {
            objectID: "variant-1",
            videoId: "video-1",
            slug: "jesus",
            titles: ["JESUS"],
            titlesWithLanguages: [
              { languageId: "529", value: "Jesús" },
              { languageId: "496", value: "Jesus" },
            ],
            description: ["A feature film about Jesus."],
            duration: 7200,
            label: "featureFilm",
            image: "https://example.com/image.jpg",
            childrenCount: 0,
            languageEnglishName: "Spanish, Castilian",
          },
        ],
      }),
    ).toEqual([
      {
        type: "video",
        id: "video-1",
        slug: "jesus",
        title: "Jesús",
        snippet: "A feature film about Jesus.",
        imageUrl: "https://example.com/image.jpg",
        imageBlurDataUrl: null,
        muxThumbnailBlurDataUrl: null,
        startSeconds: null,
        playbackId: null,
        score: 0,
        label: "FEATURE_FILM",
        durationSeconds: 7200,
        childCount: 0,
        source: "algolia",
        languageSlug: "spanish-castilian",
        languageEnglishName: "Spanish, Castilian",
      },
    ])
  })

  it("falls back to first indexed title and drops malformed hits", () => {
    expect(
      transformAlgoliaVideoHits({
        hits: [
          { objectID: "bad-without-slug", titles: ["Bad"] },
          {
            objectID: "variant-2",
            videoId: "video-2",
            titlesWithLanguages: [{ languageId: "1", value: "First title" }],
            label: "SERIES",
            childrenCount: 12,
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "video-2",
        slug: "video-2",
        title: "First title",
        label: "SERIES",
        childCount: 12,
      }),
    ])
  })

  it("uses the slug as a final title fallback", () => {
    expect(
      transformAlgoliaVideoHits({
        hits: [{ objectID: "variant-3", videoId: "video-3", slug: "acts" }],
      })[0],
    ).toMatchObject({
      id: "video-3",
      slug: "acts",
      title: "acts",
      label: null,
    })
  })

  it("prefers each hit's own public language slug when metadata is available", () => {
    expect(
      transformAlgoliaVideoHits({
        preferredLanguage: {
          coreId: "529",
          englishName: "English",
          nativeName: "English",
          bcp47: "en",
          publicSlug: "english",
          regionNames: ["North America"],
        },
        languageOptions: [
          {
            coreId: "529",
            englishName: "English",
            nativeName: "English",
            bcp47: "en",
            publicSlug: "english",
            regionNames: ["North America"],
          },
          {
            coreId: "21028",
            englishName: "Spanish, Castilian",
            nativeName: "Español",
            bcp47: "es-ES",
            publicSlug: "spanish-castilian",
            regionNames: ["Europe"],
          },
        ],
        hits: [
          {
            objectID: "variant-4",
            videoId: "video-4",
            slug: "jesus",
            languageId: "21028",
            languageEnglishName: "Spanish, Castilian",
          },
        ],
      })[0],
    ).toMatchObject({
      id: "video-4",
      languageSlug: "spanish-castilian",
    })
  })
})
