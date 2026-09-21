// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PushTestSendOutcome } from "@/services/push/campaign.service"

type ActionState = { status: "idle" }
type Action = (
  previous: ActionState,
  formData: FormData,
) => Promise<ActionState>

const idle: ActionState = { status: "idle" }
const sendNowAction = vi.fn<Action>(async () => idle)
const cancelCampaignAction = vi.fn<Action>(async () => idle)

vi.mock("../actions", () => ({
  sendTestAction: vi.fn<Action>(async () => idle),
  scheduleCampaignAction: vi.fn<Action>(async () => idle),
  sendNowAction: (previous: ActionState, formData: FormData) =>
    sendNowAction(previous, formData),
  cancelCampaignAction: (previous: ActionState, formData: FormData) =>
    cancelCampaignAction(previous, formData),
}))

import { CampaignActions } from "./campaign-actions"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

type Props = Parameters<typeof CampaignActions>[0]

function props(overrides: Partial<Props> = {}): Props {
  return {
    campaignId: "c1",
    tested: true,
    frozen: false,
    cancellable: false,
    campaignsEnabled: true,
    audience: 1234,
    unreachable: 7,
    countries: ["SA", "FR"],
    audienceScope: "COUNTRIES",
    sendDate: "",
    localHour: null,
    testOutcome: [],
    ...overrides,
  }
}

function outcome(
  overrides: Partial<PushTestSendOutcome> = {},
): PushTestSendOutcome {
  return {
    deliveryId: "d1",
    registrationId: "reg_1",
    testDeviceId: "ab12cd34ef",
    label: "Urim iPhone 15",
    status: "ACCEPTED",
    error: null,
    sentAt: new Date("2026-09-20T10:00:00Z"),
    ...overrides,
  }
}

function render(next: Props) {
  act(() => {
    root.render(<CampaignActions {...next} />)
  })
}

beforeEach(() => {
  sendNowAction.mockClear()
  cancelCampaignAction.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("CampaignActions gating", () => {
  it("names the untested state beside the schedule controls (AE11)", () => {
    render(props({ tested: false }))
    expect(
      container.querySelector('[data-testid="push-untested-notice"]'),
    ).not.toBeNull()
    // The control stays live, so the editor reads the service's own refusal.
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="push-schedule"]',
      )?.disabled,
    ).toBe(false)
  })

  it("drops the untested notice once a test send has run", () => {
    render(props({ tested: true }))
    expect(
      container.querySelector('[data-testid="push-untested-notice"]'),
    ).toBeNull()
  })

  it("hides test, schedule, and send now for a frozen campaign (R11)", () => {
    render(props({ frozen: true, cancellable: true }))
    expect(
      container.querySelector('[data-testid="push-frozen-actions"]'),
    ).not.toBeNull()
    expect(container.querySelector('[data-testid="push-send-test"]')).toBeNull()
    expect(container.querySelector('[data-testid="push-schedule"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="push-send-now-open"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="push-cancel-open"]'),
    ).not.toBeNull()
  })

  it("offers no cancel control when the campaign cannot be cancelled", () => {
    render(props({ cancellable: false }))
    expect(
      container.querySelector('[data-testid="push-cancel-open"]'),
    ).toBeNull()
  })

  it("names the kill switch when the push flag is off (KTD12)", () => {
    render(props({ campaignsEnabled: false }))
    expect(
      container.querySelector('[data-testid="push-flag-off"]'),
    ).not.toBeNull()
  })

  it("defaults the local hour to 09:00 (R9)", () => {
    render(props())
    expect(
      container.querySelector<HTMLSelectElement>(
        '[data-testid="push-local-hour"]',
      )?.value,
    ).toBe("9")
  })

  it("keeps a stored local hour rather than resetting it to the default", () => {
    render(props({ localHour: 18 }))
    expect(
      container.querySelector<HTMLSelectElement>(
        '[data-testid="push-local-hour"]',
      )?.value,
    ).toBe("18")
  })
})

