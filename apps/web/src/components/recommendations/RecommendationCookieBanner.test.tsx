/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import englishMessages from "../../../messages/en.json"
import {
  clearRecommendationWithdrawalPending,
  markRecommendationWithdrawalPending,
} from "@/lib/recommendation-withdrawal-pending"
import { RecommendationConsentShell } from "./RecommendationConsentShell"

let container: HTMLDivElement
let root: Root

const undecided = {
  state: "session_only",
  choice: "session_only",
  privacyGeneration: null,
  expiresAt: null,
  erasureState: null,
  cookieDisposition: "clear",
  consentChoice: "undecided",
  consentContractVersion: "recommendation-consent-v1",
  consentExpiresAt: null,
  consentCookieDisposition: "keep",
}

function response(profile: Record<string, unknown>) {
  return new Response(JSON.stringify({ profile }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  )!
}

function renderShell() {
  act(() =>
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          RecommendationConsent: englishMessages.RecommendationConsent,
        }}
      >
        <RecommendationConsentShell />
      </NextIntlClientProvider>,
    ),
  )
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  clearRecommendationWithdrawalPending()
  vi.unstubAllGlobals()
})

describe("RecommendationConsentShell", () => {
  it("shows the three-action first-visit banner and Essential only dismisses it while settings remain", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockResolvedValueOnce(
        response({
          ...undecided,
          consentChoice: "essential_only",
          consentExpiresAt: "2027-02-23T00:00:00.000Z",
          consentCookieDisposition: "set",
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    expect(container.textContent).toContain("Your privacy choices")
    expect(button("Accept all")).toBeTruthy()
    expect(button("Essential only")).toBeTruthy()
    expect(button("Manage choices")).toBeTruthy()

    await act(async () => button("Essential only").click())
    await flush()

    expect(container.textContent).not.toContain("Your privacy choices")
    expect(button("Cookie settings")).toBeTruthy()
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      contractVersion: "recommendation-profile-v1",
      action: "withdraw",
    })
  })

  it("defaults the optional choice on in Manage choices but persists nothing when cancelled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(undecided))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    const manage = button("Manage choices")
    manage.focus()
    act(() => manage.click())

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain("Essential cookies")
    expect(container.textContent).toContain("Always active")
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!
    expect(personalization.checked).toBe(true)

    act(() => button("Cancel").click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(manage)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Your privacy choices")
  })

  it("Accept all grants personalization and Cookie settings can later withdraw it", async () => {
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "set",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(
        response({
          ...undecided,
          consentChoice: "essential_only",
          consentExpiresAt: "2027-02-23T00:00:00.000Z",
          consentCookieDisposition: "set",
          erasureState: "pending",
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    await act(async () => button("Accept all").click())
    await flush()
    expect(container.textContent).not.toContain("Your privacy choices")

    act(() => button("Cookie settings").click())
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!
    expect(personalization.checked).toBe(true)
    act(() => personalization.click())
    await act(async () => button("Save choices").click())
    await flush()

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      contractVersion: "recommendation-profile-v1",
      action: "withdraw",
    })
    act(() => button("Cookie settings").click())
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
  })

  it("fails a withdrawal closed to contextual mode and keeps a durable retry available", async () => {
    const channel: {
      onmessage: ((event: { data?: unknown }) => void) | null
      postMessage: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(function () {
        return channel
      }),
    )
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "set",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
    }
    const essential = {
      ...undecided,
      consentChoice: "essential_only",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
      erasureState: "completed",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(active))
      .mockRejectedValueOnce(new Error("ambiguous withdrawal"))
      .mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response(essential))
    vi.stubGlobal("fetch", fetchMock)
    const consentChanged = vi.fn()
    const profileChanged = vi.fn()
    window.addEventListener(
      "forge:recommendation-consent-changed",
      consentChanged,
    )
    window.addEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!
    act(() => personalization.click())
    await act(async () => button("Save choices").click())
    await flush()

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(personalization.checked).toBe(false)
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    expect(container.textContent).toContain(
      "Your choice could not be saved. Please try again.",
    )
    expect(consentChanged).toHaveBeenCalledOnce()
    expect(profileChanged).toHaveBeenCalledOnce()
    expect(document.cookie).toContain(
      "forge_recommendation_withdrawal_pending=1",
    )

    await act(async () =>
      channel.onmessage?.({ data: { type: "choice_changed" } }),
    )
    await flush()

    expect(personalization.checked).toBe(false)
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    expect(document.cookie).toContain(
      "forge_recommendation_withdrawal_pending=1",
    )

    await act(async () => button("Save choices").click())
    await flush()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(document.cookie).not.toContain(
      "forge_recommendation_withdrawal_pending=1",
    )

    window.removeEventListener(
      "forge:recommendation-consent-changed",
      consentChanged,
    )
    window.removeEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )
  })

  it("keeps a saved final choice across reload while settings remain reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...undecided,
          consentChoice: "essential_only",
          consentExpiresAt: "2027-02-23T00:00:00.000Z",
          consentCookieDisposition: "keep",
        }),
      ),
    )

    renderShell()
    await flush()

    expect(container.textContent).not.toContain("Your privacy choices")
    expect(button("Cookie settings")).toBeTruthy()
  })

  it("pins Cookie settings clear of the feedback launcher and below its modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          ...undecided,
          consentChoice: "essential_only",
          consentExpiresAt: "2027-02-23T00:00:00.000Z",
          consentCookieDisposition: "keep",
        }),
      ),
    )

    renderShell()
    await flush()

    const settings = button("Cookie settings")
    expect(settings.className).toContain(
      "bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))]",
    )
    expect(settings.className).toContain(
      "left-[calc(1rem+env(safe-area-inset-left,0px))]",
    )
    expect(settings.className).toContain("z-[45]")
  })

  it("keeps a persisted pending withdrawal contextual until a fresh grant is confirmed", async () => {
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 2,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "set",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
    }
    markRecommendationWithdrawalPending()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response(active))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!

    expect(personalization.checked).toBe(false)
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    act(() => personalization.click())
    await act(async () => button("Save choices").click())
    await flush()

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      contractVersion: "recommendation-profile-v1",
      action: "grant",
    })
    expect(document.cookie).not.toContain(
      "forge_recommendation_withdrawal_pending=1",
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it("does not treat an undecided status as proof that pending erasure completed", async () => {
    markRecommendationWithdrawalPending()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(undecided)))

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    expect(document.cookie).toContain(
      "forge_recommendation_withdrawal_pending=1",
    )
  })

  it("keeps the banner open and Essential only available when Accept all fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(undecided))
        .mockRejectedValueOnce(new Error("offline")),
    )

    renderShell()
    await flush()
    await act(async () => button("Accept all").click())
    await flush()

    expect(container.textContent).toContain("Your privacy choices")
    expect(container.textContent).toContain(
      "Personalization could not be enabled. Essential only remains available.",
    )
    expect(button("Essential only").disabled).toBe(false)
  })

  it("coalesces repeated choice clicks while the first transition is pending", async () => {
    let resolveGrant: ((value: Response) => void) | null = null
    const pendingGrant = new Promise<Response>((resolve) => {
      resolveGrant = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockReturnValueOnce(pendingGrant)
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => {
      button("Accept all").click()
      button("Accept all").click()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveGrant?.(
        response({
          ...undecided,
          state: "active",
          choice: "durable_allowed",
          privacyGeneration: 1,
          expiresAt: "2027-02-23T00:00:00.000Z",
          erasureState: "not_required",
          cookieDisposition: "set",
          consentChoice: "personalization",
          consentExpiresAt: "2027-02-23T00:00:00.000Z",
          consentCookieDisposition: "set",
        }),
      )
      await pendingGrant
    })
    await flush()
  })

  it("refreshes consent from the server when another tab broadcasts a change", async () => {
    const channel: {
      onmessage: (() => void) | null
      postMessage: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    const BroadcastChannelStub = vi.fn(function () {
      return channel
    })
    vi.stubGlobal("BroadcastChannel", BroadcastChannelStub)
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
    }
    const essential = {
      ...undecided,
      consentChoice: "essential_only",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(active))
        .mockResolvedValueOnce(response(essential)),
    )
    const profileChanged = vi.fn()
    window.addEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(true)
    await act(async () => channel.onmessage?.())
    await flush()

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(profileChanged).toHaveBeenCalledOnce()
    window.removeEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )
  })

  it("fences an older status response from overwriting a newer local withdrawal", async () => {
    const channel: {
      onmessage: (() => void) | null
      postMessage: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(function () {
        return channel
      }),
    )
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "keep",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
    }
    const essential = {
      ...undecided,
      consentChoice: "essential_only",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
    }
    let resolveStaleStatus: ((value: Response) => void) | null = null
    const staleStatus = new Promise<Response>((resolve) => {
      resolveStaleStatus = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(active))
      .mockReturnValueOnce(staleStatus)
      .mockResolvedValueOnce(response(essential))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    act(() => channel.onmessage?.())
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!
    act(() => personalization.click())
    await act(async () => button("Save choices").click())
    await flush()
    await act(async () => {
      resolveStaleStatus?.(response(active))
      await staleStatus
    })
    await flush()

    act(() => button("Cookie settings").click())
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("coalesces broadcasts during a mutation into one authoritative refresh", async () => {
    const channel: {
      onmessage: (() => void) | null
      postMessage: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(function () {
        return channel
      }),
    )
    let resolveGrant: ((value: Response) => void) | null = null
    const pendingGrant = new Promise<Response>((resolve) => {
      resolveGrant = resolve
    })
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "set",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockReturnValueOnce(pendingGrant)
      .mockResolvedValueOnce(response(active))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Accept all").click())
    act(() => {
      channel.onmessage?.()
      channel.onmessage?.()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveGrant?.(response(active))
      await pendingGrant
    })
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(container.textContent).not.toContain("Your privacy choices")
  })

  it("fails another tab closed while an ambiguous withdrawal is pending", async () => {
    const channel: {
      onmessage: ((event: { data?: unknown }) => void) | null
      postMessage: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    }
    vi.stubGlobal(
      "BroadcastChannel",
      vi.fn(function () {
        return channel
      }),
    )
    const active = {
      ...undecided,
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 1,
      expiresAt: "2027-02-23T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "keep",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
    }
    const fetchMock = vi.fn().mockResolvedValue(response(active))
    vi.stubGlobal("fetch", fetchMock)
    const profileChanged = vi.fn()
    window.addEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    await act(async () =>
      channel.onmessage?.({
        data: { type: "withdrawal_pending", choice: "essential_only" },
      }),
    )
    await flush()

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(container.textContent).toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    expect(profileChanged).toHaveBeenCalledOnce()

    clearRecommendationWithdrawalPending()
    await act(async () =>
      channel.onmessage?.({
        data: { type: "choice_changed", choice: "personalization" },
      }),
    )
    await flush()

    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(true)
    expect(container.textContent).not.toContain(
      "Profile erasure is pending. Contextual recommendations are already active.",
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    window.removeEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )
  })
})
