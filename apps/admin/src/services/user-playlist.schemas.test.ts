import { describe, expect, it } from "vitest"

import {
  CreateUserPlaylistInputSchema,
  USER_PLAYLIST_LIMITS,
  UserPlaylistSnapshotSchema,
} from "./user-playlist.schemas"

const acceptance = {
  termsVersion: "2026-08-21",
  privacyVersion: "2026-08-21",
  communityGuidelinesVersion: "2026-08-21",
}

const textBlock = { t: "text" as const, text: "A plain text introduction." }
const mediaBlock = {
  t: "mediaCollection" as const,
  title: "Watch next",
  items: [{ videoId: "video-1" }, { videoId: "video-2" }],
}
const carouselBlock = {
  t: "videoCarousel" as const,
  title: "Stories",
  items: [{ videoId: "video-3" }],
}

describe("UserPlaylistSnapshotSchema", () => {
  it("round-trips only the closed Text/MediaCollection/VideoCarousel union", () => {
    expect(
      UserPlaylistSnapshotSchema.parse({
        schemaVersion: 1,
        blocks: [textBlock, mediaBlock, carouselBlock],
      }),
    ).toEqual({
      schemaVersion: 1,
      blocks: [textBlock, mediaBlock, carouselBlock],
    })
  })

  it.each([
    [{ t: "cta", buttonLink: "https://example.org" }],
    [{ ...textBlock, html: "<b>unsafe</b>" }],
    [{ ...textBlock, text: "<script>alert(1)</script>" }],
    [{ ...textBlock, text: "[outside](https://example.org)" }],
    [{ ...textBlock, text: "https://example.org" }],
    [
      {
        ...mediaBlock,
        items: [{ videoId: "video-1", streamingUrl: "https://example.org" }],
      },
    ],
    [{ ...carouselBlock, recommendations: true }],
    [{ ...textBlock, text: "bad\ud800unicode" }],
  ])("rejects unsafe or unknown payload %j", (blocks) => {
    expect(() =>
      UserPlaylistSnapshotSchema.parse({ schemaVersion: 1, blocks }),
    ).toThrow()
  })

  it("accepts every exact collection ceiling", () => {
    const block = {
      t: "mediaCollection" as const,
      items: Array.from(
        { length: USER_PLAYLIST_LIMITS.itemsPerBlock },
        (_, index) => ({ videoId: `video-${index}` }),
      ),
    }
    const blocks = [
      ...Array.from({ length: 5 }, () => block),
      ...Array.from(
        { length: USER_PLAYLIST_LIMITS.maxBlocks - 5 },
        () => textBlock,
      ),
    ]
    expect(() =>
      UserPlaylistSnapshotSchema.parse({
        schemaVersion: 1,
        blocks,
      }),
    ).not.toThrow()
  })

  it("rejects limit-plus-one blocks, per-block items, and total items", () => {
    expect(() =>
      UserPlaylistSnapshotSchema.parse({
        schemaVersion: 1,
        blocks: Array.from(
          { length: USER_PLAYLIST_LIMITS.maxBlocks + 1 },
          () => textBlock,
        ),
      }),
    ).toThrow()

    expect(() =>
      UserPlaylistSnapshotSchema.parse({
        schemaVersion: 1,
        blocks: [
          {
            ...mediaBlock,
            items: Array.from(
              { length: USER_PLAYLIST_LIMITS.itemsPerBlock + 1 },
              (_, index) => ({ videoId: `video-${index}` }),
            ),
          },
        ],
      }),
    ).toThrow()

    expect(() =>
      UserPlaylistSnapshotSchema.parse({
        schemaVersion: 1,
        blocks: Array.from({ length: 6 }, (_, blockIndex) => ({
          ...mediaBlock,
          items: Array.from({ length: 100 }, (_, itemIndex) => ({
            videoId: `video-${blockIndex}-${itemIndex}`,
          })),
        })),
      }),
    ).toThrow()
  })
})

describe("CreateUserPlaylistInputSchema", () => {
  it("accepts BCP-47 locale, optional ISO country, and current policy fields", () => {
    expect(
      CreateUserPlaylistInputSchema.parse({
        title: "My playlist",
        description: "A safe description",
        locale: "es-419",
        countryCode: "MX",
        blocks: [textBlock],
        acceptance,
      }),
    ).toMatchObject({ locale: "es-419", countryCode: "MX", acceptance })
  })

  it.each([
    { ownerSubject: "attacker" },
    { capability: "secret" },
    { moderationState: "ACTIVE" },
    { locale: "not_a_locale" },
    { countryCode: "USA" },
    { title: "x".repeat(USER_PLAYLIST_LIMITS.title + 1) },
    { description: "x".repeat(USER_PLAYLIST_LIMITS.description + 1) },
  ])("rejects forbidden, invalid, or oversized create field %j", (extra) => {
    expect(() =>
      CreateUserPlaylistInputSchema.parse({
        title: "My playlist",
        description: "Safe",
        locale: "en",
        blocks: [textBlock],
        acceptance,
        ...extra,
      }),
    ).toThrow()
  })
})
