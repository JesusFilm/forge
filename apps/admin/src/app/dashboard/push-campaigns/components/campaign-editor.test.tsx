// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PushCampaignDetail } from "@/services/push/dashboard.service"

vi.mock("../actions", () => ({
  saveCampaignAction: vi.fn(async () => ({ status: "idle" as const })),
  searchDestinationsAction: vi.fn(async () => []),
}))

import { CampaignEditor } from "./campaign-editor"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const LANGUAGES = [
  { slug: "english", label: "English" },
  { slug: "arabic", label: "Arabic" },
  { slug: "french", label: "French" },
]

function campaign(
  overrides: Partial<PushCampaignDetail> = {},
): PushCampaignDetail {
  return {
    id: "c1",
    status: "DRAFT",
    mode: "WAVE",
    englishTitle: "An announcement",
    languageCount: 2,
    destinationKind: "SERIES",
    destinationSlug: "jesus",
    audienceScope: "COUNTRIES",
    countries: ["SA"],
    languageFilter: [],
    sendDate: null,
    localHour: null,
    testSentAt: null,
    sendingStartedAt: null,
    completedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-20T00:00:00Z"),
    updatedAt: new Date("2026-09-20T00:00:00Z"),
    copies: [
      {
        languageSlug: "english",
        title: "An announcement",
        body: "Watch tonight",
      },
      { languageSlug: "arabic", title: "إعلان", body: "شاهد الليلة" },
    ],
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

function render(detail: PushCampaignDetail) {
  act(() => {
    root.render(
      <CampaignEditor
        campaign={detail}
        languageOptions={LANGUAGES}
        destinationTitle="JESUS"
      />,
    )
  })
}

function copyLanguages(): string[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>(
      'input[name="copyLanguage"]',
    ),
  ].map((input) => input.value)
}

function submitButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )
  if (!button) throw new Error("no submit button rendered")
  return button
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
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

describe("CampaignEditor copy rows", () => {
  it("opens with one row per stored language, English first and not removable", () => {
    render(campaign())
    expect(copyLanguages()).toEqual(["english", "arabic"])
    const removes = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="push-copy-remove"]',
      ),
    ].map((button) => button.dataset.language)
    expect(removes).toEqual(["arabic"])
  })

  it("adds an English row when a campaign has none, because R6 requires it", () => {
    render(
      campaign({
        copies: [{ languageSlug: "arabic", title: "إعلان", body: "شاهد" }],
      }),
    )
    expect(copyLanguages()).toContain("english")
  })

  it("shows the cap error and blocks submit for a 121-character body", () => {
    render(campaign())
    expect(submitButton().disabled).toBe(false)

    const body = container.querySelectorAll<HTMLTextAreaElement>(
      '[data-testid="push-copy-body"]',
    )[0]
    setValue(body, "x".repeat(121))

    const errors = [
      ...container.querySelectorAll('[data-testid="push-copy-error"]'),
    ].map((node) => node.textContent)
    expect(errors.join(" ")).toContain("121 of 120")
    expect(submitButton().disabled).toBe(true)
  })

  it("accepts a body of exactly 120 characters", () => {
    render(campaign())
    const body = container.querySelectorAll<HTMLTextAreaElement>(
      '[data-testid="push-copy-body"]',
    )[0]
    setValue(body, "x".repeat(120))
    expect(submitButton().disabled).toBe(false)
  })

  it("shows the cap error for a 51-character title", () => {
    render(campaign())
    const title = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="push-copy-title"]',
    )[0]
    setValue(title, "x".repeat(51))
    expect(
      container.querySelector('[data-testid="push-copy-error"]')?.textContent,
    ).toContain("51 of 50")
    expect(submitButton().disabled).toBe(true)
  })

  it("blocks submit while a row is blank, which the service also refuses", () => {
    render(campaign())
    const title = container.querySelectorAll<HTMLInputElement>(
      '[data-testid="push-copy-title"]',
    )[0]
    setValue(title, "   ")
    expect(submitButton().disabled).toBe(true)
  })

  it("drops a removed row from the submitted fields, which deletes that copy", () => {
    render(campaign())
    const remove = container.querySelector<HTMLButtonElement>(
      '[data-testid="push-copy-remove"][data-language="arabic"]',
    )
    act(() => remove?.click())
    expect(copyLanguages()).toEqual(["english"])
  })

  it("adds a chosen language as a new row", () => {
    render(campaign())
    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="push-add-language"]',
    )
    if (!select) throw new Error("no language select")
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set
      setter?.call(select, "french")
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="push-add-language-submit"]',
        )
        ?.click(),
    )
    expect(copyLanguages()).toEqual(["english", "arabic", "french"])
  })
})

describe("CampaignEditor audience", () => {
  it("adds a country chip and upper-cases it", () => {
    render(campaign({ countries: [] }))
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="push-country-input"]',
    )
    if (!input) throw new Error("no country input")
    setValue(input, "fr")
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-country-add"]')
        ?.click(),
    )
    const chips = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="country"]'),
    ].map((field) => field.value)
    expect(chips).toEqual(["FR"])
  })

  it("names a malformed country and adds nothing", () => {
    render(campaign({ countries: [] }))
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="push-country-input"]',
    )
    if (!input) throw new Error("no country input")
    setValue(input, "x")
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-country-add"]')
        ?.click(),
    )
    expect(
      container.querySelector('[data-testid="push-country-error"]')
        ?.textContent,
    ).toContain("two-letter")
    expect(container.querySelectorAll('input[name="country"]')).toHaveLength(0)
  })

  it("blocks submit for a country audience with no country named", () => {
    render(campaign({ countries: [] }))
    expect(submitButton().disabled).toBe(true)
  })

  it("hides the country controls and allows submit for an everywhere audience", () => {
    render(campaign({ audienceScope: "EVERYWHERE", countries: [] }))
    expect(
      container.querySelector('[data-testid="push-country-input"]'),
    ).toBeNull()
    expect(submitButton().disabled).toBe(false)
  })

  it("carries the destination as one kind and slug pair", () => {
    render(campaign())
    expect(
      container.querySelector<HTMLInputElement>('input[name="destinationKind"]')
        ?.value,
    ).toBe("SERIES")
    expect(
      container.querySelector<HTMLInputElement>('input[name="destinationSlug"]')
        ?.value,
    ).toBe("jesus")
  })
})
