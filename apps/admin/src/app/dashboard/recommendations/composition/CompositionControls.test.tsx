// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CompositionControls } from "./CompositionControls"

let container: HTMLDivElement, root: Root
const fetchMock = vi.fn()
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  )!
const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("composition mutation acknowledgement", () => {
  it.each(["network", "server"])(
    "blocks another transition after an uncertain %s response",
    async (failure) => {
      await act(async () =>
        root.render(<CompositionControls protocolId="protocol" />),
      )
      expect(fetchMock).not.toHaveBeenCalled()
      if (failure === "network")
        fetchMock.mockRejectedValueOnce(new Error("acknowledgement lost"))
      else fetchMock.mockResolvedValueOnce(response(500, { error: "failed" }))
      await act(async () => button("Record terminal decision").click())
      expect(container.textContent).toContain("Acknowledgement unknown")
      expect(button("Record terminal decision").disabled).toBe(true)
      await act(async () => button("Record terminal decision").click())
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it("allows correction after a definitive rejection and blocks after success", async () => {
    await act(async () =>
      root.render(<CompositionControls protocolId="protocol" />),
    )
    fetchMock.mockResolvedValueOnce(response(400, { error: "not_ready" }))
    await act(async () => button("Record terminal decision").click())
    expect(container.textContent).toContain("Rejected: not_ready")
    expect(button("Record terminal decision").disabled).toBe(false)
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }))
    await act(async () => button("Record terminal decision").click())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain("Recorded. Refresh the protocol")
    expect(button("Record terminal decision").disabled).toBe(true)
  })

  it("submits the exact reviewed policy, evidence and operator rationale", async () => {
    const configDigest = "a".repeat(64),
      evidenceDigest = "b".repeat(64)
    const rationale =
      "The observed inputs, fallback and latency support this trial."
    await act(async () =>
      root.render(
        <CompositionControls
          protocolId="protocol"
          configDigest={configDigest}
          evidenceDigest={evidenceDigest}
          canCalibrate
        />,
      ),
    )
    expect(button("Record review of exact evidence").disabled).toBe(true)
    await act(async () => {
      const input = container.querySelector("textarea")!
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, rationale)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(button("Record review of exact evidence").disabled).toBe(false)
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }))
    await act(async () => button("Record review of exact evidence").click())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recommendations/composition",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-composition-v1",
        },
        body: JSON.stringify({
          action: "calibrate",
          protocolId: "protocol",
          configDigest,
          evidenceDigest,
          rationale,
        }),
      }),
    )
    expect(button("Record terminal decision").disabled).toBe(true)
    expect(button("Record review of exact evidence").disabled).toBe(true)
  })
})
