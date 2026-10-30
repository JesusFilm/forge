/* global require, jest, describe, it, expect, afterEach */
/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react")
const { create, act } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo")],
  }),
)
jest.mock("react-native", () => ({
  Animated: {
    Value: class {
      interpolate() {
        return 0
      }
    },
    timing: () => ({ start() {}, stop() {} }),
    View: "AnimatedView",
    Text: "AnimatedText",
  },
  Pressable: "Pressable",
  View: "View",
  Text: "Text",
  Platform: { OS: "android" },
  StyleSheet: { create: (value) => value },
  useTVEventHandler() {},
}))
jest.mock("@expo/vector-icons/Ionicons", () => "Ionicons")
jest.mock("../../lib/scale", () => ({
  scale: (value) => value,
  readableFontSize: (value) => value,
}))
jest.mock("../watch/watchDetailTheme", () => ({ WATCH_THEME: {} }))
jest.mock("../watch/AnimatedFocusIcon", () => ({
  AnimatedFocusIcon: "AnimatedFocusIcon",
}))
jest.mock("../focus/useFocusVisual", () => {
  const state = () => ({
    setFocused() {},
    progress: {
      interpolate() {
        return 0
      },
    },
    transform: [],
  })
  return { useFocusVisual: state, useFocusAnimation: state }
})
jest.mock("./HomeBillboard", () => ({ HomeBillboard: ({ action }) => action }))
const { HomeTopBar } = require("./HomeTopBar")
const { HomeHeroCarousel } = require("./HomeHeroCarousel")
const { createHomeFocusRestore } = require("./homeFocusRestore")
const { createFocusMemory } = require("./focusMemory")
let tree
afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  tree = null
})
describe("Home non-card activation intent", () => {
  it.each(["Search", "Details"])(
    "records the actual %s node before navigation without a fresh focus event",
    async (label) => {
      const logical = createHomeFocusRestore()
      const native = createFocusMemory()
      const oldNode = { requestTVFocus: jest.fn() }
      native.capture(oldNode)
      logical.capture({ sectionId: "happy", cardId: "fourth" })
      logical.blur()
      logical.enter()
      const activatedNode = { requestTVFocus: jest.fn() }
      const captureNode = (node, activation) => {
        if (activation ? logical.activate(null) : logical.capture(null))
          native.capture(node)
      }
      const navigate = jest.fn(() => logical.blur())
      await act(async () => {
        tree = create(
          label === "Search"
            ? React.createElement(HomeTopBar, {
                hidden: false,
                onSearchPress: navigate,
                onSettingsPress() {},
                onChromeFocus() {},
                onFocusNode: captureNode,
              })
            : React.createElement(HomeHeroCarousel, {
                active: true,
                slides: [{ id: "hero" }],
                index: 0,
                onSelect: navigate,
                onFocusChange() {},
                onRequestAdvance() {},
                onFocusNode: captureNode,
              }),
          { createNodeMock: () => activatedNode },
        )
      })
      const button = tree.root
        .findAllByType("Pressable")
        .find((node) => node.props.accessibilityLabel === label)
      await act(async () => {
        button.props.onFocus()
      })
      expect(logical.isPending()).toBe(true)
      logical.cancel()
      await act(async () => {
        button.props.onPress()
      })
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(logical.enter()).toBe(false)
      expect(
        logical.resolve([{ id: "happy", cards: [{ id: "fourth" }] }]),
      ).toBeNull()
      expect(native.restore()).toBe(true)
      expect(activatedNode.requestTVFocus).toHaveBeenCalledTimes(1)
      expect(oldNode.requestTVFocus).not.toHaveBeenCalled()
    },
  )
})
