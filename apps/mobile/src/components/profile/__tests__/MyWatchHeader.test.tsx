// tsconfig maps `react` to its .d.ts, and jest-expo copies that mapping into
// jest, so the mocks below re-point `react` at the real package (apps/mobile
// CLAUDE.md, "Component render tests").

// No @types/node here (KTD11 forbids new test deps). A `declare const require`
// binding would trip babel-plugin-jest-hoist, so the ambient global is cast at
// each use to a shared type-only import (erased at runtime — hoist-safe).
jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  // `react/package.json` escapes the `^react$` mapping and finds the package.
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
// Ionicons requires native font modules at import time under jest. The mock
// logs each icon it renders, so a case can prove that no render drew an icon.
const mockIconRenders: string[] = []
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => {
    mockIconRenders.push(name)
    return null
  },
}))
// A named component, so a case can find the mask as an ancestor node.
jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplayView: {
    MaskAll: function MockMaskAll({ children }: { children?: unknown }) {
      return children
    },
  },
}))
const mockRouter = { navigate: jest.fn(), push: jest.fn() }
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
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
    // it cannot render into a later case's icon log.
    __resetSnapshot: (next: unknown) => {
      listeners.clear()
      snapshot = next
    },
  }
})
// jest-expo sets __DEV__ to true, so the real gate is open in every suite. This
// holder lets a case close it and counts the reads. Each case starts open.
const mockSignInGate = { open: true, calls: 0 }
jest.mock("../../../lib/signInGate", () => ({
  isSignInAvailable: () => {
    mockSignInGate.calls += 1
    return mockSignInGate.open
  },
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type TextStyle } from "react-native"
import { SessionReplayView } from "@datadog/mobile-react-native-session-replay"

import { MyWatchHeader } from "../MyWatchHeader"
import {
  signInWithHostedPage,
  type SignInOutcome,
} from "../../../lib/authActions"
import {
  clearAccountDeletedNotice,
  getAccountDeletedNotice,
  noteAccountDeleted,
} from "../../../lib/accountDeletedNotice"
import {
  clearNewAccountNotice,
  getNewAccountNotice,
  noteAccountCreated,
} from "../../../lib/newAccountNotice"
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
} from "../../../test-utils/rnTestRenderer"

const mockedSignIn = jest.mocked(signInWithHostedPage)
const { __setSnapshot: setSnapshot, __resetSnapshot: resetSnapshot } =
  jest.requireMock("../../../lib/authSession") as {
    __setSnapshot: (next: unknown) => void
    __resetSnapshot: (next: unknown) => void
  }

const SIGNED_OUT = { status: "signedOut", user: null } as const
const SIGNED_IN = {
  status: "signedIn",
  user: { id: "user-a", name: "Test Person", email: "tester@example.com" },
} as const
// The Hide My Email case: no name, so the row falls back to the email.
const SIGNED_IN_NO_NAME = {
  status: "signedIn",
  user: { id: "user-b", name: "   ", email: "relay@privaterelay.appleid.com" },
} as const

const GATED_TITLE = "Sign in · coming soon"
const GATED_SUBTITLE = "Accounts are not available yet"
const GATED_LABEL = "Sign in, coming soon, Accounts are not available yet"
const LIVE_TITLE = "Sign in"
const LIVE_SUBTITLE = "Keep your place across devices"
const ACCOUNT_LABEL = "Account"
const DELETED_TEXT = "Your account was deleted"
const NEW_ACCOUNT_TEXT = "This is a new account"

async function renderHeader(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<MyWatchHeader />)
  })
  return renderer
}

async function renderSignedOut(): Promise<TestInstance> {
  const renderer = await renderHeader()
  expect(hasText(renderer, "Sign in")).toBe(true)
  return renderer
}

/** `hasText` matches substrings, and "Sign in" is inside the gated title. */
function hasExactText(renderer: TestInstance, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.props.children === text).length > 0
  )
}

