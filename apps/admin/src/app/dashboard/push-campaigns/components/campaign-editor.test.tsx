// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { adminMessages } from "@/i18n/messages"
import type { PushCampaignDetail } from "@/services/push/dashboard.service"

import type { PushActionState } from "./action-state"

const saveCampaignAction = vi.fn(
  async (
    _previous: PushActionState,
    _form: FormData,
  ): Promise<PushActionState> => ({
    status: "idle",
  }),
)
const refresh = vi.fn()

vi.mock("../actions", () => ({
  saveCampaignAction: (previous: PushActionState, form: FormData) =>
    saveCampaignAction(previous, form),
  searchDestinationsAction: vi.fn(async () => []),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
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
    contentVersion: 4,
    lastTestContentVersion: null,
    aiMarker: null,
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
        messages={adminMessages.en.pages.pushCampaigns.review}
      />,
    )
  })
}

/** Submits the form the way a click on Save does, and waits for the action. */
async function save() {
  await act(async () => {
    submitButton().click()
  })
}

function lastSavedForm(): FormData {
  const form = saveCampaignAction.mock.calls.at(-1)?.[1]
  if (!form) throw new Error("the save action was not called")
  return form
}

function englishTitle(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="push-copy-row"][data-language="english"] [data-testid="push-copy-title"]',
  )
  if (!input) throw new Error("no English title rendered")
  return input
}

function feedback(): string | null {
  return (
    container.querySelector('[data-testid="push-action-feedback"]')
      ?.textContent ?? null
  )
}

function loadLatestButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    '[data-testid="push-load-latest"]',
  )
}

const STALE_REASON =
  "This campaign changed after you loaded it. The last change was by Bob Editor at 2026-10-06 10:05 UTC. Load the latest version, then try again."

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
  saveCampaignAction.mockReset()
  saveCampaignAction.mockResolvedValue({ status: "idle" })
  refresh.mockReset()
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

