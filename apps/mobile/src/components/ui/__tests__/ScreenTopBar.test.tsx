/**
 * The shared top bar for My Watch and the three screens it opens (KTD2): a
 * header title, an optional back control with a navigate fallback, and an
 * optional trailing action. Every control is a 44pt target.
 */

// apps/mobile's tsconfig maps `react` to its .d.ts. These mocks re-point
// `react` at the real package (see apps/mobile/CLAUDE.md "Component render tests").
jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
const mockIconRenders: string[] = []
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => {
    mockIconRenders.push(name)
    return null
  },
}))
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  navigate: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { ScreenTopBar, type ScreenTopBarProps } from "../ScreenTopBar"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

async function render(props: ScreenTopBarProps): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<ScreenTopBar {...props} />)
  })
  return renderer
}

/** Host nodes only: a composite and its host carry the same props. */
function hostNodes(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

function styleOf(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

function rootPaddingTop(renderer: TestInstance): number {
  const [root] = hostNodes(renderer, (node) => node.type === "View")
  return Number(styleOf(root).paddingTop ?? 0)
}

beforeEach(() => {
  mockRouter.back.mockReset()
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.canGoBack.mockReset()
  mockRouter.canGoBack.mockReturnValue(true)
  mockIconRenders.length = 0
  mockInsets.top = 59
})

describe("ScreenTopBar", () => {
  it("renders the title as an accessibility header", async () => {
    const renderer = await render({ title: "My Watch" })

    const headers = hostNodes(
      renderer,
      (node) =>
        node.props.accessibilityRole === "header" &&
        node.props.children === "My Watch",
    )
    expect(headers).toHaveLength(1)
    await unmount(renderer)
  })

  it("renders no back control when none is asked for", async () => {
    const renderer = await render({ title: "My Watch" })

    expect(
      hostNodes(renderer, (node) => node.props.accessibilityLabel === "Go back")
        .length,
    ).toBe(0)
    expect(
      hostNodes(renderer, (node) => node.props.accessibilityRole === "button")
        .length,
    ).toBe(0)
    await unmount(renderer)
  })

  it("goes back when the stack can go back", async () => {
    mockRouter.canGoBack.mockReturnValue(true)
    const renderer = await render({ title: "Downloads", showBack: true })

    await press(pressableByLabel(renderer, "Go back"))

    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("navigates to My Watch when the stack cannot go back (cold deep link)", async () => {
    mockRouter.canGoBack.mockReturnValue(false)
    const renderer = await render({ title: "Downloads", showBack: true })

    await press(pressableByLabel(renderer, "Go back"))

    expect(mockRouter.back).toHaveBeenCalledTimes(0)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/profile")
    // KTD12: navigate, never push or replace.
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    expect(mockRouter.replace).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("renders the trailing action with its own label and calls its handler", async () => {
    const onPress = jest.fn()
    const renderer = await render({
      title: "My Watch",
      trailingAction: { icon: "menu", accessibilityLabel: "More", onPress },
    })

    expect(mockIconRenders).toContain("menu")
    await press(pressableByLabel(renderer, "More"))

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("keeps the back control and the trailing action at 44pt or more", async () => {
    const renderer = await render({
      title: "My Watch",
      showBack: true,
      trailingAction: {
        icon: "menu",
        accessibilityLabel: "More",
        onPress: () => {},
      },
    })

    for (const label of ["Go back", "More"]) {
      const [target] = hostNodes(
        renderer,
        (node) => node.props.accessibilityLabel === label,
      )
      const style = styleOf(target)
      expect(Number(style.width ?? style.minWidth)).toBeGreaterThanOrEqual(44)
      expect(Number(style.height ?? style.minHeight)).toBeGreaterThanOrEqual(44)
    }
    await unmount(renderer)
  })

  it("pads the top safe-area inset itself", async () => {
    mockInsets.top = 59
    const notched = await render({ title: "My Watch" })
    const notchedTop = rootPaddingTop(notched)
    await unmount(notched)

    mockInsets.top = 0
    const flat = await render({ title: "My Watch" })
    const flatTop = rootPaddingTop(flat)
    await unmount(flat)

    expect(notchedTop - flatTop).toBe(59)
  })
})
