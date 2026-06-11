import { resolveWatchRedirect } from "./watchRedirect"

const complete = { loading: false }
const inFlight = { loading: true }

describe("resolveWatchRedirect", () => {
  it("redirects a complete SERIES-labeled record", () => {
    expect(resolveWatchRedirect({ label: "SERIES" }, complete)).toBe("redirect")
  })

  it("redirects a complete COLLECTION-labeled record", () => {
    expect(resolveWatchRedirect({ label: "COLLECTION" }, complete)).toBe(
      "redirect",
    )
  })

  it("stays for a complete leaf label", () => {
    expect(resolveWatchRedirect({ label: "FEATURE_FILM" }, complete)).toBe(
      "stay",
    )
  })

  // Never redirect off partial cache data: cache-first + returnPartialData can
  // surface a record whose label hasn't arrived yet.
  it("is pending while the query is in flight, even with a series label", () => {
    expect(resolveWatchRedirect({ label: "SERIES" }, inFlight)).toBe("pending")
  })

  // Accepted gap (mirrors mobile): detection is label-only at this seam, so an
  // unlabeled-with-children deep link stays on the watch screen.
  it("stays for a complete record with a null label", () => {
    expect(resolveWatchRedirect({ label: null }, complete)).toBe("stay")
  })

  it("is pending with no record", () => {
    expect(resolveWatchRedirect(null, complete)).toBe("pending")
    expect(resolveWatchRedirect(undefined, inFlight)).toBe("pending")
  })
})
