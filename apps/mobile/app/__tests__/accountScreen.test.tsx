/** The Account screen (U6: R17 to R19, KTD9). It shows the identity, Sign out
 *  and Delete account, and leaves to My Watch only on a signed-in to
 *  signed-out change, never on an open before the stored session loads. */

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
// A named component, so a case can find the mask as an ancestor node.
jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplayView: {
    MaskAll: function MockMaskAll({ children }: { children?: unknown }) {
      return children
    },
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
jest.mock("../../src/lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
}))
jest.mock("../../src/lib/authSession", () => {
  // Stable snapshot identity — useSyncExternalStore loops on a fresh object.
  let snapshot: unknown = { status: "signedOut", user: null }
  const listeners = new Set<() => void>()
  return {
    getAuthSession: () => ({
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
    }),
    __setSnapshot: (next: unknown) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    // A failed case skips its unmount and stays subscribed. Drop it, so that
    // it cannot render into a later case.
    __resetSnapshot: (next: unknown) => {
      listeners.clear()
      snapshot = next
    },
  }
})
// The screen must never read the gate. The holder counts reads, so a case
// can prove that, and lets a case close the gate.
const mockSignInGate = { open: true, calls: 0 }
jest.mock("../../src/lib/signInGate", () => ({
  isSignInAvailable: () => {
    mockSignInGate.calls += 1
    return mockSignInGate.open
  },
}))

import { StrictMode, act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"
import { SessionReplayView } from "@datadog/mobile-react-native-session-replay"

import AccountScreen from "../account"
import {
  deleteAccount,
  signInWithHostedPage,
  signOut,
} from "../../src/lib/authActions"
import {
  WINDOW_EDGE_MARGIN,
  miniPlayerMinWidth,
} from "../../src/lib/miniPlayer/layout"
import { PLAYER_HEIGHT_RATIO } from "../../src/lib/playerLayout"
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

// No @types/node here; jest runs on Node, so the listener API exists.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void
}

const mockedSignIn = jest.mocked(signInWithHostedPage)
const mockedSignOut = jest.mocked(signOut)
const mockedDelete = jest.mocked(deleteAccount)
const { __setSnapshot: setSnapshot, __resetSnapshot: resetSnapshot } =
  jest.requireMock("../../src/lib/authSession") as {
    __setSnapshot: (next: unknown) => void
    __resetSnapshot: (next: unknown) => void
  }

const SIGNED_OUT = { status: "signedOut", user: null } as const
const SIGNED_IN = {
  status: "signedIn",
  user: { id: "user-a", name: "Test Person", email: "tester@example.com" },
} as const
const SIGNED_IN_B = {
  status: "signedIn",
  user: { id: "user-b", name: "Other Person", email: "other@example.com" },
} as const
// The Hide My Email case: no name, so the display name is the email.
const SIGNED_IN_NO_NAME = {
  status: "signedIn",
  user: { id: "user-c", name: "   ", email: "relay@privaterelay.appleid.com" },
} as const

const NOT_SIGNED_IN = "You are not signed in"
const SIGN_OUT = "Sign out"
const SIGNING_OUT = "Signing out…"

async function renderScreen(
  { strict }: { strict: boolean } = { strict: false },
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      strict ? (
        <StrictMode>
          <AccountScreen />
        </StrictMode>
      ) : (
        <AccountScreen />
      ),
    )
  })
  return renderer
}

/** `hasText` matches substrings; identity checks need the exact string. */
function hasExactText(renderer: TestInstance, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.props.children === text).length > 0
  )
}

/** Host nodes only: a composite and its host carry the same props. */
function hostTextCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  ).length
}

function maskCount(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) => node.type === SessionReplayView.MaskAll,
  ).length
}

function insideReplayMask(node: RenderedNode): boolean {
  for (let at = node.parent; at != null; at = at.parent) {
    if (at.type === SessionReplayView.MaskAll) return true
  }
  return false
}

/** Every node that shows `text` sits inside the replay mask. */
function textIsMasked(renderer: TestInstance, text: string): boolean {
  const nodes = renderer.root.findAll((node) => node.props.children === text)
  expect(nodes.length).toBeGreaterThan(0)
  return nodes.every(insideReplayMask)
}

/** Every way the screen can leave: back(), or navigate() on a cold stack. */
function leaveCount(): number {
  return (
    mockRouter.back.mock.calls.length + mockRouter.navigate.mock.calls.length
  )
}

