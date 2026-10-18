// The Experience header's glass buttons take Apple's own press response. Its
// scroll title pill is a label, so it takes none.

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
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn() }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))

import { act } from "react"

import { HomeHeader } from "../HomeHeader"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

type SearchableNode = RenderedNode & {
  findAll(predicate: (node: RenderedNode) => boolean): RenderedNode[]
}

describe("HomeHeader glass", () => {
  it("gives the two buttons Apple's press response and the title pill none", async () => {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <HomeHeader title="Easter" titleOpacity={1} />,
      )
    })
    const glass = renderer.root.findAll(
      (n) => n.type === "GlassView",
    ) as SearchableNode[]
    const holdsTitle = (n: SearchableNode) =>
      n.findAll((c) => c.props.children === "Easter").length > 0

    expect(glass).toHaveLength(3)
    const rows = glass
      .map((n) => [holdsTitle(n), n.props.isInteractive === true])
      .sort()
    expect(rows).toEqual([
      [false, true],
      [false, true],
      [true, false],
    ])
    await unmount(renderer)
  })
})