function firstWhere(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode {
  const matches = renderer.root.findAll(predicate)
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

function styleOf(node: RenderedNode): TextStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {}
}

/** Pre-order position of the first node that matches, or -1. */
function treeIndex(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): number {
  return renderer.root.findAll(() => true).findIndex(predicate)
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

function accountRow(renderer: TestInstance): RenderedNode {
  return firstWhere(
    renderer,
    (node) => node.props["dd-action-name"] === "my-watch-account",
  )
}

beforeEach(() => {
  mockedSignIn.mockReset()
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockSignInGate.open = true
  mockSignInGate.calls = 0
  mockIconRenders.length = 0
  clearNewAccountNotice()
  clearAccountDeletedNotice()
  resetSnapshot(SIGNED_OUT)
})

describe("MyWatchHeader hosted-auth wiring (feat-349 U3)", () => {
  it("keeps the existing dd-action-name on the signed-out Sign in card", async () => {
    const renderer = await renderSignedOut()
    const cta = pressableByLabel(renderer, "Sign in")
    expect(cta.props["dd-action-name"]).toBe("profile-sign-in")
    await unmount(renderer)
  })

  it("gate open, signed out: shows Guest over the live Sign in card (R3)", async () => {
    const renderer = await renderHeader()

    expect(hasExactText(renderer, "Guest")).toBe(true)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(true)
    expect(hasText(renderer, LIVE_SUBTITLE)).toBe(true)
    expect(
      treeIndex(renderer, (node) => node.props.children === "Guest"),
    ).toBeLessThan(
      treeIndex(
        renderer,
        (node) => node.props.accessibilityLabel === "Sign in",
      ),
    )
    await unmount(renderer)
  })

  it("a tap during an in-flight attempt does not launch a second flow", async () => {
    let resolveFlight!: (outcome: SignInOutcome) => void
    mockedSignIn.mockReturnValue(
      new Promise<SignInOutcome>((resolve) => {
        resolveFlight = resolve
      }),
    )
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))
    expect(hasText(renderer, "Signing in…")).toBe(true)
    // Second tap invokes the handler directly, bypassing `disabled` — the
    // component-level busy guard must still make it a no-op.
    await press(pressableByLabel(renderer, "Sign in"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveFlight({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })

  it("a cancelled attempt returns quietly to the idle card (R2)", async () => {
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))

    expect(hasText(renderer, "Signing in…")).toBe(false)
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })

  it("a retryable error shows a dismissible notice under the header (AE6, R3)", async () => {
    mockedSignIn.mockResolvedValue({ status: "error" })
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))
    expect(hasText(renderer, "Something went wrong")).toBe(true)
    expect(
      treeIndex(
        renderer,
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.includes("Something went wrong"),
      ),
    ).toBeGreaterThan(
      treeIndex(
        renderer,
        (node) => node.props.accessibilityLabel === "Sign in",
      ),
    )

    // Dismissing returns to the idle card so the user can retry.
    await press(pressableByLabel(renderer, "Dismiss"))
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })

  it("two taps in ONE render cycle still launch only one flow (ref guard)", async () => {
    let resolveFlight!: (outcome: SignInOutcome) => void
    mockedSignIn.mockReturnValue(
      new Promise<SignInOutcome>((resolve) => {
        resolveFlight = resolve
      }),
    )
    const renderer = await renderSignedOut()
    const cta = pressableByLabel(renderer, "Sign in")

    // Both taps hit one captured node in one act, with no re-render between
    // them, so a state guard would read the stale idle closure twice. Only
    // the ref guard makes the second tap a no-op.
    await act(async () => {
      cta.props.onPress?.()
      cta.props.onPress?.()
    })

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveFlight({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })

  it("a rejected sign-in falls to the dismissible error, not a stuck card", async () => {
    // The card reserves busy state before the call; a rejection must release
    // it via the rejection handler, not pin the card on "Signing in…".
    mockedSignIn.mockRejectedValueOnce(new Error("open threw"))
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))

    expect(hasText(renderer, "Signing in…")).toBe(false)
    expect(hasText(renderer, "Something went wrong")).toBe(true)
    await press(pressableByLabel(renderer, "Dismiss"))
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })
})