function contentPaddingBottom(renderer: TestInstance): number {
  const [scroll] = renderer.root.findAll(
    (node) => node.props.contentContainerStyle != null,
  )
  const style =
    StyleSheet.flatten(
      scroll.props.contentContainerStyle as StyleProp<ViewStyle>,
    ) ?? {}
  return Number(style.paddingBottom ?? 0)
}

beforeEach(() => {
  mockedSignIn.mockReset()
  mockedSignOut.mockReset()
  mockedDelete.mockReset()
  mockRouter.back.mockReset()
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.canGoBack.mockReset()
  mockRouter.canGoBack.mockReturnValue(true)
  mockInsets.bottom = 34
  mockSignInGate.open = true
  mockSignInGate.calls = 0
  resetSnapshot(SIGNED_OUT)
})

describe("AccountScreen signed in (R17)", () => {
  it("shows the Account top bar with a back control that leaves to My Watch", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    expect(
      renderer.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "header" &&
          node.props.children === "Account",
      ).length,
    ).toBe(1)
    await press(pressableByLabel(renderer, "Go back"))
    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("gate closed, signed in: shows the name and email, Sign out and Delete account, and never reads the gate (AE5, R8)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(hasExactText(renderer, SIGNED_IN.user.email)).toBe(true)
    expect(pressableByLabel(renderer, SIGN_OUT).props.disabled).toBe(false)
    expect(pressableByLabel(renderer, "Delete account")).toBeDefined()
    expect(hasText(renderer, "coming soon")).toBe(false)
    expect(mockSignInGate.calls).toBe(0)
    await unmount(renderer)
  })

  it("gate closed, signed in: Sign in again inside deletion still opens the sheet (AE5, R9)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    expect(leaveCount()).toBe(0)
    await unmount(renderer)
  })

  it("masks the name, the email, and the avatar initial in session replay (R19)", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    expect(maskCount(renderer)).toBe(1)
    expect(textIsMasked(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(textIsMasked(renderer, SIGNED_IN.user.email)).toBe(true)
    expect(textIsMasked(renderer, "T")).toBe(true)
    await unmount(renderer)
  })

  it("with no name, shows the email once, inside the replay mask (R19)", async () => {
    setSnapshot(SIGNED_IN_NO_NAME)
    const renderer = await renderScreen()

    expect(hostTextCount(renderer, SIGNED_IN_NO_NAME.user.email)).toBe(1)
    expect(textIsMasked(renderer, SIGNED_IN_NO_NAME.user.email)).toBe(true)
    await unmount(renderer)
  })

  it("puts no name and no email in an accessibility label or dd-action-name", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()
    const labelled = renderer.root.findAll(
      (node) =>
        typeof node.props.accessibilityLabel === "string" ||
        typeof node.props["dd-action-name"] === "string",
    )

    expect(labelled.length).toBeGreaterThan(0)
    for (const node of labelled) {
      const text = `${String(node.props.accessibilityLabel)} ${String(
        node.props["dd-action-name"],
      )}`.toLowerCase()
      expect(text).not.toContain(SIGNED_IN.user.email)
      expect(text).not.toContain(SIGNED_IN.user.name.toLowerCase())
    }
    await unmount(renderer)
  })

  it("pads insets.bottom plus room for the floating mini player", async () => {
    setSnapshot(SIGNED_IN)
    mockInsets.bottom = 34
    const notched = await renderScreen()
    const notchedPad = contentPaddingBottom(notched)
    await unmount(notched)

    mockInsets.bottom = 0
    const flat = await renderScreen()
    const flatPad = contentPaddingBottom(flat)
    await unmount(flat)

    expect(notchedPad - flatPad).toBe(34)
    // The smallest window the mini player can draw, plus its edge margin.
    expect(flatPad).toBeGreaterThanOrEqual(
      Math.round(miniPlayerMinWidth() * PLAYER_HEIGHT_RATIO) +
        WINDOW_EDGE_MARGIN,
    )
  })
})

