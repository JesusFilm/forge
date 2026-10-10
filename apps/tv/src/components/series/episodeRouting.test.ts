import { decodeWatchSeed } from "../../lib/watchSeed"
import {
  episodeHref,
  resolveEpisodePath,
  type RoutableEpisode,
} from "./episodeRouting"

function episode(overrides: Partial<RoutableEpisode> = {}): RoutableEpisode {
  return {
    slug: "the-birth-of-jesus",
    title: "The Birth of Jesus",
    label: "EPISODE",
    posterUrl: "https://images.example.org/birth.jpg",
    ...overrides,
  }
}

// ── resolveEpisodePath ─────────────────────────────────────────────

describe("resolveEpisodePath", () => {
  it("routes a leaf episode to the watch path with a decodable seed", () => {
    const route = resolveEpisodePath(episode())

    expect(route.pathname).toBe("/watch/[slug]")
    expect(route.params.slug).toBe("the-birth-of-jesus")
    // The seed round-trips through the watch screen's own decoder: title +
    // artwork carry through, playbackId is always null (a rail card knows no
    // playable stream).
    expect(decodeWatchSeed(route.params.seed)).toEqual({
      slug: "the-birth-of-jesus",
      title: "The Birth of Jesus",
      imageUrl: "https://images.example.org/birth.jpg",
      playbackId: null,
    })
  })

  it("routes a COLLECTION-labelled episode to the series path", () => {
    const route = resolveEpisodePath(episode({ label: "COLLECTION" }))
    expect(route.pathname).toBe("/series/[slug]")
  })

  it("routes a SERIES-labelled episode to the series path", () => {
    const route = resolveEpisodePath(episode({ label: "SERIES" }))
    expect(route.pathname).toBe("/series/[slug]")
  })

  it("routes an unlabeled episode to the watch path (label-only detection)", () => {
    // Episode cards carry no childCount, so an unlabeled nested collection
    // falls to /watch and relies on the watch route's series redirect (U5).
    const route = resolveEpisodePath(episode({ label: null }))
    expect(route.pathname).toBe("/watch/[slug]")
  })

  it("still seeds a series-shaped episode (title + artwork paint the hero)", () => {
    const route = resolveEpisodePath(episode({ label: "SERIES" }))
    expect(decodeWatchSeed(route.params.seed)?.title).toBe("The Birth of Jesus")
  })

  it("threads the languageSlug as `lang` when provided", () => {
    const route = resolveEpisodePath(episode(), { languageSlug: "ko-kmr" })
    expect(route.params.lang).toBe("ko-kmr")
  })

  it("omits `lang` when no languageSlug is provided", () => {
    expect(resolveEpisodePath(episode()).params.lang).toBeUndefined()
    expect(
      resolveEpisodePath(episode(), { languageSlug: null }).params.lang,
    ).toBeUndefined()
    expect(
      resolveEpisodePath(episode(), { languageSlug: "" }).params.lang,
    ).toBeUndefined()
  })
})

// ── episodeHref ────────────────────────────────────────────────────

describe("episodeHref", () => {
  it("builds the watch href with the seed appended as-is (no re-encoding)", () => {
    const route = resolveEpisodePath(episode())
    expect(episodeHref(route)).toBe(
      `/watch/the-birth-of-jesus?seed=${route.params.seed}`,
    )
  })

  it("builds the series href for a series-shaped episode", () => {
    const route = resolveEpisodePath(episode({ label: "COLLECTION" }))
    expect(episodeHref(route)).toBe(
      `/series/the-birth-of-jesus?seed=${route.params.seed}`,
    )
  })

  it("URL-encodes the slug path segment", () => {
    const route = resolveEpisodePath(episode({ slug: "magdalena/día 1" }))
    expect(route.params.slug).toBe("magdalena/día 1")
    expect(episodeHref(route)).toBe(
      `/watch/${encodeURIComponent("magdalena/día 1")}?seed=${route.params.seed}`,
    )
  })

  it("appends an encoded `lang` query param when threaded", () => {
    const route = resolveEpisodePath(episode(), { languageSlug: "ko-kmr" })
    expect(episodeHref(route)).toBe(
      `/watch/the-birth-of-jesus?seed=${route.params.seed}&lang=ko-kmr`,
    )
  })

  it("omits `lang` from the href when absent", () => {
    const route = resolveEpisodePath(episode())
    expect(episodeHref(route)).not.toContain("lang=")
  })
})
