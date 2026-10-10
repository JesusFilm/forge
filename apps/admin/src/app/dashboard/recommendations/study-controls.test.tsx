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
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function preparedStatus() {
  return {
    studies: [
      {
        experimentId: "fixture",
        protocolDigest: "a".repeat(64),
        protocol: {
          admissionBps: 1000,
          mode: "calibration",
          endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        },
        activatedAt: null,
        activationId: null,
        enrolledCount: 0,
        privacyRevision: 0,
        evidence: [
          {
            id: "evidence",
            kind: "readiness",
            reviewedAt: new Date().toISOString(),
            payload: {
              validUntil: new Date(Date.now() + 3_600_000).toISOString(),
            },
          },
        ],
        evaluations: [],
      },
    ],
    pointer: { generation: 2, stage: "CONTROL", killSwitchEnabled: false },
    manifests: [],
  }
}
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
  vi.restoreAllMocks()
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
  it("starts incumbent calibration without a graph or a made-up effect margin", async () => {
    fetchMock.mockResolvedValue(
      response({
        studies: [],
        pointer: null,
        manifests: [
          { id: "hybrid-profile-viewing-mode-v1", digest: "a".repeat(64) },
          { id: "hybrid-profile-viewing-mode-aa-v1", digest: "b".repeat(64) },
        ],
      }),
    )
    await act(async () => root.render(<StudyControls />))
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Start incumbent A/A protocol").click())
    const value = JSON.parse(container.querySelector("textarea")!.value)
    expect(value).toMatchObject({
      comparison: "incumbent-aa",
      controlExecution: "profile-viewing-mode-incumbent-v1",
      admissionBps: null,
      cohort: "human-en-english-durable-client-cowatch-mmr-v1",
      minimumUsefulDelta: null,
      cowatch: null,
      composition: null,
    })
  })
  it("retries an uncertain study activation with the exact saved ID and inputs", async () => {
    const status = preparedStatus()
    const study = status.studies[0]!
    fetchMock.mockResolvedValueOnce(response(status))
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await act(async () => root.render(<StudyControls />))
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => {
      const select = container.querySelector("select")!
      select.value = "fixture"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    fetchMock.mockRejectedValueOnce(new Error("lost acknowledgement"))
    await act(async () => getButton("Activate reviewed study").click())
    const first = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(getButton("Activate reviewed study").disabled).toBe(true)
    fetchMock.mockResolvedValueOnce(response({ ok: true }))
    fetchMock.mockResolvedValueOnce(
      response({
        ...status,
        studies: [
          {
            ...study,
            activationId: first.operationId,
            activatedAt: new Date().toISOString(),
          },
        ],
      }),
    )
    await act(async () => getButton("Retry exact saved operation").click())
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(first)
    expect(container.textContent).toContain("Recorded activate reconciled")
  })
  it("keeps one operation locked across close/reopen, POST and reconciliation", async () => {
    const status = preparedStatus()
    const initial = deferred<ReturnType<typeof response>>()
    const submission = deferred<ReturnType<typeof response>>()
    const reconciliation = deferred<ReturnType<typeof response>>()
    fetchMock
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(submission.promise)
      .mockReturnValueOnce(reconciliation.promise)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await act(async () => root.render(<StudyControls />))
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Governed profile studies").click())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getButton("Refresh study status").disabled).toBe(true)
    expect(getButton("Start incumbent A/A protocol").disabled).toBe(true)

    await act(async () => initial.resolve(response(status)))
    await act(async () => {
      const select = container.querySelector("select")!
      select.value = "fixture"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(getButton("Activate reviewed study").disabled).toBe(false)
    await act(async () => {
      // Both events run before React can render the disabled state.
      getButton("Activate reviewed study").click()
      getButton("Activate reviewed study").click()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const operation = JSON.parse(fetchMock.mock.calls[1][1].body).operationId
    expect(operation).toMatch(/^[a-f0-9-]{36}$/)
    expect(getButton("Activate reviewed study").disabled).toBe(true)
    expect(getButton("Refresh study status").disabled).toBe(true)
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Governed profile studies").click())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getButton("Activate reviewed study").disabled).toBe(true)

    await act(async () => submission.resolve(response({ ok: true })))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][0]).toContain(`operationId=${operation}`)
    expect(getButton("Refresh study status").disabled).toBe(true)
    expect(getButton("Retry exact saved operation").disabled).toBe(true)
    expect(getButton("Activate reviewed study").disabled).toBe(true)
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Governed profile studies").click())
    await act(async () => getButton("Retry exact saved operation").click())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getButton("Refresh study status").disabled).toBe(true)

    await act(async () =>
      reconciliation.resolve(
        response({
          ...status,
          studies: [
            {
              ...status.studies[0],
              activatedAt: new Date().toISOString(),
              activationId: operation,
            },
          ],
        }),
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getButton("Refresh study status").disabled).toBe(false)
    expect(container.textContent).toContain("Recorded activate reconciled")
    expect(container.textContent).not.toContain("Retry exact saved operation")
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
