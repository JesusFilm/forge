import { describe, expect, it } from "vitest"
import type {
  WatchHomeCarouselSequenceData,
  WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import {
  decodeWatchHomeCarouselSequence,
  encodeWatchHomeCarouselSequence,
} from "@/lib/watch-home-carousel-sequence-wire"

const THUMB_PREFIX = "https://imagedelivery.net/account-hash/"
const THUMB_SUFFIX = ".mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95"

/** The live /watch pool shape, as `cardToCarouselSlide` builds it. */
function poolVideo(
  index: number,
  overrides: Partial<WatchHomeTvCarouselVideoSlide> = {},
): WatchHomeTvCarouselVideoSlide {
  const id = `1_jf61${String(index).padStart(2, "0")}-0-0`
  const playbackId = `playback${index}AbCdEfGhIjKlMnOpQrStUvWxYz0123`
  return {
    kind: "video",
    id,
    title: `Segment ${index}`,
    label: "Segment",
    href: `/segment-${index}.html`,
    posterUrl: `https://image.mux.com/${playbackId}/thumbnail.webp?time=2&width=1280`,
    thumbnailUrl: `${THUMB_PREFIX}${id}${THUMB_SUFFIX}`,
    imageAlt: `Segment ${index}`,
    src: `https://stream.mux.com/${playbackId}.m3u8`,
    playbackId,
    subtitleVttSrc: `https://api-media-core.jesusfilm.org/${id}/editions/ot/subtitles/${id}_ot_529.vtt`,
    subtitleLanguageBcp47: "en",
    durationSeconds: 120 + index,
    ...overrides,
  }
}

function sequenceOf(
  ...pools: WatchHomeTvCarouselVideoSlide[][]
): WatchHomeCarouselSequenceData {
  return {
    pools: pools.map((videos, index) => ({
      id: `playlist-${index}`,
      collectionIds: [`collection-${index}`],
      videos,
    })),
  }
}

describe("encodeWatchHomeCarouselSequence", () => {
  it("round-trips the live pool shape exactly", () => {
    const sequence = sequenceOf(
      Array.from({ length: 12 }, (_, i) => poolVideo(i)),
      Array.from({ length: 5 }, (_, i) => poolVideo(i + 20)),
    )

    expect(
      decodeWatchHomeCarouselSequence(
        encodeWatchHomeCarouselSequence(sequence),
      ),
    ).toEqual(sequence)
  })

  it("omits every field the client rebuilds, as absent keys rather than undefined", () => {
    const wire = encodeWatchHomeCarouselSequence(
      sequenceOf([poolVideo(1), poolVideo(2)]),
    )

    for (const video of wire.pools[0].videos) {
      // An `undefined` value would still cross the RSC boundary as
      // `"$undefined"`, so the key itself must be gone.
      for (const field of ["src", "posterUrl", "imageAlt", "thumbnailUrl"]) {
        expect(Object.prototype.hasOwnProperty.call(video, field)).toBe(false)
      }
    }
    expect(wire.thumbnailTemplate).toEqual({
      prefix: THUMB_PREFIX,
      suffix: THUMB_SUFFIX,
    })
  })

  it("keeps each value that differs from its derivation, including null and blank", () => {
    const sequence = sequenceOf([
      poolVideo(1),
      poolVideo(2),
      // Non-Mux stream: must not be rebuilt from playbackId.
      poolVideo(3, { src: "https://cdn.example.org/custom.m3u8" }),
      // Present playback id but an authored-only poster.
      poolVideo(4, { posterUrl: "https://images.example.org/poster.jpg" }),
      // No playback id: null stream and a poster from authored artwork.
      poolVideo(5, {
        playbackId: null,
        src: null,
        posterUrl: "https://images.example.org/authored.jpg",
      }),
      // Blank alt is a real shape and is NOT the title.
      poolVideo(6, { imageAlt: "" }),
      // A thumbnail on another path, and a missing one, beside a template.
      poolVideo(7, { thumbnailUrl: "https://images.example.org/other.jpg" }),
      poolVideo(8, { thumbnailUrl: null }),
      // Nothing derivable at all.
      poolVideo(9, {
        playbackId: null,
        src: null,
        posterUrl: null,
        thumbnailUrl: null,
      }),
    ])

    const wire = encodeWatchHomeCarouselSequence(sequence)
    const [, , custom, poster, noPlayback, blankAlt, otherThumb, noThumb] =
      wire.pools[0].videos

    expect(custom.src).toBe("https://cdn.example.org/custom.m3u8")
    expect(poster.posterUrl).toBe("https://images.example.org/poster.jpg")
    expect(noPlayback.posterUrl).toBe("https://images.example.org/authored.jpg")
    expect(blankAlt.imageAlt).toBe("")
    expect(otherThumb.thumbnailUrl).toBe("https://images.example.org/other.jpg")
    expect(noThumb.thumbnailUrl).toBeNull()
    expect(decodeWatchHomeCarouselSequence(wire)).toEqual(sequence)
  })

  it("does not learn a thumbnail template from a single match", () => {
    const sequence = sequenceOf([
      poolVideo(1),
      poolVideo(2, { thumbnailUrl: "https://images.example.org/two.jpg" }),
    ])

    const wire = encodeWatchHomeCarouselSequence(sequence)

    expect(wire.thumbnailTemplate).toBeUndefined()
    expect(wire.pools[0].videos[0].thumbnailUrl).toBe(
      sequence.pools[0].videos[0].thumbnailUrl,
    )
    expect(decodeWatchHomeCarouselSequence(wire)).toEqual(sequence)
  })

  it("survives the RSC JSON boundary unchanged", () => {
    const sequence = sequenceOf(
      Array.from({ length: 6 }, (_, i) => poolVideo(i)),
      [poolVideo(40, { src: "https://cdn.example.org/x.m3u8" })],
    )

    const overTheWire = JSON.parse(
      JSON.stringify(encodeWatchHomeCarouselSequence(sequence)),
    )

    expect(decodeWatchHomeCarouselSequence(overTheWire)).toEqual(sequence)
  })

  it("decodes an un-encoded sequence to an equal value", () => {
    const sequence = sequenceOf([poolVideo(1), poolVideo(2)])

    expect(decodeWatchHomeCarouselSequence(sequence)).toEqual(sequence)
  })

  it("keeps the serialized pools under half their raw size", () => {
    // Payload budget for FGE-202: production's 218-video pools measured
    // 142,569 -> 64,269 bytes. A regression that stops eliding the derived
    // URLs fails this before it reaches the inline HTML.
    const sequence = sequenceOf(
      Array.from({ length: 200 }, (_, i) => poolVideo(i)),
    )

    const raw = JSON.stringify(sequence).length
    const encoded = JSON.stringify(
      encodeWatchHomeCarouselSequence(sequence),
    ).length

    expect(encoded).toBeLessThan(raw * 0.5)
  })
})