describe("AccountScreen Sign out wiring", () => {
  it("keeps the profile-sign-out dd-action-name, so the RUM series continues", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    expect(pressableByLabel(renderer, SIGN_OUT).props["dd-action-name"]).toBe(
      "profile-sign-out",
    )
    await unmount(renderer)
  })

  it("two taps in ONE act call signOut once and show Signing out… while it runs", async () => {
    let resolveSignOut!: () => void
    mockedSignOut.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignOut = resolve
      }),
    )
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()
    const button = pressableByLabel(renderer, SIGN_OUT)

    // One captured node, no re-render between the taps: only a ref guard
    // makes the second tap a no-op.
    await act(async () => {
      button.props.onPress?.()
      button.props.onPress?.()
    })

    expect(mockedSignOut).toHaveBeenCalledTimes(1)
    expect(hasExactText(renderer, SIGNING_OUT)).toBe(true)
    expect(pressableByLabel(renderer, SIGN_OUT).props.disabled).toBe(true)
    await act(async () => {
      resolveSignOut()
    })
    expect(hasExactText(renderer, SIGNING_OUT)).toBe(false)
    await unmount(renderer)
  })

  it("a rejected signOut does not escape as an unhandled rejection, and re-enables the button", async () => {
    mockedSignOut.mockRejectedValueOnce(new Error("revoke threw"))
    setSnapshot(SIGNED_IN)
    const unhandled = jest.fn()
    process.on("unhandledRejection", unhandled)
    try {
      const renderer = await renderScreen()

      await press(pressableByLabel(renderer, SIGN_OUT))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(unhandled).not.toHaveBeenCalled()
      expect(hasExactText(renderer, SIGNING_OUT)).toBe(false)
      expect(pressableByLabel(renderer, SIGN_OUT).props.disabled).toBe(false)
      expect(leaveCount()).toBe(0)
      mockedSignOut.mockResolvedValueOnce(undefined)
      await press(pressableByLabel(renderer, SIGN_OUT))
      expect(mockedSignOut).toHaveBeenCalledTimes(2)
      await unmount(renderer)
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})

describe("AccountScreen leaves only on signed-in to signed-out (KTD9)", () => {
  it("signed in: tapping Sign out and completing it closes the screen (AE4, R18)", async () => {
    mockedSignOut.mockImplementation(async () => {
      setSnapshot(SIGNED_OUT)
    })
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, SIGN_OUT))

    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    // The screen is on its way out, so it does not flash the signed-out copy.
    expect(hasText(renderer, NOT_SIGNED_IN)).toBe(false)
    await unmount(renderer)
  })

  it("on a cold stack, a sign-out navigates to My Watch instead", async () => {
    mockRouter.canGoBack.mockReturnValue(false)
    mockedSignOut.mockImplementation(async () => {
      setSnapshot(SIGNED_OUT)
    })
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, SIGN_OUT))

    expect(mockRouter.back).toHaveBeenCalledTimes(0)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/profile")
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    expect(mockRouter.replace).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("a completed deletion closes the screen", async () => {
    mockedDelete.mockImplementation(async () => {
      setSnapshot(SIGNED_OUT)
      return { status: "deleted" }
    })
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("opened signed out: shows only the not-signed-in line, stays open, and fills in when the session loads", async () => {
    const renderer = await renderScreen()

    expect(hasExactText(renderer, NOT_SIGNED_IN)).toBe(true)
    expect(hasText(renderer, SIGN_OUT)).toBe(false)
    expect(hasText(renderer, "Delete account")).toBe(false)
    expect(maskCount(renderer)).toBe(0)
    expect(leaveCount()).toBe(0)

    await act(async () => {
      setSnapshot(SIGNED_IN)
    })

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(hasExactText(renderer, SIGNED_IN.user.email)).toBe(true)
    expect(hasText(renderer, NOT_SIGNED_IN)).toBe(false)
    expect(leaveCount()).toBe(0)

    // Now signed in, a sign-out is a real change and closes the screen.
    await act(async () => {
      setSnapshot(SIGNED_OUT)
    })
    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("a switch from account A to account B during re-auth keeps the screen open", async () => {
    setSnapshot(SIGNED_IN)
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementation(async () => {
      setSnapshot(SIGNED_IN_B)
      return { status: "success" }
    })
    const renderer = await renderScreen()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    // A different subject: the flow deletes nothing and says so.
    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, "A different account signed in")).toBe(true)
    expect(hasExactText(renderer, SIGNED_IN_B.user.name)).toBe(true)
    expect(leaveCount()).toBe(0)
    await unmount(renderer)
  })
})

// StrictMode runs mount effects setup, cleanup, setup on the SAME instance, so
// a stale "previous status" would show here as a false close or a double one.
describe("AccountScreen under StrictMode", () => {
  it("a signed-in open stays open, and a sign-out leaves exactly once", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderScreen({ strict: true })
    expect(leaveCount()).toBe(0)

    await act(async () => {
      setSnapshot(SIGNED_OUT)
    })

    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("a signed-out open stays open, and the stored session fills it in", async () => {
    const renderer = await renderScreen({ strict: true })
    expect(hasExactText(renderer, NOT_SIGNED_IN)).toBe(true)
    expect(leaveCount()).toBe(0)

    await act(async () => {
      setSnapshot(SIGNED_IN)
    })

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(leaveCount()).toBe(0)
    await unmount(renderer)
  })
})
