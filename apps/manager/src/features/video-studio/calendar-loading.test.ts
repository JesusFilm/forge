// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { ShortCalendar } from "./calendar"
import { studioCall } from "./client"

vi.mock("./client", () => ({
  studioCall: vi.fn(),
  StudioClientError: class extends Error {},
}))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

it("loads the calendar with only its view and project list, without a pack request", async () => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const view = {
    planningRun: null,
    calendarId: "shorts-calendar",
    version: 1,
    settings: {
      timeZone: "Pacific/Auckland",
      publishTime: "09:00",
      deliveryWindowMinutes: 60,
      plannerTimes: ["06:00"],
      automationEnabled: false,
      language: "english",
    },
    weeks: [],
    slots: Array.from({ length: 28 }, (_, index) => ({
      id: `slot-${index}`,
      date: new Date(Date.UTC(2026, 9, 28 + index)).toISOString().slice(0, 10),
      version: 0,
      title: "",
      theme: "",
      manual: false,
      projectId: null,
      project: null,
      projectSourcesSelected: false,
      provenance: null,
      authorizations: [],
    })),
  }
  vi.mocked(studioCall).mockImplementation(async (action) => {
    if (action === "calendar-read") return view
    if (action === "list") return []
    throw new Error(`Unexpected startup request: ${action}`)
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const start = performance.now()
  try {
    await act(async () => {
      root.render(React.createElement(ShortCalendar))
    })
    expect(host.querySelectorAll(".calendar-day")).toHaveLength(14)
    expect(host.textContent).not.toMatch(/content packs/i)
    expect(vi.mocked(studioCall).mock.calls.map(([action]) => action)).toEqual([
      "calendar-read",
      "list",
    ])
    console.info(
      `Calendar startup: ${Math.round(performance.now() - start)} ms in jsdom; 2 requests`,
    )
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
