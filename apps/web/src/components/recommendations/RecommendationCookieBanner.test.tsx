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
import { RecommendationCookieSettingsTrigger } from "./RecommendationCookieSettingsTrigger"

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

const activeProfile = {
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

const essentialOnlyProfile = {
  ...undecided,
  consentChoice: "essential_only",
  consentExpiresAt: "2027-02-23T00:00:00.000Z",
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
        <footer>
          <RecommendationCookieSettingsTrigger label="Cookie settings" />
        </footer>
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
  it("keeps the browser control deadline above the upstream profile budget", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(undecided)))

    renderShell()
    await flush()

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
  })

  it("defaults a first visit to personalization without rendering a banner", async () => {
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockResolvedValueOnce(response(activeProfile))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()

    expect(container.textContent).not.toContain("Your privacy choices")
    expect(button("Cookie settings")).toBeTruthy()
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      contractVersion: "recommendation-profile-v1",
      action: "grant",
    })
    expect(consentChanged).not.toHaveBeenCalled()
    expect(profileChanged).not.toHaveBeenCalled()
    window.removeEventListener(
      "forge:recommendation-consent-changed",
      consentChanged,
    )
    window.removeEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )
  })

  it("blocks Cookie settings mutations while the automatic grant is pending", async () => {
    let resolveGrant: ((value: Response) => void) | undefined
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
    act(() => button("Cookie settings").click())

    const save = button("Saving…")
    expect(save.disabled).toBe(true)
    act(() => save.click())
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveGrant?.(response(activeProfile))
      await pendingGrant
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("releases a pending automatic grant when another tab withdraws", async () => {
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
    let resolveGrant: ((value: Response) => void) | undefined
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
      cookieDisposition: "keep",
      consentChoice: "personalization",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockReturnValueOnce(pendingGrant)
      .mockResolvedValueOnce(response(active))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    expect(button("Saving…").disabled).toBe(true)

    await act(async () =>
      channel.onmessage?.({
        data: { type: "withdrawal_pending", choice: "essential_only" },
      }),
    )
    await flush()

    expect(button("Save choices").disabled).toBe(false)
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      resolveGrant?.(response(activeProfile))
      await pendingGrant
    })
  })

  it("aborts initialization before an unmounted shell can issue a stale grant", async () => {
    let resolveStatus: ((value: Response) => void) | undefined
    const pendingStatus = new Promise<Response>((resolve) => {
      resolveStatus = resolve
    })
    const fetchMock = vi.fn().mockReturnValueOnce(pendingStatus)
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal

    act(() => root.render(<></>))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolveStatus?.(response(undecided))
      await pendingStatus
    })
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("shows the defaulted optional choice in Cookie settings and persists nothing when cancelled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockResolvedValueOnce(response(activeProfile))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    const manage = button("Cookie settings")
    manage.focus()
    act(() => manage.click())

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.textContent).toContain("Essential cookies")
    expect(container.textContent).toContain("Always active")
    const personalization = container.querySelector<HTMLInputElement>(
      'input[name="recommendation-personalization"]',
    )!
    expect(personalization.checked).toBe(true)

    const dialog = container.querySelector('[role="dialog"]')
    const viewport = container.querySelector(
      '[data-testid="recommendation-cookie-settings-viewport"]',
    )
    expect(viewport?.className).toContain("overflow-y-auto")
    expect(dialog?.parentElement).toBe(viewport)
    expect(dialog?.className).toContain("m-auto")
    expect(dialog?.className).toContain("shrink-0")
    expect(dialog?.className).not.toContain("overflow-y-auto")
    expect(dialog?.className).not.toContain("max-h-")
    expect(document.body.style.overflow).toBe("hidden")

    act(() => button("Cancel").click())
    expect(document.body.style.overflow).toBe("")
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(manage)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain("Your privacy choices")
  })

  it("automatically grants personalization and Cookie settings can later withdraw it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockResolvedValueOnce(response(activeProfile))
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
    const essential = {
      ...undecided,
      consentChoice: "essential_only",
      consentExpiresAt: "2027-02-23T00:00:00.000Z",
      consentCookieDisposition: "set",
      erasureState: "completed",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(activeProfile))
      .mockRejectedValueOnce(new Error("ambiguous withdrawal"))
      .mockResolvedValueOnce(response(activeProfile))
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

  it("keeps Cookie settings in document flow", async () => {
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
    expect(settings.closest("footer")).toBeTruthy()
    expect(settings.className).not.toContain("fixed")
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

  it("keeps Cookie settings available without restoring the banner when automatic grant fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(undecided))
        .mockRejectedValueOnce(new Error("offline")),
    )

    renderShell()
    await flush()

    expect(container.textContent).not.toContain("Your privacy choices")
    expect(button("Cookie settings")).toBeTruthy()
    act(() => button("Cookie settings").click())
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
    ).toBe(false)
    expect(container.textContent).toContain(
      "Personalization could not be enabled. Essential only remains available.",
    )
  })

  it("retries a transient automatic grant failure without requiring a reload", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(undecided))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(activeProfile))
    vi.stubGlobal("fetch", fetchMock)

    try {
      renderShell()
      await flush()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await act(async () => vi.advanceTimersByTime(500))
      await flush()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      act(() => button("Cookie settings").click())
      expect(
        container.querySelector<HTMLInputElement>(
          'input[name="recommendation-personalization"]',
        )?.checked,
      ).toBe(true)
      expect(container.textContent).not.toContain(
        "Personalization could not be enabled. Essential only remains available.",
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("coalesces repeated choice clicks while the first transition is pending", async () => {
    let resolveGrant: ((value: Response) => void) | null = null
    const pendingGrant = new Promise<Response>((resolve) => {
      resolveGrant = resolve
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(essentialOnlyProfile))
      .mockReturnValueOnce(pendingGrant)
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    act(() =>
      container
        .querySelector<HTMLInputElement>(
          'input[name="recommendation-personalization"]',
        )
        ?.click(),
    )
    act(() => {
      button("Save choices").click()
      button("Save choices").click()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveGrant?.(response(activeProfile))
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(essentialOnlyProfile))
      .mockReturnValueOnce(pendingGrant)
      .mockResolvedValueOnce(response(activeProfile))
    vi.stubGlobal("fetch", fetchMock)

    renderShell()
    await flush()
    act(() => button("Cookie settings").click())
    act(() =>
      container
        .querySelector<HTMLInputElement>(
          'input[name="recommendation-personalization"]',
        )
        ?.click(),
    )
    act(() => button("Save choices").click())
    act(() => {
      channel.onmessage?.()
      channel.onmessage?.()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveGrant?.(response(activeProfile))
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
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(response(active)),
    )
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
    expect(document.cookie).not.toContain(
      "forge_recommendation_withdrawal_pending=1",
    )
    await act(async () =>
      channel.onmessage?.({
        data: { type: "choice_changed", choice: "personalization" },
      }),
    )
    await flush()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect({
      checked: container.querySelector<HTMLInputElement>(
        'input[name="recommendation-personalization"]',
      )?.checked,
      erasurePending: container.textContent?.includes(
        "Profile erasure is pending. Contextual recommendations are already active.",
      ),
      loadError: container.textContent?.includes(
        "Your choice could not be loaded. You can still choose below.",
      ),
      actions: fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(String(init?.body)).action,
      ),
    }).toEqual({
      checked: true,
      erasurePending: false,
      loadError: false,
      actions: ["status", "status", "status"],
    })
    window.removeEventListener(
      "forge:recommendation-profile-changed",
      profileChanged,
    )
  })
})
