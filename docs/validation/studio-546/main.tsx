import React, { Suspense, useState, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { studioDocumentSchema, type Short } from "@forge/studio-contracts"
import { EditorSession } from "@qa/editor-session"
import "@qa/studio.css"
const Panel = React.lazy(() => import("@qa/render-panel"))
const Allowance = React.lazy(() => import("@candidate-allowance"))
const rawFetch = window.fetch.bind(window)
const doc = studioDocumentSchema.parse(
  await (await rawFetch("/document.json")).json(),
)
let project: Short = {
  projectId: "fixture",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "fixture", authority: "interactive" },
  document: doc,
}
const approvals: Array<{ id: string; renderAttemptId: string }> = []
let remaining = 0
let lost = false
const receipts = new Set<string>()
const session = new EditorSession(project, {
  read: async () => project,
  apply: async () => ({
    projectId: "fixture",
    revision: project.revision,
    outcome: "ACCEPTED",
  }),
})
const metrics = {
  requests: [] as Array<{ url: string; action?: string; at: number }>,
  shifts: 0,
  openedAt: 0,
  appReadyAt: 0,
}
new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    if (
      !(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput
    )
      metrics.shifts += (entry as PerformanceEntry & { value: number }).value
}).observe({ type: "layout-shift", buffered: true })
Object.assign(window, { reviewFixture: { metrics, session } })
window.fetch = async (request, options) => {
  const url = String(request)
  if (!url.startsWith("/api/")) return rawFetch(request, options)
  const input = JSON.parse(String(options?.body ?? "{}"))
  metrics.requests.push({ url, action: input.action, at: performance.now() })
  await new Promise((resolve) => setTimeout(resolve, 180))
  if (url.endsWith("render-review")) return rawFetch("/render.mp4")
  if (url.endsWith("render-evidence") || url.endsWith("render-inspection")) {
    const evidence = await (
      await rawFetch(
        url.endsWith("render-evidence") ? "/context.json" : "/evidence.json",
      )
    ).json()
    const base = {
      ...evidence,
      projectId: "fixture",
      attemptId: input.attemptId,
      revision: 1,
    }
    return Response.json({
      result: url.endsWith("render-evidence")
        ? {
            projectId: "fixture",
            attemptId: input.attemptId,
            revision: 1,
            currentRevision: project.revision,
            stale: project.revision !== 1,
            inputHash: evidence.inputHash,
            output: evidence.output,
            document: doc,
            outputReadyAt: evidence.outputReadyAt,
            evidence: null,
          }
        : {
            evidence: base,
            stale: project.revision !== 1,
            currentRevision: project.revision,
            cacheHit: true,
          },
    })
  }
  if (input.action === "render-state")
    return Response.json({
      result: {
        project,
        attempts: [
          {
            id: "recent",
            baseRevision: 1,
            status: "SUCCEEDED",
            createdAt: new Date().toISOString(),
            renderJob: { state: "SUCCEEDED", generation: 1 },
            muxJob: null,
            catalogRelease: null,
          },
        ],
        approvals,
        publication: null,
      },
    })
  if (input.action === "read") return Response.json({ result: project })
  if (input.action === "narration-status")
    return Response.json({
      result: { used: 2, allowed: 2 + remaining, remaining },
    })
  if (input.action === "narration-authorize") {
    if (!receipts.has(input.input.idempotencyKey)) {
      receipts.add(input.input.idempotencyKey)
      remaining += input.input.additionalPasses
    }
    if (!lost) {
      lost = true
      throw new TypeError("Synthetic lost authorization response")
    }
    return Response.json({
      result: {
        projectId: "fixture",
        revision: project.revision,
        outcome: "ACCEPTED",
      },
    })
  }
  if (input.action === "approve") {
    if (input.input.expectedRevision !== project.revision)
      return Response.json({ error: "CONFLICT" }, { status: 409 })
    if (input.input.kind === "PUBLICATION")
      approvals.push({
        id: "approval",
        renderAttemptId: input.input.renderAttemptId,
      })
    return Response.json({
      result: {
        projectId: "fixture",
        revision: project.revision,
        outcome: "ACCEPTED",
      },
    })
  }
  return Response.json(
    { error: "Synthetic fixture does not execute production commands" },
    { status: 400 },
  )
}
function App() {
  useEffect(() => {
    metrics.appReadyAt = performance.now()
  }, [])
  const [open, setOpen] = useState(
      new URLSearchParams(location.search).has("handoff"),
    ),
    [allowance, setAllowance] = useState(false),
    [snapshot, setSnapshot] = useState("")
  return (
    <>
      <h1>Exact render review fixture</h1>
      <p>
        Local synthetic state; real contained-render media. No authentication,
        provider execution, or production state.
      </p>
      <button
        onClick={() => {
          metrics.openedAt = performance.now()
          setOpen(true)
        }}
      >
        Open review
      </button>
      <button
        onClick={() => {
          project = { ...project, revision: 2 }
          void session.reload()
        }}
      >
        Simulate human edit
      </button>
      <button
        onClick={() =>
          session.edit((doc) => ({ ...doc, title: "Unsaved human edit" }))
        }
      >
        Simulate unsaved edit
      </button>
      <button onClick={() => setAllowance(true)}>Open allowance</button>
      <button
        onClick={() =>
          setSnapshot(
            JSON.stringify(
              {
                ...metrics,
                now: performance.now(),
                navigation: performance
                  .getEntriesByType("navigation")
                  .map((e) => e.toJSON()),
                resources: performance
                  .getEntriesByType("resource")
                  .map((e) => ({
                    name: e.name,
                    startTime: e.startTime,
                    duration: e.duration,
                  })),
                retainedAllowance: remaining,
              },
              null,
              2,
            ),
          )
        }
      >
        Refresh visible metrics
      </button>
      <pre id="fixture-metrics" style={{ maxHeight: 220, overflow: "auto" }}>
        {snapshot}
      </pre>
      <Suspense fallback={<p>Loading panel…</p>}>
        {open && (
          <Panel
            session={session}
            projectId="fixture"
            handoff={
              new URLSearchParams(location.search).has("handoff")
                ? { attemptId: "historic", revision: 1 }
                : undefined
            }
            onClose={() => setOpen(false)}
          />
        )}{" "}
        {allowance && <Allowance session={session} projectId="fixture" />}
      </Suspense>
    </>
  )
}
createRoot(document.getElementById("root")!).render(<App />)
