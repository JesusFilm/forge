// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StudyControls } from "./StudyControls"
import { PromotionControls } from "./PromotionControls"
let container: HTMLDivElement, root: Root
const fetchMock = vi.fn()
const getButton = (text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!
const response = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
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
describe("operator study control loading and recovery", () => {
  it("adds no initial fetch or expanded protocol to page rendering", async () => {
    const start = performance.now()
    const html = renderToStaticMarkup(<StudyControls />)
    expect(html).toContain("Governed profile studies")
    expect(html).not.toContain("textarea")
    expect(performance.now() - start).toBeLessThan(100)
    await act(async () => root.render(<StudyControls />))
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue(
      response({ studies: [], pointer: null, manifests: [] }),
    )
    await act(async () => getButton("Governed profile studies").click())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Prepare a new immutable protocol")
  })
  it("treats accepted promotion as queued and reconciles its exact operation", async () => {
    await act(async () =>
      root.render(
        <PromotionControls
          generation={1}
          stage="control"
          targetManifestId="semantic-experiment-aa-v1"
          lastKnownGoodManifestId="semantic-transcript-pgvector-v1"
          approvalId="approval"
          evaluationId="evaluation"
          exposureCeilingBps={0}
          proposedExposureCeilingBps={500}
          killSwitchEnabled={false}
          ready
        />,
      ),
    )
    fetchMock.mockResolvedValueOnce(response({ ok: true }, 202))
    await act(async () => getButton("Activate bounded stage").click())
    const operation = JSON.parse(fetchMock.mock.calls[0][1].body).operationId
    expect(operation).toMatch(/^[a-f0-9-]{36}$/)
    expect(container.textContent).toContain(
      "Queued execution has not yet been confirmed",
    )
    expect(getButton("Activate bounded stage").disabled).toBe(true)
    fetchMock.mockResolvedValueOnce(
      response({ run: { state: "PENDING" }, pointer: { generation: 1 } }),
    )
    await act(async () => getButton("Refresh transition status").click())
    expect(fetchMock.mock.calls[1][0]).toContain(`operationId=${operation}`)
    expect(container.textContent).toContain("execution is not confirmed")
  })
  it("keeps an uncertain mutation blocked and emergency stop visible", async () => {
    await act(async () =>
      root.render(
        <PromotionControls
          generation={1}
          stage="control"
          targetManifestId="semantic-experiment-aa-v1"
          lastKnownGoodManifestId="semantic-transcript-pgvector-v1"
          approvalId="approval"
          evaluationId="evaluation"
          exposureCeilingBps={0}
          proposedExposureCeilingBps={500}
          killSwitchEnabled={false}
          ready
        />,
      ),
    )
    fetchMock.mockRejectedValueOnce(new Error("connection lost"))
    await act(async () => getButton("Activate bounded stage").click())
    expect(container.textContent).toContain("Acknowledgement unknown")
    expect(container.textContent).not.toContain("unchanged")
    expect(getButton("Activate bounded stage").disabled).toBe(true)
    expect(getButton("Emergency stop").disabled).toBe(false)
  })
})
