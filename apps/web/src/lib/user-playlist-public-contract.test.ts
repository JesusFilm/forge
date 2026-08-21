import { describe, expect, it } from "vitest"

import { adaptPublicUserPlaylist } from "./user-playlist-public-contract"

describe("public user playlist safe adapter", () => {
  it("maps only the closed public DTO and preserves authored text as inert strings", () => {
    const hostile = "<img src=x onerror=alert(1)> https://example.test"
    expect(
      adaptPublicUserPlaylist({
        title: hostile,
        description: "Description",
        locale: "es",
        countryCode: "MX",
        reportIntent: "r".repeat(86),
        blocks: [
          { __typename: "UserPlaylistTextBlock", text: hostile },
          {
            __typename: "UserPlaylistMediaCollectionBlock",
            title: "Collection",
            items: [{ videoId: "video_1" }],
          },
          {
            __typename: "UserPlaylistVideoCarouselBlock",
            title: "Carousel",
            items: [{ videoId: "video_2" }],
          },
        ],
        ownerSubject: "must-not-spread",
      }),
    ).toEqual({
      title: hostile,
      description: "Description",
      locale: "es",
      countryCode: "MX",
      reportIntent: "r".repeat(86),
      blocks: [
        { kind: "text", text: hostile },
        {
          kind: "mediaCollection",
          title: "Collection",
          videoIds: ["video_1"],
        },
        {
          kind: "videoCarousel",
          title: "Carousel",
          videoIds: ["video_2"],
        },
      ],
    })
  })

  it.each([
    null,
    {},
    { title: "Missing fields" },
    {
      title: "Playlist",
      description: "",
      locale: "en",
      countryCode: "ca",
      reportIntent: "intent",
      blocks: [],
    },
    {
      title: "Playlist",
      description: "",
      locale: "en",
      countryCode: null,
      reportIntent: "intent",
      blocks: [{ __typename: "UnknownBlock", text: "unsafe" }],
    },
    {
      title: "Playlist",
      description: "",
      locale: "en",
      countryCode: null,
      reportIntent: "intent",
      blocks: [
        {
          __typename: "UserPlaylistMediaCollectionBlock",
          items: [{ videoId: "unsafe/id" }],
        },
      ],
    },
  ])("fails closed for malformed or unknown payload %#", (payload) => {
    expect(adaptPublicUserPlaylist(payload)).toBeNull()
  })
})
