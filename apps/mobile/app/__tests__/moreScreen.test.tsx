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
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("../../src/lib/openExternalUrl", () => ({
  openExternalUrl: jest.fn(),
}))
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}))
const mockVersionParts: { version: string | null; build: string | null } = {
  version: "1.0.0",
  build: "7",
}
jest.mock("../../src/lib/appVersion", () => ({
  ...jest.requireActual("../../src/lib/appVersion"),
  readAppVersionParts: () => ({ ...mockVersionParts }),
}))
// More never reads auth or the sign-in gate (R16). These count every read.
const mockAuth = { snapshot: { status: "signedOut", user: null } as unknown }
const mockReads = { auth: 0, gate: 0 }
jest.mock("../../src/lib/authSession", () => ({
  getAuthSession: () => {
    mockReads.auth += 1
    return {
      subscribe: () => () => {},
      getSnapshot: () => mockAuth.snapshot,
    }
  },
}))
const mockSignInGate = { open: true }
jest.mock("../../src/lib/signInGate", () => ({
  isSignInAvailable: () => {
    mockReads.gate += 1
    return mockSignInGate.open
  },
}))

import { act } from "react"
import {
  Dimensions,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import * as WebBrowser from "expo-web-browser"

import MoreScreen from "../more"
import { openExternalUrl } from "../../src/lib/openExternalUrl"
import { miniPlayerWindowSize } from "../../src/lib/miniPlayer/layout"
import { TAB_BAR_OCCUPIED_HEIGHT } from "../../src/lib/tabBar"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

const mockedOpen = jest.mocked(openExternalUrl)

const PRIVACY_URL = "https://www.jesusfilm.org/privacy/"
const TERMS_URL = "https://www.jesusfilm.org/terms-of-use/"
const GIVE_URL = "https://www.jesusfilm.org/give/"

const ROW_TABLE: readonly (readonly [string, string, string])[] = [
  ["Give", GIVE_URL, "more-give"],
  [
    "Contact Jesus Film Project",
    "https://www.jesusfilm.org/contact/",
    "more-contact-us",
  ],
  [
    "About Jesus Film",
    "https://www.jesusfilm.org/about/",
    "more-about-jesus-film",
  ],
  ["Newsletter", "https://www.jesusfilm.org/email/", "more-newsletter"],
  ["Privacy Policy", PRIVACY_URL, "more-privacy-policy"],
  ["Terms of Use", TERMS_URL, "more-terms-of-use"],
  [
    "Legal Statement",
    "https://www.jesusfilm.org/legal/",
    "more-legal-statement",
  ],
]

const SOCIAL_TABLE: readonly (readonly [string, string, string, string])[] = [
  ["X", "https://twitter.com/jesusfilm", "more-social-x", "logo-x"],
  [
    "Facebook",
    "https://www.facebook.com/jesusfilm",
    "more-social-facebook",
    "logo-facebook",
  ],
  [
    "Instagram",
    "https://www.instagram.com/jesusfilm",
    "more-social-instagram",
    "logo-instagram",
  ],
  [
    "YouTube",
    "https://www.youtube.com/user/jesusfilm",
    "more-social-youtube",
    "logo-youtube",
  ],
]

const EXPECTED_LINK_ORDER = [
  "Contact Jesus Film Project",
  "About Jesus Film",
  "Newsletter",
  "Give",
  "X",
  "Facebook",
  "Instagram",
  "YouTube",
  "Privacy Policy",
  "Terms of Use",
  "Legal Statement",
]

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<MoreScreen />)
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

function linkNodes(renderer: TestInstance): RenderedNode[] {
  return hostNodes(renderer, (node) => node.props.accessibilityRole === "link")
}

function linkLabels(renderer: TestInstance): string[] {
  return linkNodes(renderer).map((node) =>
    String(node.props.accessibilityLabel),
  )
}

function textOf(node: RenderedNode): string {
  const { children } = node.props
  return Array.isArray(children) ? children.join("") : String(children)
}

function headerTexts(renderer: TestInstance): string[] {
  return hostNodes(
    renderer,
    (node) => node.type === "Text" && node.props.accessibilityRole === "header",
  ).map(textOf)
}

function groupOf(node: RenderedNode): string | null {
  let current: RenderedNode | null | undefined = node
  while (current != null) {
    const testID = current.props.testID
    if (typeof testID === "string" && testID.startsWith("more-group-"))
      return testID
    current = current.parent
  }
  return null
}

