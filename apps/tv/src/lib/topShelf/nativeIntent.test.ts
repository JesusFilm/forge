import { Linking, Platform } from "react-native"
import { redirectSystemPath, topShelfRoute } from "./nativeIntent"

jest.mock("react-native", () => ({
  Linking: { getInitialURL: jest.fn() },
  Platform: { OS: "ios", isTV: true },
}))
const initialURL = jest.mocked(Linking.getInitialURL)
const video = "org.jesusfilm.forgetv://watch/chosen-witness?topShelf=1"

beforeEach(() => {
  jest.clearAllMocks()
  Platform.OS = "ios"
  initialURL.mockResolvedValue(video)
})

it("recovers the pending Top Shelf video after a cold Dev Launcher startup", async () => {
  expect(
    await redirectSystemPath({
      path: "org.jesusfilm.forgetv:///",
      initial: true,
    }),
  ).toBe("/watch/chosen-witness?topShelf=1")
  expect(initialURL).toHaveBeenCalledTimes(1)
})

it("preserves autoplay when recovering a cold play action", async () => {
  initialURL.mockResolvedValue(`${video}&autoplay=1`)
  expect(await redirectSystemPath({ path: "/", initial: true })).toBe(
    "/watch/chosen-witness?topShelf=1&autoplay=1",
  )
})

it("routes warm video and collection links without replaying launch options", async () => {
  expect(await redirectSystemPath({ path: video, initial: false })).toBe(
    "/watch/chosen-witness?topShelf=1",
  )
  expect(
    topShelfRoute(
      "org.jesusfilm.forgetv://top-shelf-topic/section_123?topShelf=1",
    ),
  ).toBe("/top-shelf-topic/section_123?topShelf=1")
  expect(initialURL).not.toHaveBeenCalled()
})

it("does not override another destination with an old initial URL", async () => {
  expect(await redirectSystemPath({ path: "/settings", initial: true })).toBe(
    "/settings",
  )
  expect(await redirectSystemPath({ path: "/", initial: false })).toBe("/")
  expect(initialURL).not.toHaveBeenCalled()
})

it.each([
  "https://watch/chosen-witness?topShelf=1",
  "org.jesusfilm.forgetv://watch/chosen-witness",
  "org.jesusfilm.forgetv://watch/chosen-witness?topShelf=1&topShelf=0",
  "org.jesusfilm.forgetv://watch/a/b?topShelf=1",
  "org.jesusfilm.forgetv://watch/%2Fsettings?topShelf=1",
  "org.jesusfilm.forgetv://user@watch/jesus?topShelf=1",
  "invalid",
])("rejects non-Top-Shelf or malformed targets: %s", (url) => {
  expect(topShelfRoute(url)).toBeNull()
})

it("leaves normal launcher startup and failed linking calls unchanged", async () => {
  initialURL.mockResolvedValue(null)
  expect(await redirectSystemPath({ path: "/", initial: true })).toBe("/")
  initialURL.mockRejectedValue(new Error("Linking unavailable"))
  expect(await redirectSystemPath({ path: "/", initial: true })).toBe("/")
})

it("leaves Android native routing unchanged", async () => {
  Platform.OS = "android"
  expect(await redirectSystemPath({ path: video, initial: true })).toBe(video)
  expect(initialURL).not.toHaveBeenCalled()
})
