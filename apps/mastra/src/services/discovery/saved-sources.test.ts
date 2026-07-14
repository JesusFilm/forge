import { describe, expect, it, vi } from "vitest"

import {
  classifyYouTubeSource,
  loadSavedSourceValuesResult,
  loadSavedSourceValues,
  mergeUnique,
  normalizeYouTubeSource,
} from "./saved-sources"

const CONFIG = { url: "https://site.test/api/discovery-sources", token: "tok" }

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

describe("classifyYouTubeSource", () => {
  it("classifies playlist ids and list= URLs as playlists", () => {
    expect(classifyYouTubeSource("PLLvlXSEUK-JjDVTtVQlHc")).toBe("playlist")
    expect(classifyYouTubeSource("UUSHgtAeWokyEwsVuvccrS")).toBe("playlist")
    expect(
      classifyYouTubeSource(
        "https://www.youtube.com/playlist?list=PLabc123def",
      ),
    ).toBe("playlist")
  })

  it("classifies channels, @handles, and UC ids as channels", () => {
    expect(classifyYouTubeSource("@graceFilms")).toBe("channel")
    expect(
      classifyYouTubeSource("https://www.youtube.com/channel/UCabcdef"),
    ).toBe("channel")
    expect(classifyYouTubeSource("UCabcdefghijklmnopqrstuv")).toBe("channel")
  })
})

describe("mergeUnique", () => {
  it("appends new values and drops duplicates, preserving order", () => {
    expect(mergeUnique(["a", "b"], ["b", "c", "a", "d"])).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })

  it("enforces the requested cap while preserving earliest values", () => {
    expect(mergeUnique(["a"], ["b", "c", "d"], 3)).toEqual(["a", "b", "c"])
  })
})

describe("normalizeYouTubeSource", () => {
  it("extracts playlist IDs from YouTube playlist URLs", () => {
    expect(
      normalizeYouTubeSource(
        "https://www.youtube.com/playlist?list=PLqbible123",
      ),
    ).toEqual({ kind: "playlist", value: "PLqbible123" })
  })

  it("drops legacy custom-channel URLs rather than sending them as handles", () => {
    expect(
      normalizeYouTubeSource("https://www.youtube.com/c/GraceFilms"),
    ).toBeNull()
  })

  it("drops malformed URL-like values rather than treating them as handles", () => {
    expect(normalizeYouTubeSource("https://")).toBeNull()
    expect(normalizeYouTubeSource("youtube.com/c/GraceFilms")).toBeNull()
  })
})

describe("loadSavedSourceValues", () => {
  it("returns the saved values for a platform", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ sources: [{ value: "@a" }, { value: "@b" }] }),
    )
    const values = await loadSavedSourceValues("instagram", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(values).toEqual(["@a", "@b"])
  })

  it("returns [] when no config (opt-in)", async () => {
    const values = await loadSavedSourceValues("youtube", { config: null })
    expect(values).toEqual([])
  })

  it("returns [] (never throws) when the fetch fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    const values = await loadSavedSourceValues("pinterest", {
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(values).toEqual([])
  })

  it("preserves a failed-load status for callers that need to surface it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    await expect(
      loadSavedSourceValuesResult("pinterest", {
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ values: [], status: "failed" })
  })
})