describe("CampaignActions test-send outcome", () => {
  it("says no test send has run, which is not the same as a failed one", () => {
    render(props({ tested: false }))
    expect(
      container.querySelector('[data-testid="push-test-outcome-empty"]')
        ?.textContent,
    ).toContain("No test send has run yet")
  })

  it("shows the failed outcome per device with its provider code", () => {
    render(
      props({
        testOutcome: [
          outcome({ status: "FAILED", error: "DeviceNotRegistered" }),
        ],
      }),
    )
    const row = container.querySelector('[data-testid="push-test-outcome-row"]')
    expect(row?.getAttribute("data-status")).toBe("FAILED")
    expect(row?.textContent).toContain("Urim iPhone 15")
    expect(row?.textContent).toContain("DeviceNotRegistered")
    expect(
      container.querySelector('[data-testid="push-test-outcome-empty"]'),
    ).toBeNull()
  })

  it("shows an accepted outcome for the same phone", () => {
    render(props({ testOutcome: [outcome()] }))
    expect(
      container
        .querySelector('[data-testid="push-test-outcome-row"]')
        ?.getAttribute("data-status"),
    ).toBe("ACCEPTED")
  })

  it("falls back to the test ID when a device has no label", () => {
    render(props({ testOutcome: [outcome({ label: null })] }))
    expect(
      container.querySelector('[data-testid="push-test-outcome-row"]')
        ?.textContent,
    ).toContain("ab12cd34ef")
  })
})

describe("CampaignActions send-now confirmation", () => {
  it("shows the resolved count, the country list, and the night consequence", () => {
    render(props())
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-send-now-open"]')
        ?.click(),
    )
    const modal = container.querySelector(
      '[data-testid="push-send-now-confirm"]',
    )
    expect(modal?.textContent).toContain("1234 phone(s)")
    expect(modal?.textContent).toContain("SA, FR")
    expect(modal?.textContent).toContain("middle of their night")
    expect(modal?.textContent).toContain("7 phone(s)")
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="push-confirm-submit"]',
      )?.disabled,
    ).toBe(true)
  })

  it("names every country for an everywhere audience", () => {
    render(props({ audienceScope: "EVERYWHERE", countries: [] }))
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-send-now-open"]')
        ?.click(),
    )
    expect(
      container.querySelector('[data-testid="push-send-now-confirm"]')
        ?.textContent,
    ).toContain("every country")
  })

  it("dispatches the send with the campaign and the typed count (AE10)", async () => {
    render(props())
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-send-now-open"]')
        ?.click(),
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="push-confirm-input"]',
    )
    if (!input) throw new Error("no confirm input rendered")
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "1234")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-confirm-submit"]')
        ?.click()
    })

    expect(sendNowAction).toHaveBeenCalledTimes(1)
    const form = sendNowAction.mock.calls[0]?.[1] as FormData
    expect(form.get("campaignId")).toBe("c1")
    expect(form.get("confirmCount")).toBe("1234")
    // The confirmation closes once the send is dispatched.
    expect(
      container.querySelector('[data-testid="push-send-now-confirm"]'),
    ).toBeNull()
  })

  // Without the startTransition around the dispatch, React never moves
  // isPending and this button keeps reading "Send now everywhere".
  it("shows the send as pending while the action is in flight", async () => {
    let release: (() => void) | null = null
    sendNowAction.mockImplementation(
      () =>
        new Promise<ActionState>((resolve) => {
          release = () => resolve(idle)
        }),
    )
    render(props())
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-send-now-open"]')
        ?.click(),
    )
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="push-confirm-input"]',
    )
    if (!input) throw new Error("no confirm input rendered")
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "1234")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-confirm-submit"]')
        ?.click()
    })

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="push-send-now-open"]',
    )
    expect(button?.textContent).toContain("Sending...")
    expect(button?.disabled).toBe(true)

    await act(async () => {
      release?.()
    })
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="push-send-now-open"]',
      )?.disabled,
    ).toBe(false)
  })

  it("dispatches the cancel with the campaign id", async () => {
    render(props({ cancellable: true }))
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-cancel-open"]')
        ?.click(),
    )
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-confirm-submit"]')
        ?.click()
    })
    expect(cancelCampaignAction).toHaveBeenCalledTimes(1)
    const form = cancelCampaignAction.mock.calls[0]?.[1] as FormData
    expect(form.get("campaignId")).toBe("c1")
  })

  it("uses the same confirmation shape for cancel, with no typed value", () => {
    render(props({ cancellable: true }))
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-cancel-open"]')
        ?.click(),
    )
    const modal = container.querySelector('[data-testid="push-cancel-confirm"]')
    expect(modal?.textContent).toContain("not sent")
    expect(
      container.querySelector('[data-testid="push-confirm-input"]'),
    ).toBeNull()
  })
})
