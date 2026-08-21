/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { submitReport } = vi.hoisted(() => ({ submitReport: vi.fn() }))
vi.mock("@/lib/user-playlist-public-actions", () => ({
  submitPublicUserPlaylistReport: submitReport,
}))

import { PublicUserPlaylistReportDialog } from "./PublicUserPlaylistReportDialog"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  submitReport.mockReset().mockResolvedValue({ ok: true })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
})

async function render(intentTtlMs = 60_000) {
  await act(async () => {
    root.render(
      <PublicUserPlaylistReportDialog
        reportIntent="v1.key.nonce.ciphertext.tag"
        intentTtlMs={intentTtlMs}
      />,
    )
  })
  const trigger = container.querySelector("button")!
  await act(async () => trigger.click())
  return trigger
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

describe("PublicUserPlaylistReportDialog", () => {
  it("validates, shows remaining characters, prevents duplicates, and uses uniform success", async () => {
    await render()
    expect(document.body.textContent).toContain("1000 characters remaining")

    await act(async () => button("Submit report").click())
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Choose a reason",
    )

    const select = document.querySelector("select")!
    await act(async () => {
      select.value = "OTHER_SAFETY"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => button("Submit report").click())
    expect(submitReport).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain(
      "Thank you. Your report has been received.",
    )
  })

  it("marks an expired intent unavailable without submitting and restores trigger focus on cancel", async () => {
    const trigger = await render(0)
    expect(document.body.textContent).toContain("report form has expired")
    expect(button("Submit report").disabled).toBe(true)

    await act(async () => button("Cancel").click())
    expect(submitReport).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
  })

  it("keeps cancellation disabled while a report is pending", async () => {
    const pending = deferred<{ ok: true }>()
    submitReport.mockReturnValue(pending.promise)
    await render()
    const select = document.querySelector("select")!
    await act(async () => {
      select.value = "OTHER_SAFETY"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => button("Submit report").click())

    expect(button("Cancel").disabled).toBe(true)
    await act(async () => button("Cancel").click())
    expect(document.body.textContent).toContain("Report this playlist")

    await act(async () => {
      pending.resolve({ ok: true })
      await pending.promise
    })
    expect(document.body.textContent).toContain(
      "Thank you. Your report has been received.",
    )
  })

  it.each([
    ["an unsuccessful result", false],
    ["a rejected request", true],
  ])("shows a retryable error for %s", async (_name, rejects) => {
    if (rejects) submitReport.mockRejectedValue(new Error("offline"))
    else submitReport.mockResolvedValue({ ok: false })
    await render()
    const select = document.querySelector("select")!
    await act(async () => {
      select.value = "OTHER_SAFETY"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => button("Submit report").click())

    expect(document.body.textContent).toContain("could not be sent")
    expect(button("Cancel").disabled).toBe(false)
    expect(button("Submit report").disabled).toBe(false)
  })
})
