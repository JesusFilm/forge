import { watchPlaybackLinkIntent } from "./watchPlaybackLink"

test("recognizes repeated valid Play requests without storing consumed state", () => {
  const url = "org.jesusfilm.forgetv://watch/jesus?autoplay=1"
  expect(watchPlaybackLinkIntent(url, "jesus")).toBe("play")
  expect(watchPlaybackLinkIntent(url, "jesus")).toBe("play")
})

test("Top Shelf preserves separate Play and More Info actions", () => {
  expect(
    watchPlaybackLinkIntent(
      "org.jesusfilm.forgetv://watch/jesus?topShelf=1&autoplay=1",
      "jesus",
    ),
  ).toBe("play")
  expect(
    watchPlaybackLinkIntent(
      "org.jesusfilm.forgetv://watch/jesus?topShelf=1",
      "jesus",
    ),
  ).toBe("details")
})

test.each([
  "org.jesusfilm.forgetv://watch/jesus",
  "org.jesusfilm.forgetv://watch/jesus?autoplay=0",
  "org.jesusfilm.forgetv://watch/other?autoplay=1",
  "org.jesusfilm.forgetv://search/jesus?autoplay=1",
  "https://watch/jesus?autoplay=1",
  "org.jesusfilm.forgetv://user@watch/jesus?autoplay=1",
  "org.jesusfilm.forgetv://watch:123/jesus?autoplay=1",
  "org.jesusfilm.forgetv://watch/jesus?autoplay=1#other",
  "org.jesusfilm.forgetv://watch/jesus?autoplay=1&autoplay=0",
  "org.jesusfilm.forgetv://watch/jesus?topShelf=1&topShelf=0",
  "not a url",
])("ignores unrelated or ambiguous playback request %s", (url) => {
  expect(watchPlaybackLinkIntent(url, "jesus")).toBeNull()
})
