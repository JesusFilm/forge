/**
 * @vitest-environment jsdom
 */

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readWatchAccountSession,
  SESSION_READ_TIMEOUT_MS,
  useWatchAccountSession,
  watchAccountAuthUrl,
  watchAccountReturnTo,
} from "./use-watch-account-session"

const LOGIN_URL = `${window.location.origin}/watch/api/auth/login?returnTo=%2Fwatch`

function stubSession(body: unknown, init: ResponseInit = {}) {
  const fetchMock = vi.fn(async () => Response.json(body, init))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  window.history.replaceState(null, "", "/watch/jesus.html?as=partner#top")
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("readWatchAccountSession", () => {
  it("asks the same-origin session route, uncached, with the current page as the callback", async () => {
    const fetchMock = stubSession({
      accountGateEnabled: true,
      authenticated: false,
      loginUrl: LOGIN_URL,
    })
    const controller = new AbortController()

    await readWatchAccountSession(controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    const requested = new URL(url)
    expect(requested.origin).toBe(window.location.origin)
    expect(requested.pathname).toBe("/watch/api/auth/session")
    expect(requested.searchParams.get("callbackURL")).toBe(
      "/watch/jesus.html?as=partner#top",
    )
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
  })

  it("treats `authenticated: true` as signed in whether or not the account gate is on", async () => {
    for (const accountGateEnabled of [true, false]) {
      stubSession({
        accountGateEnabled,
        authenticated: true,
        user: { id: "u1", email: "a@example.org", name: "Ada" },
      })
      await expect(readWatchAccountSession()).resolves.toEqual({
        status: "signed-in",
        user: { id: "u1", email: "a@example.org", name: "Ada" },
      })
    }
  })

  it("treats `authenticated: false` as signed out whether or not the account gate is on, keeping the server's login URL", async () => {
    for (const accountGateEnabled of [true, false]) {
      stubSession({
        accountGateEnabled,
        authenticated: false,
        loginUrl: LOGIN_URL,
      })
      await expect(readWatchAccountSession()).resolves.toEqual({
        status: "signed-out",
        loginUrl: LOGIN_URL,
      })
    }
  })

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "authenticated"],
    ["an empty object", {}],
    ["a string flag", { accountGateEnabled: true, authenticated: "true" }],
    ["a missing authenticated flag", { accountGateEnabled: true }],
    ["a missing gate flag", { authenticated: true }],
    [
      "a signed-out response that carries a user",
      { accountGateEnabled: true, authenticated: false, user: { id: "u1" } },
    ],
    [
      "a user with a non-string field",
      { accountGateEnabled: true, authenticated: true, user: { name: 7 } },
    ],
    [
      "a user that is not an object",
      { accountGateEnabled: true, authenticated: true, user: "Ada" },
    ],
  ])("locks on %s instead of guessing", async (_label, body) => {
    stubSession(body)
    await expect(readWatchAccountSession()).resolves.toEqual({
      status: "unavailable",
    })
  })

  it.each([401, 500, 503])("locks on a %i response", async (status) => {
    stubSession({ accountGateEnabled: true, authenticated: true }, { status })
    await expect(readWatchAccountSession()).resolves.toEqual({
      status: "unavailable",
    })
  })

  it("locks when the request fails or the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network")
      }),
    )
    await expect(readWatchAccountSession()).resolves.toEqual({
      status: "unavailable",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 200 })),
    )
    await expect(readWatchAccountSession()).resolves.toEqual({
      status: "unavailable",
    })
  })
})

