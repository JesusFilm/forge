import { describe, expect, it } from "vitest"

import {
  MUX_STREAM_HOST,
  applyMuxMaxResolution,
} from "@/lib/mux-stream-quality"

const MUX_URL = `https://${MUX_STREAM_HOST}/abc123.m3u8`

describe("applyMuxMaxResolution", () => {
  it("adds the cap to a bare Mux manifest URL and nothing else", () => {
    expect(applyMuxMaxResolution(MUX_URL, "480p")).toBe(
      `https://${MUX_STREAM_HOST}/abc123.m3u8?max_resolution=480p`,
    )
  })

  it("replaces an existing max_resolution rather than stacking one", () => {
    const result = applyMuxMaxResolution(
      `${MUX_URL}?max_resolution=1080p`,
      "480p",
    )

    expect(result).toBe(`${MUX_URL}?max_resolution=480p`)
    expect(new URL(result).searchParams.getAll("max_resolution")).toEqual([
      "480p",
    ])
  })

  it("removes a conflicting min_resolution", () => {
    const result = applyMuxMaxResolution(
      `${MUX_URL}?min_resolution=720p`,
      "480p",
    )

    expect(new URL(result).searchParams.get("min_resolution")).toBeNull()
    expect(new URL(result).searchParams.get("max_resolution")).toBe("480p")
  })

  it("preserves unrelated query parameters", () => {
    const result = applyMuxMaxResolution(
      `${MUX_URL}?redundant_streams=true`,
      "480p",
    )

    expect(new URL(result).searchParams.get("redundant_streams")).toBe("true")
    expect(new URL(result).searchParams.get("max_resolution")).toBe("480p")
  })

  // This is the case that keeps the whole existing WatchHomePage fixture set
  // green: those fixtures stream from `stream.example`, not from Mux.
  it("returns a non-Mux host byte-identical", () => {
    const foreign = "https://stream.example/queued-one.m3u8"

    expect(applyMuxMaxResolution(foreign, "480p")).toBe(foreign)
  })

  // The protocol guard, not the host guard: R11 binds the rewrite to https.
  // The apps/mobile sibling deliberately accepts both protocols; this one does
  // not, because the only producer of these URLs is Admin over https.
  it("returns an http Mux URL byte-identical", () => {
    const insecure = `http://${MUX_STREAM_HOST}/abc123.m3u8`

    expect(applyMuxMaxResolution(insecure, "480p")).toBe(insecure)
  })

  it.each([
    ["a javascript: url", "javascript:alert(1)"],
    ["an empty string", ""],
    ["an unparseable string", "not a url at all"],
  ])("returns %s unchanged", (_label, input) => {
    expect(applyMuxMaxResolution(input, "480p")).toBe(input)
  })

  // A signed Mux URL carries its constraints inside the JWT, so appending
  // max_resolution is ignored or rejected server-side. Leave it alone.
  it("returns a tokenized Mux URL byte-identical", () => {
    const signed = `${MUX_URL}?token=header.payload.signature`

    expect(applyMuxMaxResolution(signed, "480p")).toBe(signed)
  })

  it("is idempotent", () => {
    const once = applyMuxMaxResolution(MUX_URL, "480p")

    expect(applyMuxMaxResolution(once, "480p")).toBe(once)
  })

  // R12: the helper reads nothing ambient, so repeated calls in a render loop
  // cannot swap `src` on a mounted media element.
  it("returns an equal string on every call for the same input", () => {
    const results = new Set(
      Array.from({ length: 5 }, () => applyMuxMaxResolution(MUX_URL, "480p")),
    )

    expect(results.size).toBe(1)
  })

  it("can express every rung the caller is allowed to pick", () => {
    expect(applyMuxMaxResolution(MUX_URL, "720p")).toBe(
      `${MUX_URL}?max_resolution=720p`,
    )
  })
})
