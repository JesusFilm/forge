/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global jest, describe, it, expect, beforeEach, afterEach */
const React = require("react")
// Use jest-expo's matching renderer; the TV package does not add another React.
const { create, act } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo")],
  }),
)
const mockFetch = jest.fn()
jest.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  StyleSheet: { create: (styles) => styles },
  Dimensions: { get: () => ({ width: 1920, height: 1080 }) },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove() {} }),
  },
}))
jest.mock("../../lib/scale", () => ({ scale: (value) => value }))
jest.mock("../watch/watchDetailTheme", () => ({ WATCH_THEME: {} }))
jest.mock("./HomeRail", () => ({ HomeRail: "HomeRail" }))
jest.mock("../ScreenStateView", () => ({ ScreenStateView: "ScreenStateView" }))
jest.mock("../../lib/recommendations/client", () => ({
  fetchForYou: (...args) => mockFetch(...args),
  getRecommendationGeneration: () => 0,
  subscribeRecommendations: () => () => {},
  sendCardEvidence: jest.fn(),
  selectRecommendation: jest.fn(),
}))
const { ForYouRail } = require("./ForYouRail")
let tree
beforeEach(() => {
  jest.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mockFetch.mockReset()
})
afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  tree = null
  jest.useRealTimers()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})
async function renderRail() {
  await act(async () => {
    tree = create(
      React.createElement(ForYouRail, {
        audioLanguageSlug: "thai",
        visit: 1,
        visible: true,
        onSelected() {},
        onCardFocus() {},
      }),
      {
        createNodeMock: () => ({
          measureInWindow: (callback) => callback(0, 100, 1000, 350),
        }),
      },
    )
  })
  // Delivery stays off the initial render path until the viewport check.
  expect(mockFetch).not.toHaveBeenCalled()
  await act(async () => jest.advanceTimersByTime(500))
}
describe("Home recommendation rail integration", () => {
  it("renders a partial exact-audio slate instead of hiding eligible cards", async () => {
    mockFetch.mockResolvedValue({
      result: "served",
      reason: null,
      items: [
        {
          id: "one",
          position: 0,
          targetMediaId: "film",
          videoSlug: "jesus",
          videoTitle: "JESUS",
        },
      ],
    })
    await renderRail()
    expect(mockFetch).toHaveBeenCalledWith("thai")
    expect(tree.root.findByType("HomeRail").props.cards).toHaveLength(1)
  })
  it("does not steal remote focus when the asynchronous request fails", async () => {
    mockFetch.mockRejectedValue(new Error("offline"))
    await renderRail()
    expect(tree.root.findByType("ScreenStateView").props).toMatchObject({
      kind: "error",
      retryAutoFocus: false,
    })
  })
})
