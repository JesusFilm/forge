/** The no-downloads message (R9, KTD11), on My Watch and on the Downloads
 *  screen. The copy is the owner's, so the suite pins it byte for byte. */

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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
const mockRouter = {
  navigate: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import {
  LibraryEmptyState,
  type LibraryEmptyStateProps,
} from "../LibraryEmptyState"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

async function render(
  props: LibraryEmptyStateProps = {},
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<LibraryEmptyState {...props} />)
  })
  return renderer
}

function hostTextCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => node.type === "Text" && node.props.children === text,
  ).length
}

beforeEach(() => {
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
})

describe("LibraryEmptyState", () => {
  it("shows the R9 title and body (AE1)", async () => {
    const renderer = await render()

    expect(hostTextCount(renderer, "No Downloads Yet")).toBe(1)
    expect(
      hostTextCount(renderer, "Download a video to watch it offline"),
    ).toBe(1)
    await unmount(renderer)
  })

  it("marks the title as an accessibility header", async () => {
    const renderer = await render()

    const headers = renderer.root.findAll(
      (node) =>
        node.type === "Text" &&
        node.props.accessibilityRole === "header" &&
        node.props.children === "No Downloads Yet",
    )
    expect(headers).toHaveLength(1)
    await unmount(renderer)
  })

  it("opens the Home tab, not Search, from Browse videos (AE1)", async () => {
    const renderer = await render()

    await press(pressableByLabel(renderer, "Browse videos"))

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)")
    expect(mockRouter.navigate).not.toHaveBeenCalledWith("/(tabs)/watch")
    // KTD12: navigate, never push or replace.
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    expect(mockRouter.replace).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("runs the host's onBrowse in place of the default navigate", async () => {
    const onBrowse = jest.fn()
    const renderer = await render({ onBrowse })

    await press(pressableByLabel(renderer, "Browse videos"))

    expect(onBrowse).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    expect(mockRouter.replace).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("applies the host's style to its root, so a page can center it", async () => {
    const renderer = await render({ style: { justifyContent: "center" } })

    const [root] = renderer.root.findAll((node) => node.type === "View")
    const style =
      StyleSheet.flatten(root.props.style as StyleProp<ViewStyle>) ?? {}
    expect(style.justifyContent).toBe("center")
    await unmount(renderer)
  })
})
