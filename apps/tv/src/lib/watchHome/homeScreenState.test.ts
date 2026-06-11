import { resolveHomeScreenState } from "./homeScreenState"

const CARD = { id: "card-1" }
const MODEL = { featured: [CARD], sections: [] }
const ZERO_CARD_MODEL = { featured: [], sections: [] }

describe("resolveHomeScreenState", () => {
  it("is loading while the initial fetch is in flight with no model", () => {
    expect(
      resolveHomeScreenState({ model: null, loading: true, error: null }),
    ).toBe("loading")
  })

  it("errors when the fetch failed and nothing is renderable", () => {
    expect(
      resolveHomeScreenState({
        model: null,
        loading: false,
        error: "Couldn't load videos. Please try again.",
      }),
    ).toBe("error")
  })

  // Regression for the retry window: fetchHome("refresh") clears the error
  // and sets loading synchronously, so the model==null retry must show the
  // spinner — never flash "No content available" mid-round-trip.
  it("shows the spinner (not the empty state) while a retry is in flight", () => {
    expect(
      resolveHomeScreenState({
        model: null,
        loading: true,
        error: "Couldn't load videos. Please try again.",
      }),
    ).toBe("loading")
  })

  it("keeps showing a stale model even when a refetch errored", () => {
    expect(
      resolveHomeScreenState({
        model: MODEL,
        loading: false,
        error: "Couldn't load videos. Please try again.",
      }),
    ).toBe("content")
  })

  it("is empty for a model that resolved zero cards", () => {
    expect(
      resolveHomeScreenState({
        model: ZERO_CARD_MODEL,
        loading: false,
        error: null,
      }),
    ).toBe("empty")
  })

  it("is empty with no model, nothing in flight, and no error", () => {
    expect(
      resolveHomeScreenState({ model: null, loading: false, error: null }),
    ).toBe("empty")
  })
})