describe("session read timeout", () => {
  function hangingFetch() {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          )
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it("gives up on a hung read and locks, instead of waiting forever", async () => {
    vi.useFakeTimers()
    const fetchMock = hangingFetch()
    let answer: unknown = "pending"
    void readWatchAccountSession().then((value) => {
      answer = value
    })
    await vi.advanceTimersByTimeAsync(SESSION_READ_TIMEOUT_MS - 1)
    expect(answer).toBe("pending")
    await vi.advanceTimersByTimeAsync(1)
    expect(answer).toEqual({ status: "unavailable" })
    const init = fetchMock.mock.calls[0]![1]
    expect(init.signal!.aborted).toBe(true)
  })

  it("still honors the caller's abort", async () => {
    hangingFetch()
    const controller = new AbortController()
    const read = readWatchAccountSession(controller.signal)
    controller.abort()
    await expect(read).resolves.toEqual({ status: "unavailable" })
  })

  it("ends a hung focus re-read so held writes are released, and Try again reads again", async () => {
    vi.useFakeTimers()
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    const signedIn = {
      accountGateEnabled: true,
      authenticated: true,
      user: { id: "user-a" },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(signedIn)),
    )
    const seen: Array<ReturnType<typeof useWatchAccountSession>> = []
    function Probe() {
      seen.push(useWatchAccountSession())
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(createElement(Probe)))
    try {
      expect(seen.at(-1)).toMatchObject({ session: { status: "signed-in" } })

      hangingFetch()
      act(() => window.dispatchEvent(new Event("focus")))
      expect(seen.at(-1)!.revalidating).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_READ_TIMEOUT_MS)
      })
      expect(seen.at(-1)).toMatchObject({
        session: { status: "unavailable" },
        revalidating: false,
      })

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(signedIn)),
      )
      await act(async () => seen.at(-1)!.retry())
      expect(seen.at(-1)).toMatchObject({
        session: { status: "signed-in", user: { id: "user-a" } },
        revalidating: false,
      })
    } finally {
      act(() => root.unmount())
    }
  })
})

describe("watchAccountReturnTo", () => {
  it("returns the current page, query and hash", () => {
    expect(watchAccountReturnTo()).toBe("/watch/jesus.html?as=partner#top")
  })

  it("drops the sign-in failure markers but keeps every other query parameter", () => {
    window.history.replaceState(
      null,
      "",
      "/watch/jesus.html?as=partner&auth=failed&reason=invalid_state&t=12",
    )
    expect(watchAccountReturnTo()).toBe("/watch/jesus.html?as=partner&t=12")
  })
})

describe("watchAccountAuthUrl", () => {
  it("builds the hosted login URL with the page to come back to", () => {
    const url = new URL(watchAccountAuthUrl("login"))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe("/watch/api/auth/login")
    expect(url.searchParams.get("returnTo")).toBe(
      "/watch/jesus.html?as=partner#top",
    )
  })

  it("keeps the server's login URL but replaces its stale return target with the current page", () => {
    const stale = `${window.location.origin}/watch/api/auth/login?returnTo=%2Fwatch%2Fold.html`
    const url = new URL(watchAccountAuthUrl("login", stale))
    expect(url.pathname).toBe("/watch/api/auth/login")
    expect(url.searchParams.getAll("returnTo")).toEqual([
      "/watch/jesus.html?as=partner#top",
    ])
  })

  it("builds the logout URL with the same return target", () => {
    const url = new URL(watchAccountAuthUrl("logout"))
    expect(url.pathname).toBe("/watch/api/auth/logout")
    expect(url.searchParams.get("returnTo")).toBe(
      "/watch/jesus.html?as=partner#top",
    )
  })
})

describe("useWatchAccountSession", () => {
  it("reports a focus re-read as revalidating until its answer lands", async () => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    const answers: Array<(body: unknown) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answers.push((body) => resolve(Response.json(body)))
          }),
      ),
    )
    const seen: Array<ReturnType<typeof useWatchAccountSession>> = []
    function Probe() {
      seen.push(useWatchAccountSession())
      return null
    }
    const container = document.createElement("div")
    const root = createRoot(container)
    act(() => root.render(createElement(Probe)))
    const signedIn = (id: string) => ({
      accountGateEnabled: true,
      authenticated: true,
      user: { id },
    })
    await act(async () => answers[0]!(signedIn("user-a")))
    expect(seen.at(-1)).toMatchObject({
      session: { status: "signed-in", user: { id: "user-a" } },
      revalidating: false,
    })

    // Back to the tab after another tab switched accounts; the read is slow.
    act(() => window.dispatchEvent(new Event("focus")))
    expect(answers).toHaveLength(2)
    expect(seen.at(-1)).toMatchObject({
      session: { status: "signed-in", user: { id: "user-a" } },
      revalidating: true,
    })
    await act(async () => answers[1]!(signedIn("user-b")))
    expect(seen.at(-1)).toMatchObject({
      session: { status: "signed-in", user: { id: "user-b" } },
      revalidating: false,
    })
    act(() => root.unmount())
  })
})
