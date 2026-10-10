// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PushDestinationOption } from "@/services/push/dashboard.service"

const searchDestinationsAction =
  vi.fn<
    (input: { kind: string; query: string }) => Promise<PushDestinationOption[]>
  >()

vi.mock("../actions", () => ({
  searchDestinationsAction: (input: { kind: string; query: string }) =>
    searchDestinationsAction(input),
}))

import { DestinationPicker } from "./destination-picker"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function option(
  overrides: Partial<PushDestinationOption> = {},
): PushDestinationOption {
  return {
    kind: "SERIES",
    slug: "jesus",
    title: "JESUS",
    meta: "jesus • SERIES",
    ...overrides,
  }
}

async function open() {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[data-testid="push-destination-open"]')
      ?.click()
  })
  // The search is debounced by 250ms; let the timer fire and the state settle.
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  searchDestinationsAction.mockReset()
  searchDestinationsAction.mockResolvedValue([option()])
  container = document.createElement("div")
  document.body.append(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("DestinationPicker", () => {
  it("carries the chosen kind and slug as one hidden pair", () => {
    act(() => {
      root.render(
        <DestinationPicker
          value={{ kind: "SERIES", slug: "jesus" }}
          title="JESUS"
          onChange={() => {}}
        />,
      )
    })
    expect(
      container.querySelector<HTMLInputElement>('input[name="destinationKind"]')
        ?.value,
    ).toBe("SERIES")
    expect(
      container.querySelector<HTMLInputElement>('input[name="destinationSlug"]')
        ?.value,
    ).toBe("jesus")
    expect(
      container.querySelector('[data-testid="push-destination-value"]')
        ?.textContent,
    ).toContain("series / jesus")
  })

  it("says no destination is chosen while the campaign has none (R7)", () => {
    act(() => {
      root.render(
        <DestinationPicker value={null} title={null} onChange={() => {}} />,
      )
    })
    expect(
      container.querySelector('[data-testid="push-destination-value"]')
        ?.textContent,
    ).toContain("No destination chosen")
    expect(
      container.querySelector<HTMLInputElement>('input[name="destinationKind"]')
        ?.value,
    ).toBe("")
  })

  it("searches the catalog on open and reports the chosen row", async () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <DestinationPicker value={null} title={null} onChange={onChange} />,
      )
    })

    await open()

    expect(searchDestinationsAction).toHaveBeenCalledWith({
      kind: "SERIES",
      query: "",
    })
    const row = container.querySelector<HTMLButtonElement>(
      '[data-testid="push-destination-row"]',
    )
    expect(row?.textContent).toContain("JESUS")

    await act(async () => row?.click())
    expect(onChange).toHaveBeenCalledWith({ kind: "SERIES", slug: "jesus" })
    // Choosing a row closes the picker.
    expect(
      container.querySelector('[data-testid="push-destination-picker"]'),
    ).toBeNull()
  })

  it("re-searches the catalog when the kind changes (R7)", async () => {
    act(() => {
      root.render(
        <DestinationPicker value={null} title={null} onChange={() => {}} />,
      )
    })
    await open()

    searchDestinationsAction.mockResolvedValue([
      option({ kind: "EXPERIENCE", slug: "easter", title: "Easter" }),
    ])
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="push-destination-kind-EXPERIENCE"]',
        )
        ?.click()
    })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {})

    expect(searchDestinationsAction).toHaveBeenLastCalledWith({
      kind: "EXPERIENCE",
      query: "",
    })
    expect(
      container.querySelector('[data-testid="push-destination-row"]')
        ?.textContent,
    ).toContain("Easter")
  })

  it("names an empty result rather than showing a blank list", async () => {
    searchDestinationsAction.mockResolvedValue([])
    act(() => {
      root.render(
        <DestinationPicker value={null} title={null} onChange={() => {}} />,
      )
    })
    await open()
    expect(
      container.querySelector('[data-testid="push-destination-empty"]'),
    ).not.toBeNull()
  })

  it("names a failed search rather than reading as an empty catalog", async () => {
    searchDestinationsAction.mockRejectedValue(new Error("boom"))
    act(() => {
      root.render(
        <DestinationPicker value={null} title={null} onChange={() => {}} />,
      )
    })
    await open()
    expect(
      container.querySelector('[data-testid="push-destination-failed"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="push-destination-empty"]'),
    ).toBeNull()
  })
})
