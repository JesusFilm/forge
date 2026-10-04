import { act } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { HomeHeader } from "../HomeHeader"

jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn() }),
}))

async function render(homeVariant: boolean): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <HomeHeader title={null} titleOpacity={0} homeVariant={homeVariant} />,
    )
  })
  return renderer
}

/** The labels of the header's buttons, once each. */
function buttons(renderer: TestInstance): string[] {
  const labels = renderer.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => String(node.props.accessibilityLabel))
  return [...new Set(labels)].sort()
}

describe("HomeHeader", () => {
  it("gives Home the announcements bell and no other action", async () => {
    const renderer = await render(true)
    expect(buttons(renderer)).toEqual(["Announcements, 1 new"])
    await unmount(renderer)
  })

  it("keeps Search and My Watch on Experience screens, without the bell", async () => {
    const renderer = await render(false)
    expect(buttons(renderer)).toEqual(["My Watch", "Search"])
    await unmount(renderer)
  })
})
