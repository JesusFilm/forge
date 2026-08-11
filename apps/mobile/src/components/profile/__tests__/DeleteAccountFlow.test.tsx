/**
 * Deletion re-auth auto-retry wiring (U4/KTD5): the component arms the
 * decidePostReauth helper with the captured id and the refreshed snapshot,
 * so the helper stays REAL here — only authActions/authSession are mocked.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
 */

// No @types/node here (KTD11 forbids new test deps) — type locally. A
// `declare const require` binding would trip babel-plugin-jest-hoist, so
// the ambient global is cast at each use instead.
type NodeRequireLike = {
  (id: string): unknown
  resolve: (request: string, options?: { paths?: string[] }) => string
}
type NodePath = {
  dirname: (p: string) => string
  join: (...parts: string[]) => string
}

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
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
  deleteAccount: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
  let snapshot: unknown = { status: "signedIn", user: { id: "user-a" } }
  return {
    getAuthSession: () => ({
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }),
    __setSnapshot: (next: unknown) => {
      snapshot = next
    },
  }
})

import { act, type ReactElement } from "react"

import {
  DELETE_FAILED_MESSAGE,
  DeleteAccountFlow,
  REAUTH_FAILED_MESSAGE,
  REAUTH_PROMPT_MESSAGE,
  WRONG_ACCOUNT_MESSAGE,
} from "../DeleteAccountFlow"
import type { DeleteAccountOutcome } from "../../../lib/accountDeletion"
import {
  deleteAccount,
  signInWithHostedPage,
  type SignInOutcome,
} from "../../../lib/authActions"

type RenderedNode = {
  props: {
    onPress?: () => void
    accessibilityLabel?: string
    disabled?: boolean
    children?: unknown
    [key: string]: unknown
  }
}
type TestInstance = {
  root: { findAll(predicate: (node: RenderedNode) => boolean): RenderedNode[] }
  unmount(): void
}
type TestRendererModule = {
  create(element: ReactElement): TestInstance
}

const nodeRequire = require as unknown as NodeRequireLike
const TestRenderer = nodeRequire(
  nodeRequire.resolve("react-test-renderer", {
    paths: [nodeRequire.resolve("jest-expo/package.json")],
  }),
) as TestRendererModule

const mockedSignIn = jest.mocked(signInWithHostedPage)
const mockedDelete = jest.mocked(deleteAccount)
const setSnapshot = (
  jest.requireMock("../../../lib/authSession") as {
    __setSnapshot: (next: unknown) => void
  }
).__setSnapshot

function pressableByLabel(renderer: TestInstance, label: string) {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

function hasText(renderer: TestInstance, needle: string): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        typeof node.props.children === "string" &&
        node.props.children.includes(needle),
    ).length > 0
  )
}

async function renderFlow(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DeleteAccountFlow />)
  })
  expect(hasText(renderer, "Delete account")).toBe(true)
  return renderer
}

async function unmount(renderer: TestInstance) {
  await act(async () => {
    renderer.unmount()
  })
}

async function press(node: RenderedNode) {
  await act(async () => {
    node.props.onPress?.()
  })
}

/** Entry → confirm → delete; the queued first outcome must be
 *  fresh-session-required so the flow lands in needsReauth. */
async function driveToNeedsReauth(renderer: TestInstance) {
  await press(pressableByLabel(renderer, "Delete account"))
  await press(pressableByLabel(renderer, "Permanently delete account"))
  expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)
}

beforeEach(() => {
  mockedSignIn.mockReset()
  mockedDelete.mockReset()
  setSnapshot({ status: "signedIn", user: { id: "user-a" } })
})

describe("DeleteAccountFlow re-auth auto-retry (U4)", () => {
  it("keeps the existing dd-action-name attributes", async () => {
    const renderer = await renderFlow()
    const entry = pressableByLabel(renderer, "Delete account")
    expect(entry.props["dd-action-name"]).toBe("delete-account-entry")
    await press(entry)
    const confirm = pressableByLabel(renderer, "Permanently delete account")
    expect(confirm.props["dd-action-name"]).toBe("delete-account-confirm")
    await unmount(renderer)
  })

  it("same-account re-auth auto-retries the deletion exactly once (AE4)", async () => {
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockResolvedValueOnce({ status: "deleted" })
    mockedSignIn.mockResolvedValue({ status: "success" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    expect(mockedDelete).toHaveBeenCalledTimes(1)

    await press(pressableByLabel(renderer, "Sign in again"))

    // Initial attempt + one auto-retry, nothing more.
    expect(mockedDelete).toHaveBeenCalledTimes(2)
    // The retry deleted the account: back to the idle entry row.
    expect(hasText(renderer, "Delete account")).toBe(true)
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(false)
    await unmount(renderer)
  })

  it("different-account re-auth never retries and explains (AE7)", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementation(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-b" } })
      return { status: "success" }
    })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, WRONG_ACCOUNT_MESSAGE)).toBe(true)
    await unmount(renderer)
  })

  it("a cancelled sheet stays in needsReauth with no retry", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)
    expect(hasText(renderer, REAUTH_FAILED_MESSAGE)).toBe(false)
    await unmount(renderer)
  })

  it("a retryable sign-in failure shows copy distinct from the deletion-failure copy", async () => {
    expect(REAUTH_FAILED_MESSAGE).not.toBe(DELETE_FAILED_MESSAGE)
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "error" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, REAUTH_FAILED_MESSAGE)).toBe(true)
    expect(hasText(renderer, DELETE_FAILED_MESSAGE)).toBe(false)
    // Still retryable in place: the sign-in button remains.
    pressableByLabel(renderer, "Sign in again")
    await unmount(renderer)
  })

  it("wrong-account offers Try again, returns to needsReauth, and keeps the captured id", async () => {
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockResolvedValueOnce({ status: "deleted" })
    mockedSignIn.mockImplementationOnce(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-b" } })
      return { status: "success" }
    })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, WRONG_ACCOUNT_MESSAGE)).toBe(true)

    await press(pressableByLabel(renderer, "Try signing in again"))
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)

    // The ORIGINAL subject signs in this time: the captured id survived
    // the wrongAccount detour, so the deletion auto-retries.
    mockedSignIn.mockImplementationOnce(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-a" } })
      return { status: "success" }
    })
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(mockedDelete).toHaveBeenCalledTimes(2)
    await unmount(renderer)
  })

  it("a manual delete tap during an in-flight auto-retry is a no-op", async () => {
    let resolveRetry!: (outcome: DeleteAccountOutcome) => void
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockImplementationOnce(
        () =>
          new Promise<DeleteAccountOutcome>((resolve) => {
            resolveRetry = resolve
          }),
      )
    mockedSignIn.mockResolvedValue({ status: "success" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, "Deleting…")).toBe(true)

    // Direct onPress bypasses `disabled` — the ref guard must still hold.
    await press(pressableByLabel(renderer, "Permanently delete account"))
    expect(mockedDelete).toHaveBeenCalledTimes(2)

    resolveRetry({ status: "deleted" })
    await act(async () => {})
    expect(hasText(renderer, "Delete account")).toBe(true)
    await unmount(renderer)
  })

  it("a second Sign in again tap while the sheet is open does not relaunch", async () => {
    let resolveSignIn!: (outcome: SignInOutcome) => void
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementationOnce(
      () =>
        new Promise<SignInOutcome>((resolve) => {
          resolveSignIn = resolve
        }),
    )
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, "Signing in…")).toBe(true)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveSignIn({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })
})