describe("CampaignEditor content version", () => {
  it("posts the version the page loaded, so a stale save is refused (R34)", () => {
    render(campaign({ contentVersion: 7 }))
    const field = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="contentVersion"]',
    )
    expect(field?.value).toBe("7")
  })

  it("keeps the typed text and names the newer change when a save is stale (AE10)", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "stale",
      reason: STALE_REASON,
      contentVersion: 5,
    })
    render(campaign())
    setValue(englishTitle(), "My unsaved title")
    const arabicBody = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="push-copy-row"][data-language="arabic"] [data-testid="push-copy-body"]',
    )
    if (!arabicBody) throw new Error("no Arabic body rendered")
    setValue(arabicBody, "نص لم يحفظ")
    const french = container.querySelector<HTMLInputElement>(
      'input[name="languageFilter"][value="french"]',
    )
    act(() => french?.click())
    const everywhere = container.querySelector<HTMLInputElement>(
      '[data-testid="push-audience-everywhere"]',
    )
    act(() => everywhere?.click())

    await save()

    // React resets a form after its action, so each kind of field is checked.
    expect(englishTitle().value).toBe("My unsaved title")
    expect(arabicBody.value).toBe("نص لم يحفظ")
    expect(french?.checked).toBe(true)
    expect(everywhere?.checked).toBe(true)
    expect(feedback()).toBe(STALE_REASON)
    expect(loadLatestButton()?.textContent).toContain("Load the latest version")
  })

  it("shows the save as pending while the action is in flight", async () => {
    let release: (() => void) | null = null
    saveCampaignAction.mockImplementation(
      () =>
        new Promise<PushActionState>((resolve) => {
          release = () => resolve({ status: "idle" })
        }),
    )
    render(campaign())

    await save()
    expect(submitButton().textContent).toBe("Saving...")
    expect(submitButton().disabled).toBe(true)

    await act(async () => {
      release?.()
    })
    expect(submitButton().textContent).toBe("Save campaign")
  })

  it("posts the old version again after a stale refusal, so the resubmit is refused again", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "stale",
      reason: STALE_REASON,
      contentVersion: 5,
    })
    render(campaign({ contentVersion: 4 }))

    await save()
    await save()

    expect(saveCampaignAction).toHaveBeenCalledTimes(2)
    expect(lastSavedForm().get("contentVersion")).toBe("4")
  })

  it("asks before it discards the typed text, and loads the latest version only on yes", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "stale",
      reason: STALE_REASON,
      contentVersion: 5,
    })
    render(campaign())
    setValue(englishTitle(), "My unsaved title")
    await save()

    act(() => loadLatestButton()?.click())
    const dialog = container.querySelector(
      '[data-testid="push-load-latest-confirm"]',
    )
    expect(dialog?.textContent).toContain("is lost")
    expect(refresh).not.toHaveBeenCalled()

    act(() =>
      [...(dialog?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Keep editing")
        ?.click(),
    )
    expect(
      container.querySelector('[data-testid="push-load-latest-confirm"]'),
    ).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    expect(englishTitle().value).toBe("My unsaved title")

    act(() => loadLatestButton()?.click())
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="push-confirm-submit"]')
        ?.click(),
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("drops the stale refusal once the page shows the newer version", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "stale",
      reason: STALE_REASON,
      contentVersion: 5,
    })
    render(campaign({ contentVersion: 4 }))
    await save()

    render(campaign({ contentVersion: 5 }))

    expect(feedback()).toBeNull()
    expect(loadLatestButton()).toBeNull()
  })

  it("keeps the typed fields when the page re-renders at the same version", () => {
    render(campaign({ contentVersion: 4 }))
    setValue(englishTitle(), "My unsaved title")

    render(
      campaign({
        contentVersion: 4,
        updatedAt: new Date("2026-10-06T10:00:00Z"),
      }),
    )

    expect(englishTitle().value).toBe("My unsaved title")
  })

  it("loads the stored fields again when the version changes", () => {
    render(campaign({ contentVersion: 4 }))
    setValue(englishTitle(), "My unsaved title")

    render(
      campaign({
        contentVersion: 5,
        copies: [
          {
            languageSlug: "english",
            title: "The agent's title",
            body: "Watch tonight",
          },
        ],
      }),
    )

    expect(englishTitle().value).toBe("The agent's title")
    expect(copyLanguages()).toEqual(["english"])
  })

  it("keeps the success message after a save raises the version, and shows the saved values", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "ok",
      message: "Saved. This campaign is a draft again.",
      contentVersion: 5,
    })
    render(campaign({ contentVersion: 4 }))
    setValue(englishTitle(), "  New title  ")

    await save()
    // The action revalidates the page, which arrives with the stored values.
    render(
      campaign({
        contentVersion: 5,
        copies: [
          { languageSlug: "english", title: "New title", body: "Tonight" },
        ],
      }),
    )

    expect(feedback()).toBe("Saved. This campaign is a draft again.")
    expect(englishTitle().value).toBe("New title")
  })

  it("posts the new version with a second save from the same editor", async () => {
    saveCampaignAction.mockResolvedValue({
      status: "ok",
      message: "Saved.",
      contentVersion: 5,
    })
    render(campaign({ contentVersion: 4 }))
    await save()
    render(campaign({ contentVersion: 5 }))

    await save()

    expect(lastSavedForm().get("contentVersion")).toBe("5")
  })
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

  it("keeps a stored filter language that the picker does not list, and saves it back (R37)", async () => {
    render(campaign({ languageFilter: ["arabic", "retired-slug"] }))

    const boxes = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[name="languageFilter"]',
      ),
    ]
    const retired = boxes.find((box) => box.value === "retired-slug")
    expect(retired?.checked).toBe(true)
    expect(retired?.closest("label")?.textContent).toContain("retired-slug")

    await save()

    expect(lastSavedForm().getAll("languageFilter").sort()).toEqual([
      "arabic",
      "retired-slug",
    ])
  })

  it("drops an unlisted filter language that the editor unticks", async () => {
    render(campaign({ languageFilter: ["retired-slug"] }))
    const retired = container.querySelector<HTMLInputElement>(
      'input[name="languageFilter"][value="retired-slug"]',
    )
    if (!retired) throw new Error("the unlisted filter language is not shown")
    act(() => retired.click())
    expect(retired.checked).toBe(false)

    await save()

    expect(lastSavedForm().getAll("languageFilter")).toEqual([])
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
