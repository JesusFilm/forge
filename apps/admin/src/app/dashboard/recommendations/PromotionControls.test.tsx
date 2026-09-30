// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PromotionControls } from "./PromotionControls"

let container: HTMLDivElement, root: Root
const fetchMock = vi.fn()
const operationId = "00000000-0000-4000-8000-000000000001"
const props = {
  generation: 7,
  stage: "bounded" as const,
  targetManifestId: "reviewed-challenger",
  lastKnownGoodManifestId: "reviewed-incumbent",
  approvalId: "exact-approval",
  evaluationId: "exact-evaluation",
  exposureCeilingBps: 1000,
  proposedExposureCeilingBps: 1000,
  killSwitchEnabled: false,
  ready: true,
}
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  )!
const response = (status: number) => ({
  ok: status < 300,
  status,
  json: async () => ({ ok: false, error: "permission_denied" }),
})

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  vi.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error("Native confirmation must not be used")
  })
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const actions = [
  {
    label: "Emergency stop",
    message:
      "Stop challenger influence and fence cached and persisted influence now?",
    killSwitchEnabled: false,
    body: {
      action: "set_kill_switch",
      expectedPointerGeneration: 7,
      enabled: true,
      reason: "manual_emergency_stop",
    },
  },
  {
    label: "Clear emergency hold",
    message:
      "Clear the emergency hold? Revoked direct releases remain revoked and require a new reviewed graph release.",
    killSwitchEnabled: true,
    body: {
      action: "set_kill_switch",
      expectedPointerGeneration: 7,
      enabled: false,
      reason: "incident_resolved",
    },
  },
  {
    label: "Restore last-known-good",
    message: "Restore reviewed-incumbent and fence all outstanding influence?",
    killSwitchEnabled: false,
    body: {
      action: "manual_rollback",
      expectedPointerGeneration: 7,
      targetManifestId: "reviewed-incumbent",
      evaluationId: "exact-evaluation",
      exposureCeilingBps: 0,
      operationId,
    },
  },
  {
    label: "Confirm permanent default",
    message:
      "Make this strategy the permanent default? This requires recent authentication and remains fully audited.",
    killSwitchEnabled: false,
    body: {
      action: "confirm_permanent",
      expectedPointerGeneration: 7,
      targetManifestId: "reviewed-challenger",
      approvalId: "exact-approval",
      evaluationId: "exact-evaluation",
      exposureCeilingBps: 10_000,
      operationId,
    },
  },
]

describe("in-page promotion confirmation", () => {
  it.each([
    [
      '{"ok":false,"error":"csrf_failed"}',
      "Request security validation failed.",
      "failed",
    ],
    [
      '{"ok":false,"error":"permission_denied"}',
      "Your role is not authorized",
      "authorization-failure",
    ],
    ['{"ok":true,"error":"csrf_failed"}', "The request was refused.", "failed"],
    ['{"ok":false,"error":"unexpected"}', "The request was refused.", "failed"],
    ["null", "The request was refused.", "failed"],
    ["[]", "The request was refused.", "failed"],
    ["<html>Forbidden</html>", "The request was refused.", "failed"],
  ])(
    "explains a 403 safely without retrying: %s",
    async (body, message, state) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 403 }))
      await act(async () => root.render(<PromotionControls {...props} />))
      await act(async () => button("Emergency stop").click())
      expect(fetchMock).not.toHaveBeenCalled()
      await act(async () => button("Confirm").click())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain(message)
      expect(
        container.querySelector(`[data-mutation-state="${state}"]`),
      ).not.toBeNull()
      expect(container.textContent).not.toContain("Decision recorded")
      expect(container.textContent).not.toContain("Acknowledgement unknown")
      expect(window.confirm).not.toHaveBeenCalled()
    },
  )

  it("adds no initial request or confirmation markup to the collapsed page", async () => {
    const markup = renderToStaticMarkup(<PromotionControls {...props} />)
    expect(markup).not.toContain("Confirm promotion action")
    await act(async () => root.render(<PromotionControls {...props} />))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it.each(actions)(
    "cancels $label without a mutation and restores focus",
    async (action) => {
      await act(async () =>
        root.render(
          <PromotionControls
            {...props}
            killSwitchEnabled={action.killSwitchEnabled}
          />,
        ),
      )
      const trigger = button(action.label)
      trigger.focus()
      await act(async () => trigger.click())
      const region = container.querySelector("section[aria-labelledby]")!
      expect(region.textContent).toContain(action.message)
      expect(
        document.getElementById(region.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toBe(action.message)
      expect(document.activeElement).toBe(button("Cancel"))
      expect(fetchMock).not.toHaveBeenCalled()
      expect(crypto.randomUUID).not.toHaveBeenCalled()
      await act(async () => button("Cancel").click())
      expect(container.querySelector("section[aria-labelledby]")).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(window.confirm).not.toHaveBeenCalled()
    },
  )

  it.each(actions)(
    "confirms $label exactly once even with synchronous double clicks",
    async (action) => {
      let settle!: (value: ReturnType<typeof response>) => void
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve
        }),
      )
      await act(async () =>
        root.render(
          <PromotionControls
            {...props}
            killSwitchEnabled={action.killSwitchEnabled}
          />,
        ),
      )
      await act(async () => {
        const trigger = button(action.label)
        trigger.focus()
        trigger.click()
        trigger.click()
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(
        container.querySelectorAll("section[aria-labelledby]"),
      ).toHaveLength(1)
      await act(async () => {
        const confirm = button("Confirm")
        confirm.click()
        confirm.click()
        button(action.label).click()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe("/api/recommendations/promotion")
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-promotion-v1",
        },
      })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(action.body)
      expect(button(action.label).disabled).toBe(true)
      // The response still enforces the existing generation conflict handling.
      await act(async () => settle(response(409)))
      expect(
        container.querySelector('[data-mutation-state="stale-page"]'),
      ).not.toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it("supports Escape without mutation and preserves authorization failures", async () => {
    await act(async () => root.render(<PromotionControls {...props} />))
    const trigger = button("Emergency stop")
    trigger.focus()
    await act(async () => trigger.click())
    await act(async () =>
      button("Cancel").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
    fetchMock.mockResolvedValue(response(403))
    await act(async () => trigger.click())
    await act(async () => button("Confirm").click())
    expect(
      container.querySelector('[data-mutation-state="authorization-failure"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Your role is not authorized")
  })
})