// KTD6: each gated case closes the gate and keeps the person signed out, the
// one other condition that would show sign-in.
describe("MyWatchHeader sign-in gate (feat-543)", () => {
  /** WCAG 2.x relative luminance, as in src/lib/__tests__/tabBar.test.ts. */
  function luminance([r, g, b]: number[]): number {
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function ratio(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  function over(fg: number[], alpha: number, bg: number[]): number[] {
    return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]))
  }
  function rgbOf(hex: unknown): number[] {
    const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    if (!m) throw new Error(`not a #rrggbb value: ${String(hex)}`)
    return [m[1], m[2], m[3]].map((part) => parseInt(part, 16))
  }

  it("gate closed, signed out: shows Guest and the coming-soon card, not the live one (AE1, R2)", async () => {
    mockSignInGate.open = false
    const renderer = await renderHeader()

    expect(hasExactText(renderer, "Guest")).toBe(true)
    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)
    expect(hasExactText(renderer, GATED_SUBTITLE)).toBe(true)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(false)
    expect(hasText(renderer, LIVE_SUBTITLE)).toBe(false)
    expect(
      renderer.root.findAll((node) => node.props.name === "chevron-forward")
        .length,
    ).toBe(0)
    await unmount(renderer)
  })

  it("gate closed: the card is announced as disabled, and a tap starts nothing and opens nothing (AE1, R6, R2)", async () => {
    mockSignInGate.open = false
    const renderer = await renderHeader()
    // Found by label: pressableByLabel needs an onPress, which this card lacks.
    const card = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === GATED_LABEL,
    )

    expect(card.length).toBeGreaterThan(0)
    expect(card[0].props.disabled).toBe(true)
    expect(card[0].props.accessibilityState).toEqual({ disabled: true })
    expect(
      renderer.root.findAll((node) => node.props["dd-action-name"] != null)
        .length,
    ).toBe(0)
    expect(
      renderer.root.findAll((node) => typeof node.props.onPress === "function")
        .length,
    ).toBe(0)
    for (const node of card) await press(node)
    expect(mockedSignIn).not.toHaveBeenCalled()
    expect(mockRouter.navigate).not.toHaveBeenCalled()
    expect(mockRouter.push).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("gate closed: dims the title, not the subtitle or the avatar (R5)", async () => {
    mockSignInGate.open = false
    const renderer = await renderHeader()
    const avatarIcon = firstWhere(
      renderer,
      (node) => node.props.name === "person",
    )
    const title = firstWhere(
      renderer,
      (node) => node.props.children === GATED_TITLE,
    )
    const subtitle = firstWhere(
      renderer,
      (node) => node.props.children === GATED_SUBTITLE,
    )

    expect(styleOf(title).opacity).toBe(0.5)
    expect(styleOf(subtitle).opacity).toBeUndefined()
    expect(styleOf(avatarIcon).opacity).toBeUndefined()
    await unmount(renderer)
  })

  it("gate closed: the dimmed title keeps 4.5:1 on the card surface (R5)", async () => {
    mockSignInGate.open = false
    const renderer = await renderHeader()
    const card = styleOf(
      firstWhere(
        renderer,
        (node) => node.props.accessibilityLabel === GATED_LABEL,
      ),
    )
    const title = styleOf(
      firstWhere(renderer, (node) => node.props.children === GATED_TITLE),
    )
    const subtitle = styleOf(
      firstWhere(renderer, (node) => node.props.children === GATED_SUBTITLE),
    )
    const surface = rgbOf(card.backgroundColor)
    const dim = Number(title.opacity)

    expect(
      ratio(over(rgbOf(title.color), dim, surface), surface),
    ).toBeGreaterThanOrEqual(4.5)
    // The same dim drops the subtitle below the floor. This is why the
    // subtitle keeps full strength.
    expect(
      ratio(over(rgbOf(subtitle.color), dim, surface), surface),
    ).toBeLessThan(4.5)
    await unmount(renderer)
  })

  it("gate open, signed out: shows the live card and no gated copy (R11)", async () => {
    const renderer = await renderHeader()

    expect(hasExactText(renderer, LIVE_TITLE)).toBe(true)
    expect(hasText(renderer, LIVE_SUBTITLE)).toBe(true)
    expect(mockIconRenders).toContain("chevron-forward")
    expect(hasText(renderer, "coming soon")).toBe(false)
    expect(hasText(renderer, GATED_SUBTITLE)).toBe(false)
    const title = firstWhere(
      renderer,
      (node) => node.props.children === LIVE_TITLE,
    )
    expect(styleOf(title).opacity).toBeUndefined()
    await unmount(renderer)
  })

  it("gate closed, signed in: the Account row shows and the gate is never read (AE5, R8)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(pressableByLabel(renderer, ACCOUNT_LABEL).props.disabled).not.toBe(
      true,
    )
    expect(hasText(renderer, "coming soon")).toBe(false)
    expect(hasText(renderer, GATED_SUBTITLE)).toBe(false)
    expect(mockSignInGate.calls).toBe(0)
    await unmount(renderer)
  })

  it("gate closed: signing out shows the disabled card, never the live one (AE6, AE10)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()
    expect(pressableByLabel(renderer, ACCOUNT_LABEL)).toBeDefined()
    // The signed-in row draws a chevron too, so the log starts at sign-out.
    mockIconRenders.length = 0

    await act(async () => {
      setSnapshot(SIGNED_OUT)
    })

    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)
    expect(
      renderer.root.findAll(
        (node) => node.props.accessibilityLabel === ACCOUNT_LABEL,
      ).length,
    ).toBe(0)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(false)
    // Signed out, only the live card draws a chevron.
    expect(mockIconRenders).not.toContain("chevron-forward")
    await unmount(renderer)
  })

  it("gate closed, cold launch: the disabled card shows from the first render until the session read lands (AE8, AE9)", async () => {
    mockSignInGate.open = false
    const renderer = await renderHeader()

    // The log covers every render, the first one too. A gate that settles in
    // an effect draws the live card once, and that fails here.
    expect(mockIconRenders[0]).toBe("person")
    expect(mockIconRenders).not.toContain("chevron-forward")
    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)

    await act(async () => {
      setSnapshot(SIGNED_IN)
    })

    expect(pressableByLabel(renderer, ACCOUNT_LABEL)).toBeDefined()
    expect(hasText(renderer, "coming soon")).toBe(false)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(false)
    await unmount(renderer)
  })
})

