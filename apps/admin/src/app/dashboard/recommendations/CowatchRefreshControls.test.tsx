// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CowatchRefreshControls } from "./CowatchRefreshControls"

let container: HTMLDivElement, root: Root
const fetchMock = vi.fn()
const operationId = "00000000-0000-4000-8000-000000000001"
const emptyStatus = {
  status: "disabled",
  grant: null,
  currentRelease: null,
  latestAttempt: null,
  lastSuccess: null,
  nextAttemptAt: null,
}
const activeStatus = {
  ...emptyStatus,
  status: "enabled",
  grant: {
    id: operationId,
    expiresAt: "2026-10-30T00:00:00.000Z",
    revokedAt: null,
  },
}
const response = (refresh: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, refresh }),
})
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === name,
  )!

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
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
async function render(stopped = false) {
  await act(async () =>
    root.render(
      <StrictMode>
        <CowatchRefreshControls generation={7} killSwitchEnabled={stopped} />
      </StrictMode>,
    ),
  )
}
async function enterBudget() {
  const textarea = container.querySelector("textarea")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, '{"maxDatabaseBytes":40000000000}')
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => button("Review refresh authorization").click())
}

describe("bounded co-watch refresh controls", () => {
  it("adds no initial fetch or timer under StrictMode", async () => {
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "one new publication every 12 hours",
    )
    expect(container.textContent).toContain("seven hours ago")
    expect(button("Confirm bounded refresh")).toBeUndefined()
  })

  it("requires review and allows cancellation without a mutation", async () => {
    await render()
    await enterBudget()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(button("Confirm bounded refresh")).toBeDefined()
    await act(async () => button("Cancel").click())
    expect(button("Confirm bounded refresh")).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("confirms once with exact reviewed budget and reconciles acknowledgement loss using original UUID", async () => {
    await render()
    await enterBudget()
    let reject!: (cause: Error) => void
    fetchMock.mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r
      }),
    )
    await act(async () => {
      button("Confirm bounded refresh").click()
      button("Confirm bounded refresh").click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "authorize",
      operationId,
      expectedPointerGeneration: 7,
      budget: { maxDatabaseBytes: 40000000000 },
    })
    await act(async () => reject(new Error("lost acknowledgement")))
    expect(container.textContent).toContain("Acknowledgement unknown")
    fetchMock.mockResolvedValueOnce(response(activeStatus))
    await act(async () => button("Reconcile refresh operation").click())
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/recommendations/cowatch-refresh?operationId=${operationId}`,
    )
    expect(container.textContent).toContain("Current refresh state loaded")
    expect(container.textContent).toContain(activeStatus.grant.expiresAt)
  })

  it("keeps unknown acknowledgement pending when inspection is malformed", async () => {
    await render()
    await enterBudget()
    fetchMock.mockRejectedValueOnce(new Error("lost acknowledgement"))
    await act(async () => button("Confirm bounded refresh").click())
    fetchMock.mockResolvedValueOnce(response({ status: "enabled", grant: {} }))
    await act(async () => button("Reconcile refresh operation").click())
    expect(button("Reconcile refresh operation")).toBeDefined()
    expect(button("Review refresh authorization").disabled).toBe(true)
    expect(container.textContent).toContain("Refresh status is unavailable")
  })

  it("preserves exact authorization inputs while its commit is not yet visible", async () => {
    await render()
    await enterBudget()
    fetchMock.mockRejectedValueOnce(new Error("lost acknowledgement"))
    await act(async () => button("Confirm bounded refresh").click())
    const originalBody = fetchMock.mock.calls[0][1].body
    await act(async () =>
      root.render(
        <StrictMode>
          <CowatchRefreshControls generation={8} killSwitchEnabled={false} />
        </StrictMode>,
      ),
    )
    fetchMock.mockResolvedValueOnce(
      response({ ...emptyStatus, status: "not_authorized" }),
    )
    await act(async () => button("Reconcile refresh operation").click())
    expect(button("Review refresh authorization").disabled).toBe(true)
    expect(button("Confirm bounded refresh").disabled).toBe(true)
    expect(button("Cancel").disabled).toBe(true)
    expect(container.textContent).toContain(
      "original operation is not confirmed",
    )
    fetchMock.mockResolvedValueOnce(response(activeStatus))
    await act(async () => button("Retry original refresh operation").click())
    expect(fetchMock.mock.calls[2][1].body).toBe(originalBody)
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Refresh authorization recorded")
  })

  it("does not settle an unknown stop until that exact grant is revoked", async () => {
    await render()
    fetchMock.mockResolvedValueOnce(response(activeStatus))
    await act(async () => button("Inspect refresh status").click())
    fetchMock.mockRejectedValueOnce(new Error("lost acknowledgement"))
    await act(async () => button("Stop automatic refresh").click())
    fetchMock.mockResolvedValueOnce(response(activeStatus))
    await act(async () => button("Reconcile refresh operation").click())
    expect(button("Reconcile refresh operation")).toBeDefined()
    expect(button("Stop automatic refresh").disabled).toBe(true)
    fetchMock.mockResolvedValueOnce(
      response({
        ...activeStatus,
        grant: {
          ...activeStatus.grant,
          id: "another-operation",
          revokedAt: "2026-10-01T00:00:00Z",
        },
      }),
    )
    await act(async () => button("Reconcile refresh operation").click())
    expect(button("Reconcile refresh operation")).toBeDefined()
    fetchMock.mockResolvedValueOnce(
      response({
        ...activeStatus,
        grant: { ...activeStatus.grant, revokedAt: "2026-10-01T00:00:00Z" },
      }),
    )
    await act(async () => button("Reconcile refresh operation").click())
    expect(button("Retry original refresh operation")).toBeUndefined()
  })

  it("shows refusal, graph deadline and last success honestly, with independent stop", async () => {
    await render(true)
    fetchMock.mockResolvedValueOnce(
      response({
        ...activeStatus,
        status: "capacity_refused",
        currentRelease: {
          id: "release",
          validUntil: "2026-10-01T12:00:00.000Z",
          revokedAt: "2026-10-01T01:00:00.000Z",
        },
        latestAttempt: {
          id: "attempt",
          status: "refused",
          reasonCode: "capacity_exceeded",
        },
        lastSuccess: { completedAt: "2026-09-30T12:00:00.000Z" },
      }),
    )
    await act(async () => button("Inspect refresh status").click())
    expect(container.textContent).toContain("capacity_exceeded")
    expect(container.textContent).toContain("· revoked")
    expect(container.textContent).toContain("2026-09-30T12:00:00.000Z")
    expect(button("Review refresh authorization").disabled).toBe(true)
    expect(button("Stop automatic refresh").disabled).toBe(false)
    fetchMock.mockResolvedValueOnce(
      response({
        ...activeStatus,
        status: "disabled",
        grant: { ...activeStatus.grant, revokedAt: "2026-10-01T01:01:00.000Z" },
      }),
    )
    await act(async () => button("Stop automatic refresh").click())
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      action: "disable",
      grantId: operationId,
    })
    expect(container.textContent).toContain("Refresh stopped")
  })
})
