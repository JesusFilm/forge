// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { adminMessages } from "@/i18n/messages"

const state = vi.hoisted(() => ({
  moderate: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("./moderation-actions", () => ({
  moderateUserPlaylist: state.moderate,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}))

import { ModerationQueue, type PlaylistReportGroup } from "./moderation-queue"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const groups: PlaylistReportGroup[] = [
  {
    playlistId: "playlist_1",
    reports: [
      {
        reportId: "report_1",
        category: "OTHER_SAFETY",
        detailPlainText: "<img src=x onerror=alert(1)>",
        detailStatus: "AVAILABLE",
        createdAt: "2026-08-21T12:00:00.000Z",
      },
      {
        reportId: "report_2",
        category: "MISLEADING_OR_SPAM",
        detailPlainText: null,
        detailStatus: "EXPIRED",
        createdAt: "2026-08-21T11:00:00.000Z",
      },
    ],
  },
  {
    playlistId: "playlist_2",
    reports: [
      {
        reportId: "report_3",
        category: "INAPPROPRIATE_CONTENT",
        detailPlainText: null,
        detailStatus: "UNAVAILABLE",
        createdAt: "2026-08-21T10:00:00.000Z",
      },
      {
        reportId: "report_4",
        category: "COPYRIGHT_OR_RIGHTS",
        detailPlainText: null,
        detailStatus: "ABSENT",
        createdAt: "2026-08-21T09:00:00.000Z",
      },
    ],
  },
]

let container: HTMLDivElement
let root: Root

function button(label: string) {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  state.moderate.mockResolvedValue({
    status: "success",
    action: "BLOCK",
    playlistId: "playlist_1",
    changed: true,
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("ModerationQueue", () => {
  it("groups reports by playlist and renders each privacy-safe detail state as inert text", () => {
    act(() =>
      root.render(
        <ModerationQueue
          groups={groups}
          labels={adminMessages.en.pages.playlistModeration.queue}
        />,
      ),
    )

    expect(container.textContent).toContain("2 reports")
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("Detail expired")
    expect(container.textContent).toContain("Detail unavailable")
    expect(container.textContent).toContain("No detail supplied")
    expect(container.textContent).not.toContain("owner")
    expect(container.textContent).not.toContain("capability")
    expect(
      container.querySelector('[data-dd-privacy="hidden"]')?.textContent,
    ).toBe("<img src=x onerror=alert(1)>")
  })

  it("requires a reason and confirmation, announces success, and returns focus to the row action", async () => {
    act(() =>
      root.render(
        <ModerationQueue
          groups={groups}
          labels={adminMessages.en.pages.playlistModeration.queue}
        />,
      ),
    )

    const trigger = button("Block")
    act(() => trigger.click())

    const dialog = container.querySelector<HTMLElement>("[role=dialog]")
    const confirm = button("Confirm block") as HTMLButtonElement
    expect(dialog).not.toBeNull()
    expect(confirm.disabled).toBe(true)

    const reason = container.querySelector<HTMLSelectElement>(
      "select[name=reason]",
    )!
    act(() => {
      reason.value = "SAFETY"
      reason.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(confirm.disabled).toBe(false)

    await act(async () => confirm.click())

    expect(state.moderate).toHaveBeenCalledWith({
      playlistId: "playlist_1",
      action: "BLOCK",
      reason: "SAFETY",
    })
    expect(
      container.querySelector("[aria-live=polite]")?.textContent,
    ).toContain("Playlist blocked")
    expect(document.activeElement).toBe(trigger)
    expect(state.refresh).toHaveBeenCalledTimes(1)
  })

  it("keeps failures in an accessible alert and restores focus without disclosing internals", async () => {
    state.moderate.mockResolvedValueOnce({ status: "error" })
    act(() =>
      root.render(
        <ModerationQueue
          groups={groups}
          labels={adminMessages.en.pages.playlistModeration.queue}
        />,
      ),
    )

    const trigger = button("Restore")
    act(() => trigger.click())
    const reason = container.querySelector<HTMLSelectElement>(
      "select[name=reason]",
    )!
    act(() => {
      reason.value = "ERROR_CORRECTED"
      reason.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => button("Confirm restore").click())

    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Moderation action failed",
    )
    expect(document.activeElement).toBe(trigger)
    expect(state.refresh).not.toHaveBeenCalled()
  })

  it("maps a rejected server action to the same bounded alert", async () => {
    state.moderate.mockRejectedValueOnce(new Error("network detail secret"))
    act(() =>
      root.render(
        <ModerationQueue
          groups={groups}
          labels={adminMessages.en.pages.playlistModeration.queue}
        />,
      ),
    )

    act(() => button("Block").click())
    const reason = container.querySelector<HTMLSelectElement>(
      "select[name=reason]",
    )!
    act(() => {
      reason.value = "ABUSE"
      reason.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => button("Confirm block").click())

    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Moderation action failed",
    )
    expect(container.textContent).not.toContain("network detail secret")
  })
})