describe("MyWatchHeader signed-in row (R4, R19, KTD10)", () => {
  it("shows the name, a chevron and no email, and a tap navigates to /account", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(hasText(renderer, SIGNED_IN.user.email)).toBe(false)
    expect(mockIconRenders).toContain("chevron-forward")
    expect(hasText(renderer, "Guest")).toBe(false)

    await press(pressableByLabel(renderer, ACCOUNT_LABEL))
    // KTD12: navigate, never push, so a double tap opens one screen.
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/account")
    expect(mockRouter.push).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("does not render Sign out or Delete account; those live on the Account screen", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()

    expect(hasText(renderer, "Sign out")).toBe(false)
    expect(hasText(renderer, "Delete account")).toBe(false)
    await unmount(renderer)
  })

  it("masks the name and the avatar initial in session replay (R19)", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()

    expect(textIsMasked(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(textIsMasked(renderer, "T")).toBe(true)
    await unmount(renderer)
  })

  it("with no name, shows the email inside the replay mask and a person avatar (R4, R19)", async () => {
    setSnapshot(SIGNED_IN_NO_NAME)
    const renderer = await renderHeader()

    expect(hasExactText(renderer, SIGNED_IN_NO_NAME.user.email)).toBe(true)
    expect(textIsMasked(renderer, SIGNED_IN_NO_NAME.user.email)).toBe(true)
    // The email does not feed the initial: the avatar falls back to an icon.
    expect(mockIconRenders).toContain("person")
    expect(hasExactText(renderer, "R")).toBe(false)
    await unmount(renderer)
  })

  it.each([
    ["with a name", SIGNED_IN],
    ["with no name", SIGNED_IN_NO_NAME],
  ])(
    "%s: the row's label and dd-action-name carry no name and no email (KTD10)",
    async (_, snapshot) => {
      setSnapshot(snapshot)
      const renderer = await renderHeader()
      const row = accountRow(renderer)

      expect(row.props.accessibilityLabel).toBe(ACCOUNT_LABEL)
      expect(row.props["dd-action-name"]).toBe("my-watch-account")
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
        expect(text).not.toContain(snapshot.user.email.toLowerCase())
        const name = snapshot.user.name.trim().toLowerCase()
        if (name) expect(text).not.toContain(name)
      }
      await unmount(renderer)
    },
  )
})