function styleOf(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

function hostByLabel(renderer: TestInstance, label: string): RenderedNode {
  const matches = hostNodes(
    renderer,
    (node) => node.props.accessibilityLabel === label,
  )
  expect(matches.length).toBe(1)
  return matches[0]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIconRenders.length = 0
  mockVersionParts.version = "1.0.0"
  mockVersionParts.build = "7"
  mockAuth.snapshot = { status: "signedOut", user: null }
  mockSignInGate.open = true
  mockReads.auth = 0
  mockReads.gate = 0
})

describe("MoreScreen", () => {
  it("renders the groups in the order Support, About, Legal", async () => {
    const renderer = await render()
    expect(headerTexts(renderer)).toEqual(["More", "Support", "About", "Legal"])
    await unmount(renderer)
  })

  it("renders every row in R11 to R13 order, inside its own group", async () => {
    const renderer = await render()
    expect(linkLabels(renderer)).toEqual(EXPECTED_LINK_ORDER)
    const groups = linkNodes(renderer).map(
      (node) => `${String(node.props.accessibilityLabel)}@${groupOf(node)}`,
    )
    expect(groups).toEqual([
      "Contact Jesus Film Project@more-group-support",
      "About Jesus Film@more-group-about",
      "Newsletter@more-group-about",
      "Give@more-group-about",
      "X@more-group-about",
      "Facebook@more-group-about",
      "Instagram@more-group-about",
      "YouTube@more-group-about",
      "Privacy Policy@more-group-legal",
      "Terms of Use@more-group-legal",
      "Legal Statement@more-group-legal",
    ])
    await unmount(renderer)
  })

  it("lists Send Feedback first in Support, then Contact Jesus Film Project", async () => {
    const renderer = await render()
    const supportRows = hostNodes(
      renderer,
      (node) =>
        (node.props.accessibilityRole === "link" ||
          node.props.accessibilityRole === "button") &&
        groupOf(node) === "more-group-support",
    ).map((node) => String(node.props.accessibilityLabel))
    expect(supportRows).toEqual(["Send Feedback", "Contact Jesus Film Project"])
    await unmount(renderer)
  })

  // The one row that stays in the app: it opens the root feedback sheet route,
  // so it reads as a button with a chevron, not a link that leaves the app.
  it("opens the feedback sheet from Send Feedback, never the browser", async () => {
    const renderer = await render()
    const row = hostByLabel(renderer, "Send Feedback")
    expect(row.props.accessibilityRole).toBe("button")
    expect(row.props.accessibilityHint).toBe("Opens the feedback form")
    expect(row.props["dd-action-name"]).toBe("more-send-feedback")
    expect(styleOf(row).minHeight).toBeGreaterThanOrEqual(44)
    expect(mockIconRenders).toContain("chevron-forward")
    await press(pressableByLabel(renderer, "Send Feedback"))
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/feedback")
    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(mockedOpen).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("keeps Privacy Policy in the Legal group and opens its page (AE6)", async () => {
    const renderer = await render()
    const row = hostByLabel(renderer, "Privacy Policy")
    expect(groupOf(row)).toBe("more-group-legal")
    await press(pressableByLabel(renderer, "Privacy Policy"))
    expect(mockedOpen).toHaveBeenCalledTimes(1)
    expect(mockedOpen).toHaveBeenCalledWith(PRIVACY_URL)
    await unmount(renderer)
  })

  it("sends Give to the system browser, never to expo-web-browser", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Give"))
    expect(mockedOpen).toHaveBeenCalledTimes(1)
    expect(mockedOpen).toHaveBeenCalledWith(GIVE_URL)
    expect(jest.mocked(WebBrowser.openBrowserAsync).mock.calls.length).toBe(0)
    expect(jest.mocked(WebBrowser.openAuthSessionAsync).mock.calls.length).toBe(
      0,
    )
    await unmount(renderer)
  })

  it("opens the Terms of Use page", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Terms of Use"))
    expect(mockedOpen).toHaveBeenCalledTimes(1)
    expect(mockedOpen).toHaveBeenCalledWith(TERMS_URL)
    await unmount(renderer)
  })

  it.each(ROW_TABLE)(
    "opens %s at its page with its RUM action name",
    async (label, url, actionName) => {
      const renderer = await render()
      const row = hostByLabel(renderer, label)
      expect(row.props["dd-action-name"]).toBe(actionName)
      expect(styleOf(row).minHeight).toBeGreaterThanOrEqual(44)
      await press(pressableByLabel(renderer, label))
      expect(mockedOpen).toHaveBeenCalledTimes(1)
      expect(mockedOpen).toHaveBeenCalledWith(url)
      await unmount(renderer)
    },
  )

  it.each(SOCIAL_TABLE)(
    "labels the %s icon with its network and opens its page",
    async (label, url, actionName, icon) => {
      const renderer = await render()
      const button = hostByLabel(renderer, label)
      expect(button.props.accessibilityRole).toBe("link")
      expect(button.props["dd-action-name"]).toBe(actionName)
      const style = styleOf(button)
      expect(style.width).toBeGreaterThanOrEqual(44)
      expect(style.height).toBeGreaterThanOrEqual(44)
      expect(mockIconRenders).toContain(icon)
      await press(pressableByLabel(renderer, label))
      expect(mockedOpen).toHaveBeenCalledTimes(1)
      expect(mockedOpen).toHaveBeenCalledWith(url)
      await unmount(renderer)
    },
  )

  it("shows the same rows signed in, signed out, gate open, and gate closed", async () => {
    const states = [
      { snapshot: { status: "signedOut", user: null }, gateOpen: true },
      { snapshot: { status: "signedOut", user: null }, gateOpen: false },
      {
        snapshot: { status: "signedIn", user: { id: "u1", name: "Ada" } },
        gateOpen: true,
      },
      {
        snapshot: { status: "signedIn", user: { id: "u1", name: "Ada" } },
        gateOpen: false,
      },
    ]
    for (const state of states) {
      mockAuth.snapshot = state.snapshot
      mockSignInGate.open = state.gateOpen
      const renderer = await render()
      expect(linkLabels(renderer)).toEqual(EXPECTED_LINK_ORDER)
      expect(
        hostByLabel(renderer, "Send Feedback").props.accessibilityRole,
      ).toBe("button")
      expect(headerTexts(renderer)).toEqual([
        "More",
        "Support",
        "About",
        "Legal",
      ])
      await unmount(renderer)
    }
    expect(mockReads.auth).toBe(0)
    expect(mockReads.gate).toBe(0)
  })

  it("shows the version and build as the last line of the page", async () => {
    const renderer = await render()
    expect(hasText(renderer, "Version 1.0.0 (7)")).toBe(true)
    const texts = hostNodes(renderer, (node) => node.type === "Text")
    expect(texts.length).toBeGreaterThan(0)
    expect(textOf(texts[texts.length - 1])).toBe("Version 1.0.0 (7)")
    await unmount(renderer)
  })

  it("shows the version alone when the build number is null", async () => {
    mockVersionParts.build = null
    const renderer = await render()
    expect(hasText(renderer, "Version 1.0.0")).toBe(true)
    expect(hasText(renderer, "(")).toBe(false)
    await unmount(renderer)
  })

  it("omits the version line when no version is known", async () => {
    mockVersionParts.version = null
    const renderer = await render()
    expect(hasText(renderer, "Version")).toBe(false)
    expect(linkLabels(renderer)).toEqual(EXPECTED_LINK_ORDER)
    await unmount(renderer)
  })

  it("has a back control that returns to My Watch", async () => {
    const renderer = await render()
    const back = hostByLabel(renderer, "Go back")
    expect(back.props.accessibilityRole).toBe("button")
    await press(pressableByLabel(renderer, "Go back"))
    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("pads the bottom so the last line scrolls clear of the mini player", async () => {
    const renderer = await render()
    const scrolls = hostNodes(renderer, (node) => node.type === "RCTScrollView")
    expect(scrolls.length).toBe(1)
    const content = StyleSheet.flatten(
      scrolls[0].props.contentContainerStyle as StyleProp<ViewStyle>,
    )
    const screen = Dimensions.get("window")
    const windowTop =
      mockInsets.bottom +
      TAB_BAR_OCCUPIED_HEIGHT +
      miniPlayerWindowSize({
        screen: { width: screen.width, height: screen.height },
        insets: mockInsets,
        chrome: { top: 0, bottom: TAB_BAR_OCCUPIED_HEIGHT },
      }).height
    expect(Number(content.paddingBottom)).toBeGreaterThan(windowTop)
    await unmount(renderer)
  })
})
