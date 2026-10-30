/* global require, jest, describe, it, expect, afterEach */
/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react")
const { create, act } = require(
  require.resolve("react-test-renderer", {
    paths: [require.resolve("jest-expo")],
  }),
)
const mockScrollToIndex = jest.fn()
const mockScrollToOffset = jest.fn()
jest.mock("react-native", () => {
  const React = require("react")
  return {
    Dimensions: { get: () => ({ width: 1920, height: 1080 }) },
    FlatList: React.forwardRef(function List(props, ref) {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: mockScrollToIndex,
        scrollToOffset: mockScrollToOffset,
      }))
      return React.createElement(
        "FlatList",
        props,
        props.data.map((item, index) =>
          React.createElement(
            React.Fragment,
            { key: index },
            props.renderItem({ item, index }),
          ),
        ),
      )
    }),
    Platform: { OS: "android" },
    Pressable: "Pressable",
    Text: "Text",
    View: "View",
    StyleSheet: { create: (value) => value },
  }
})
jest.mock("../../lib/scale", () => ({
  scale: (value) => value,
  readableFontSize: (value) => value,
}))
jest.mock("../TVFocusGuideView", () => ({
  TVFocusGuideView: "TVFocusGuideView",
}))
jest.mock("../watch/watchDetailTheme", () => ({ WATCH_THEME: {} }))
jest.mock("./HomeCard", () => ({
  HomeCard: "HomeCard",
  HOME_CARD_WIDTH: 400,
  HOME_CARD_DIMS: {
    landscape: { width: 400, thumbHeight: 188 },
    portrait: { width: 260, thumbHeight: 390 },
  },
}))
const { HomeRail } = require("./HomeRail")
let tree
const cards = Array.from({ length: 8 }, (_, index) => ({ id: String(index) }))
const props = {
  cards,
  rowIndex: 1,
  title: "Happy",
  eyebrow: "",
  onCardFocus() {},
  onCardPress() {},
  onCardNode() {},
}
afterEach(async () => {
  if (tree) await act(async () => tree.unmount())
  tree = null
  mockScrollToIndex.mockReset()
  mockScrollToOffset.mockReset()
})
describe("HomeRail return positioning", () => {
  it.each([3, 6])(
    "preserves the existing horizontal offset for mounted card %i",
    async (index) => {
      await act(async () => {
        tree = create(React.createElement(HomeRail, props))
      })
      await act(async () => {
        tree.root.findAllByType("HomeCard")[index].props.nodeRef({})
      })
      const ready = jest.fn()
      await act(async () => {
        tree.update(
          React.createElement(HomeRail, {
            ...props,
            restoreCardId: String(index),
            restoreRequest: "return",
            onRestoreReady: ready,
          }),
        )
      })
      expect(mockScrollToIndex).not.toHaveBeenCalled()
      expect(ready).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    [3, 0],
    [6, 1180],
  ])(
    "restores card %i at its accepted offset after incidental native scrolling",
    async (index, savedOffset) => {
      let active = true
      const onCardFocus = jest.fn(() => active)
      const railProps = {
        ...props,
        onCardFocus,
        canRememberPosition: () => active,
      }
      await act(async () => {
        tree = create(React.createElement(HomeRail, railProps))
      })
      const card = () => tree.root.findAllByType("HomeCard")[index]
      await act(async () => {
        card().props.onFocus(cards[index], {})
      })
      const scroll = (x) =>
        tree.root
          .findByType("FlatList")
          .props.onScroll({ nativeEvent: { contentOffset: { x } } })
      await act(async () => {
        scroll(savedOffset)
      })
      active = false
      await act(async () => {
        tree.root.findAllByType("HomeCard")[0].props.onFocus(cards[0], {})
        scroll(0)
        tree.update(
          React.createElement(HomeRail, {
            ...railProps,
            restoreCardId: String(index),
            restoreRequest: "return",
          }),
        )
      })
      expect(mockScrollToOffset).toHaveBeenCalledWith({
        offset: savedOffset,
        animated: false,
      })
      expect(mockScrollToIndex).not.toHaveBeenCalled()
    },
  )
  it("restores a screen-owned end offset after a rail remount", async () => {
    await act(async () => {
      tree = create(
        React.createElement(HomeRail, {
          ...props,
          restoreCardId: "6",
          restoreRequest: "return",
          restoreOffset: 1180,
        }),
      )
    })
    expect(mockScrollToOffset).toHaveBeenCalledWith({
      offset: 1180,
      animated: false,
    })
    expect(mockScrollToIndex).not.toHaveBeenCalled()
  })
  it("reveals a virtualized target by its exact current card index", async () => {
    await act(async () => {
      tree = create(
        React.createElement(HomeRail, {
          ...props,
          restoreCardId: "6",
          restoreRequest: "return",
        }),
      )
    })
    expect(mockScrollToIndex).toHaveBeenCalledWith({
      index: 6,
      animated: false,
    })
  })
  it("reports a removed target instead of focusing a different card", async () => {
    const unavailable = jest.fn()
    await act(async () => {
      tree = create(
        React.createElement(HomeRail, {
          ...props,
          restoreCardId: "removed",
          restoreRequest: "return",
          onRestoreUnavailable: unavailable,
        }),
      )
    })
    expect(unavailable).toHaveBeenCalledTimes(1)
    expect(mockScrollToIndex).not.toHaveBeenCalled()
    expect(mockScrollToOffset).not.toHaveBeenCalled()
  })
  it.each(["cancel", "acknowledge"])(
    "ignores stale request props after %s and a late cards update",
    async (outcome) => {
      const { createHomeFocusRestore } = require("./homeFocusRestore")
      const memory = createHomeFocusRestore()
      const target = { sectionId: "happy", cardId: "6" }
      memory.capture(target)
      memory.blur()
      memory.enter()
      memory.settle()
      const ready = jest.fn()
      const restoreProps = {
        ...props,
        restoreRequest: "old-return",
        restoreCardId: "6",
        restoreOffset: 1180,
        isRestorePending: (cardId) =>
          memory.isRestoring({ sectionId: "happy", cardId }),
        onRestoreReady: ready,
      }
      await act(async () => {
        tree = create(React.createElement(HomeRail, restoreProps))
      })
      expect(mockScrollToOffset).toHaveBeenCalledTimes(1)
      if (outcome === "cancel") memory.cancel()
      else memory.capture(target)
      mockScrollToOffset.mockClear()
      ready.mockClear()
      await act(async () => {
        tree.update(
          React.createElement(HomeRail, {
            ...restoreProps,
            cards: [...cards, { id: "late" }],
          }),
        )
      })
      expect(mockScrollToOffset).not.toHaveBeenCalled()
      expect(mockScrollToIndex).not.toHaveBeenCalled()
      expect(ready).not.toHaveBeenCalled()
    },
  )
  it("reports row focus only after the card focus is accepted", async () => {
    const rowFocus = jest.fn()
    let accepted = false
    await act(async () => {
      tree = create(
        React.createElement(HomeRail, {
          ...props,
          onRowFocus: rowFocus,
          onCardFocus: () => accepted,
        }),
      )
    })
    await act(async () => {
      tree.root.findAllByType("HomeCard")[0].props.onFocus(cards[0], {})
    })
    expect(rowFocus).not.toHaveBeenCalled()
    accepted = true
    await act(async () => {
      tree.root.findAllByType("HomeCard")[3].props.onFocus(cards[3], {})
    })
    expect(rowFocus).toHaveBeenCalledWith(1)
  })
  it("remembers the actually pressed first card after its native focus was rejected", async () => {
    const { createHomeFocusRestore } = require("./homeFocusRestore")
    const memory = createHomeFocusRestore()
    memory.capture({ sectionId: "happy", cardId: "3" })
    memory.blur()
    memory.enter()
    const opened = jest.fn()
    await act(async () => {
      tree = create(
        React.createElement(HomeRail, {
          ...props,
          onCardFocus: (card, node, activation) =>
            (activation ? memory.activate : memory.capture)({
              sectionId: "happy",
              cardId: card.id,
            }),
          onCardPress: (card) => {
            opened(card.id)
            memory.blur()
          },
        }),
      )
    })
    const first = tree.root.findAllByType("HomeCard")[0]
    await act(async () => {
      first.props.onFocus(cards[0], {})
    })
    expect(memory.isRestoring({ sectionId: "happy", cardId: "3" })).toBe(true)
    // Select cancellation has no subsequent onFocus; actual onPress must own intent.
    memory.cancel()
    await act(async () => {
      first.props.onPress(cards[0])
    })
    expect(opened).toHaveBeenCalledWith("0")
    memory.enter()
    expect(memory.resolve([{ id: "happy", cards }])).toEqual({
      sectionId: "happy",
      cardId: "0",
      rowIndex: 1,
    })
  })
  it("does not scroll on ordinary rail entry", async () => {
    await act(async () => {
      tree = create(React.createElement(HomeRail, props))
    })
    expect(mockScrollToIndex).not.toHaveBeenCalled()
  })
})
