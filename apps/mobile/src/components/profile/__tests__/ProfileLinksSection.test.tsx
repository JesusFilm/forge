/**
 * The Profile door (U5/R1): the link group carries a "Send feedback" row that
 * pushes the in-app route instead of leaving the app, and its position in the
 * group is pinned so a later edit cannot quietly move it.
 *
 * Both halves of the row union are exercised. A test that only pressed the new
 * row would stay green if every row started pushing a route.
 */

// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/openExternalUrl", () => ({
  openExternalUrl: jest.fn(),
}))
// A `const` captured by the factory would be in its temporal dead zone: babel
// hoists this call above the imports, so the factory runs before the module
// body assigns it. The router stub is installed per test instead.
jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}))

import { act } from "react"
import { useRouter } from "expo-router"

import { ProfileLinksSection } from "../ProfileLinksSection"
import { openExternalUrl } from "../../../lib/openExternalUrl"
import {
  TestRenderer,
  press,
  pressableByLabel,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedOpenExternalUrl = jest.mocked(openExternalUrl)
const mockPush = jest.fn()

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<ProfileLinksSection />)
  })
  return renderer
}

/**
 * Row labels in tree order. A Pressable matches twice — once as the composite
 * and once as its host node — so the first occurrence of each label wins.
 */
function rowLabels(renderer: TestInstance): string[] {
  const seen = new Set<string>()
  for (const node of renderer.root.findAll(
    (candidate: RenderedNode) =>
      typeof candidate.props.onPress === "function" &&
      typeof candidate.props.accessibilityLabel === "string",
  )) {
    seen.add(node.props.accessibilityLabel as string)
  }
  return [...seen]
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useRouter).mockReturnValue({
    push: mockPush,
  } as unknown as ReturnType<typeof useRouter>)
})

describe("ProfileLinksSection", () => {
  it("renders a Send feedback row with a button role", async () => {
    const row = pressableByLabel(await render(), "Send feedback")
    expect(row.props.accessibilityRole).toBe("button")
  })

  it("places Send feedback directly after Contact", async () => {
    const labels = rowLabels(await render())
    expect(labels).toContain("Send feedback")
    expect(labels.indexOf("Send feedback")).toBe(labels.indexOf("Contact") + 1)
  })

  it("pushes the feedback route and never opens a URL", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Send feedback"))
    expect(mockPush).toHaveBeenCalledWith("/feedback")
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled()
  })

  it("still opens an external URL for the neighbouring rows", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Contact"))
    expect(mockedOpenExternalUrl).toHaveBeenCalledWith(
      "https://www.jesusfilm.org/contact/",
    )
    expect(mockPush).not.toHaveBeenCalled()
  })
})
