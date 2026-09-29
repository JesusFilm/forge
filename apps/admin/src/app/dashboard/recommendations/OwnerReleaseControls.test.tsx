// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OwnerReleaseControls } from "./OwnerReleaseControls"
let container: HTMLDivElement, root: Root
const fetchMock = vi.fn()
const response = (ownerRelease: unknown, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => ({ ownerRelease }),
})
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!
const prepared = {
  status: "prepared",
  operationId: "00000000-0000-4000-8000-000000000001",
  expectedPointerGeneration: 3,
  bindingDigest: "b".repeat(64),
  manifestId: "direct-policy",
  graphGenerationId: "a".repeat(64),
  validUntil: "2026-10-01T00:00:00Z",
  dependencyExpiresAt: "2026-10-02T00:00:00Z",
  binding: {
    sourceWindow: {
      windowStart: "2026-09-22T00:00:00Z",
      windowEnd: "2026-09-29T00:00:00Z",
      evaluationAsOf: "2026-09-30T00:00:00Z",
    },
  },
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  vi.spyOn(crypto, "randomUUID").mockReturnValue(prepared.operationId)
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
async function enterGraph() {
  await act(async () =>
    root.render(
      <OwnerReleaseControls generation={3} killSwitchEnabled={false} />,
    ),
  )
  const input = container.querySelector("input")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, prepared.graphGenerationId)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
describe("direct owner operator controls", () => {
  it("adds no initial request and displays manual expiry and unmeasured usefulness", async () => {
    await act(async () =>
      root.render(
        <OwnerReleaseControls generation={3} killSwitchEnabled={false} />,
      ),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "Causal usefulness remains unmeasured",
    )
    expect(container.textContent).toContain("Graph refresh is manual")
  })
  it("keeps the same exact operation and binding through activation acknowledgement loss and reconciliation", async () => {
    await enterGraph()
    fetchMock.mockResolvedValueOnce(response(prepared))
    await act(async () => button("Prepare direct release").click())
    expect(container.textContent).toContain(prepared.validUntil)
    expect(container.textContent).toContain(
      prepared.binding.sourceWindow.windowStart,
    )
    fetchMock.mockRejectedValueOnce(new Error("network acknowledgement lost"))
    await act(async () => button("Activate reviewed direct release").click())
    const prepareBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const activationBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(activationBody).toMatchObject({
      operationId: prepareBody.operationId,
      bindingDigest: prepared.bindingDigest,
      expectedPointerGeneration: 3,
      graphGenerationId: prepared.graphGenerationId,
    })
    expect(container.textContent).toContain("Acknowledgement unknown")
    expect(button("Activate reviewed direct release")).toBeUndefined()
    fetchMock.mockResolvedValueOnce(response({ status: "active" }))
    await act(async () => button("Reconcile direct release").click())
    expect(fetchMock.mock.calls[2][0]).toBe(
      `/api/recommendations/promotion?ownerOperationId=${prepared.operationId}`,
    )
    expect(container.textContent).toContain("No activation retry is needed")
  })
  it("does not enable preparation while emergency stop is holding delivery", async () => {
    await act(async () =>
      root.render(
        <OwnerReleaseControls generation={3} killSwitchEnabled={true} />,
      ),
    )
    expect(container.querySelector("input")?.disabled).toBe(true)
    expect(button("Prepare direct release").disabled).toBe(true)
  })
  it("excludes duplicate synchronous preparation submissions", async () => {
    await enterGraph()
    let complete!: (value: ReturnType<typeof response>) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    await act(async () => {
      const prepare = button("Prepare direct release")
      prepare.click()
      prepare.click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => complete(response(prepared)))
    expect(button("Activate reviewed direct release")).toBeDefined()
  })
})
