/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DOWNLOAD_RETURN_INTENT_PARAM,
  checkDownloadSession,
  withDownloadReturnIntent,
} from "@/components/watch/download-session-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkDownloadSession", () => {
  it("parses the dynamic account-gate mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: false,
          authenticated: false,
        }),
      ),
    )
    window.history.replaceState({}, "", "/watch/jesus.html/english.html")

    await expect(checkDownloadSession()).resolves.toEqual({
      ok: true,
      accountGateEnabled: false,
      authenticated: false,
    })
  })

  it("keeps loginUrl when the gate is enabled and the viewer is signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          accountGateEnabled: true,
          authenticated: false,
          loginUrl: "http://localhost:3000/watch/api/auth/login",
        }),
      ),
    )

    await expect(checkDownloadSession()).resolves.toEqual({
      ok: true,
      accountGateEnabled: true,
      authenticated: false,
      loginUrl: "http://localhost:3000/watch/api/auth/login",
    })
  })
})

describe("withDownloadReturnIntent", () => {
  it("adds the download reopen intent to the nested auth returnTo URL", () => {
    window.history.replaceState({}, "", "/watch/jesus.html/english.html?t=12")

    const result = withDownloadReturnIntent(
      "http://localhost:3000/watch/api/auth/login?returnTo=http%3A%2F%2Flocalhost%3A3000%2Fwatch%2Fjesus.html%2Fenglish.html%3Ft%3D12",
    )

    const loginUrl = new URL(result)
    expect(loginUrl.searchParams.get("prompt")).toBe("login")
    const returnTo = new URL(loginUrl.searchParams.get("returnTo") ?? "")
    expect(returnTo.pathname).toBe("/watch/jesus.html/english.html")
    expect(returnTo.searchParams.get("t")).toBe("12")
    expect(returnTo.searchParams.get(DOWNLOAD_RETURN_INTENT_PARAM)).toBe("1")
  })
})
