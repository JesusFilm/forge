import { topShelfAutoplayDecision, topShelfPlaybackReady } from "./playback"

it("does not play a previous route's media after a warm deep link", () => {
  expect(
    topShelfPlaybackReady({
      requestedSlug: "jesus",
      videoSlug: "magdalena",
      preferredLanguage: "english",
      activeLanguage: "english",
    }),
  ).toBe(false)
})

it("waits for preferred-dub resolution during a cold start, then allows playback", () => {
  const loadedVideo = {
    requestedSlug: "chosen-witness",
    videoSlug: "chosen-witness",
    preferredLanguage: "english",
    playableLanguages: ["arabic", "english"],
  }
  expect(
    topShelfAutoplayDecision({ ...loadedVideo, activeLanguage: "arabic" }),
  ).toBe("wait")
  expect(
    topShelfAutoplayDecision({ ...loadedVideo, activeLanguage: "english" }),
  ).toBe("ready")
})

it("falls back to details only when the requested dub is actually unavailable", () => {
  expect(
    topShelfAutoplayDecision({
      requestedSlug: "chosen-witness",
      videoSlug: "chosen-witness",
      preferredLanguage: "thai",
      activeLanguage: "english",
      playableLanguages: ["english"],
    }),
  ).toBe("unavailable")
})

it("keeps waiting while the previous video's session is being replaced", () => {
  expect(
    topShelfAutoplayDecision({
      requestedSlug: "chosen-witness",
      videoSlug: "jesus",
      preferredLanguage: "english",
      activeLanguage: "english",
      playableLanguages: ["english"],
    }),
  ).toBe("wait")
})
it("rejects silent fallback to another dub", () => {
  expect(
    topShelfPlaybackReady({
      requestedSlug: "jesus",
      videoSlug: "jesus",
      preferredLanguage: "thai",
      activeLanguage: "english",
    }),
  ).toBe(false)
  expect(
    topShelfPlaybackReady({
      requestedSlug: "jesus",
      videoSlug: "jesus",
      preferredLanguage: "thai",
      activeLanguage: "thai",
    }),
  ).toBe(true)
})