describe("MyWatchHeader notices (R4, R20)", () => {
  it("shows the new-account notice only for the account it names, and a dismiss clears it (R15)", async () => {
    setSnapshot(SIGNED_IN)
    noteAccountCreated("someone-else")
    const renderer = await renderHeader()
    expect(hasText(renderer, NEW_ACCOUNT_TEXT)).toBe(false)

    await act(async () => {
      noteAccountCreated(SIGNED_IN.user.id)
    })
    expect(hasText(renderer, NEW_ACCOUNT_TEXT)).toBe(true)
    expect(
      treeIndex(
        renderer,
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.startsWith(NEW_ACCOUNT_TEXT),
      ),
    ).toBeGreaterThan(
      treeIndex(
        renderer,
        (node) => node.props["dd-action-name"] === "my-watch-account",
      ),
    )

    await press(pressableByLabel(renderer, "Dismiss new account notice"))
    expect(hasText(renderer, NEW_ACCOUNT_TEXT)).toBe(false)
    expect(getNewAccountNotice()).toBeNull()
    await unmount(renderer)
  })

  it("after a deletion, shows the deleted notice under Guest as the sign-out lands (AE8)", async () => {
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()
    expect(hasText(renderer, DELETED_TEXT)).toBe(false)

    // deleteAccount() raises the notice, then its sign-out commits (KTD8).
    await act(async () => {
      noteAccountDeleted()
      setSnapshot(SIGNED_OUT)
    })

    expect(hasExactText(renderer, "Guest")).toBe(true)
    expect(hasText(renderer, DELETED_TEXT)).toBe(true)
    expect(
      treeIndex(
        renderer,
        (node) =>
          typeof node.props.children === "string" &&
          node.props.children.startsWith(DELETED_TEXT),
      ),
    ).toBeGreaterThan(
      treeIndex(
        renderer,
        (node) => node.props.accessibilityLabel === "Sign in",
      ),
    )
    await unmount(renderer)
  })

  it("shows the deleted notice under the gate-closed Guest state too", async () => {
    mockSignInGate.open = false
    noteAccountDeleted()
    const renderer = await renderHeader()

    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)
    expect(hasText(renderer, DELETED_TEXT)).toBe(true)
    await unmount(renderer)
  })

  it("dismissing the deleted notice hides it and clears the store", async () => {
    noteAccountDeleted()
    const renderer = await renderHeader()
    expect(hasText(renderer, DELETED_TEXT)).toBe(true)

    await press(pressableByLabel(renderer, "Dismiss account deleted notice"))

    expect(hasText(renderer, DELETED_TEXT)).toBe(false)
    expect(getAccountDeletedNotice()).toBe(false)
    await unmount(renderer)
  })

  it("never shows the deleted notice on the signed-in row", async () => {
    noteAccountDeleted()
    setSnapshot(SIGNED_IN)
    const renderer = await renderHeader()

    expect(hasText(renderer, DELETED_TEXT)).toBe(false)
    await unmount(renderer)
  })
})
