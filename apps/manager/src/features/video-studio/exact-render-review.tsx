"use client"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { z } from "zod"
import { orderedStudioSpeech } from "@forge/studio-contracts/production"
import {
  studioInspectionContextSchema,
  studioInspectionEvidenceSchema,
  type StudioInspectionContext,
  type StudioInspectionEvidence,
} from "@forge/studio-contracts/inspection"
import type { EditorSession } from "./editor-session"
import { studioCall, StudioClientError } from "./client"
import { canApproveRenderedEvidence } from "./render-review-state"

async function post(path: string, input: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok)
    throw new StudioClientError(
      response.status,
      "Exact render review unavailable; refresh or retry.",
    )
  return response
}
export default function ExactRenderReview({
  session,
  projectId,
  attemptId,
  expectedRevision,
  currentRevision,
  locked,
  onApproved,
}: {
  session: EditorSession
  projectId: string
  attemptId: string
  expectedRevision?: number
  currentRevision: number
  locked: boolean
  onApproved: () => Promise<unknown>
}) {
  const editor = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [context, setContext] = useState<StudioInspectionContext | null>(null)
  const [inspection, setInspection] = useState<StudioInspectionEvidence | null>(
    null,
  )
  const [url, setUrl] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [approved, setApproved] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])
  const keys = useRef({
    script: crypto.randomUUID(),
    render: crypto.randomUUID(),
  })
  useEffect(() => {
    let active = true
    void post(
      "/api/shorts/render-evidence",
      { projectId, attemptId },
      lifetime.current!.signal,
    )
      .then((response) => response.json())
      .then((raw) => {
        const value = studioInspectionContextSchema.parse(raw.result)
        if (
          value.projectId !== projectId ||
          value.attemptId !== attemptId ||
          (expectedRevision !== undefined &&
            value.revision !== expectedRevision)
        )
          throw new StudioClientError(
            409,
            "The link revision does not match this render. Open the exact render from history.",
          )
        if (active) setContext(value)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [projectId, attemptId, expectedRevision])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Review failed")
    } finally {
      setBusy(false)
    }
  }
  const stale = Boolean(
    context &&
    (context.stale ||
      context.revision !== currentRevision ||
      context.revision !== editor.revision),
  )
  const eligible = canApproveRenderedEvidence({
    selectedAttemptId: attemptId,
    reviewedAttemptId: reviewed && url ? attemptId : null,
    evidenceRevision: context?.revision ?? null,
    currentRevision,
    editorRevision: editor.revision,
    editorStatus: editor.status,
    stale,
    locked,
  })
  const speech = context
    ? orderedStudioSpeech(context.document).filter(
        (item) => !item.speech!.suppressed && item.speech!.text.length > 0,
      )
    : []
  return (
    <section aria-label="Exact rendered evidence">
      {error && <p role="alert">{error}</p>}
      {!context ? (
        <p>Loading exact render evidence…</p>
      ) : (
        <>
          <h3>Rendered revision {context.revision}</h3>
          <p>
            Render {attemptId}. Current project revision {currentRevision}.
          </p>
          {stale && (
            <p role="status">
              This is prior evidence. The project has advanced; this output
              cannot approve the current revision.
            </p>
          )}
          <p>
            Give feedback, including optional timestamps, in your existing
            Claude or Codex conversation. Direct edits remain in Studio; ask
            your agent to reread current state and history before revising.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const response = await post(
                  "/api/shorts/render-review",
                  {
                    projectId,
                    renderAttemptId: attemptId,
                  },
                  lifetime.current!.signal,
                )
                const bytes = await response.blob()
                lifetime.current!.signal.throwIfAborted()
                setUrl(URL.createObjectURL(bytes))
                setReviewed(false)
              })
            }
          >
            Watch this exact render
          </button>
          {url && (
            <video
              controls
              preload="metadata"
              src={url}
              style={{
                width: "100%",
                aspectRatio: `${context.document.width}/${context.document.height}`,
                maxHeight: 360,
              }}
            />
          )}
          <h4>Effective script and voice for this render</h4>
          {!speech.length && <p>No effective spoken text.</p>}
          {speech.map((item) => (
            <fieldset key={item.id}>
              <legend>
                {item.speech!.role} · {item.id}
              </legend>
              <pre className="nle-spoken-bytes">{item.speech!.text}</pre>
              <p>
                {context.document.language} · {item.speech!.provider} /{" "}
                {item.speech!.model} · voice version{" "}
                {item.speech!.voice.versionId}
              </p>
              <details>
                <summary>Exact voice settings and pronunciation</summary>
                <pre>
                  {JSON.stringify(
                    {
                      voice: item.speech!.voice,
                      settings: item.speech!.settings,
                      pronunciation: item.speech!.pronunciation,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </fieldset>
          ))}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const response = await post(
                  "/api/shorts/render-inspection",
                  {
                    projectId,
                    attemptId,
                  },
                  lifetime.current!.signal,
                )
                const result = z
                  .object({
                    result: z.object({
                      evidence: studioInspectionEvidenceSchema,
                    }),
                  })
                  .parse(await response.json()).result
                if (
                  result.evidence.attemptId !== attemptId ||
                  result.evidence.output.digest !== context.output.digest
                )
                  throw new StudioClientError(
                    409,
                    "Inspection output identity changed",
                  )
                setInspection(result.evidence)
              })
            }
          >
            {inspection
              ? "Refresh sampled inspection"
              : "Load sampled inspection"}
          </button>
          {inspection && (
            <section aria-label="Sampled inspection">
              <h4>Inspection: {inspection.status}</h4>
              <p>
                {inspection.samples.length} sampled frames of{" "}
                {inspection.coverage.totalFrames};{" "}
                {inspection.coverage.sampledCutCount} of{" "}
                {inspection.coverage.cutCount} cuts. Server preparation:{" "}
                {(inspection.preparationMs / 1000).toFixed(2)} seconds. Audio
                measurements: {inspection.coverage.audio.status}.
              </p>
              {inspection.limitations.map((limit, i) => (
                <p key={i}>{limit}</p>
              ))}
              <ul>
                {inspection.findings.map((finding, i) => (
                  <li key={i}>{finding.message}</li>
                ))}
              </ul>
              {inspection.samples.map((sample) => (
                <figure key={sample.frame}>
                  {/* Bounded inline evidence is already retained; never send it through image optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- exact bounded inline evidence must not be optimized or refetched */}
                  <img
                    src={`data:${sample.image.mimeType};base64,${sample.image.data}`}
                    alt={`Rendered frame ${sample.frame} at ${(sample.timestampMs / 1000).toFixed(2)} seconds`}
                    width={320}
                    style={{ maxWidth: "100%", height: "auto" }}
                  />
                  <figcaption>
                    {(sample.timestampMs / 1000).toFixed(2)}s ·{" "}
                    {sample.reasons.join(", ")}
                  </figcaption>
                </figure>
              ))}
            </section>
          )}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={!url || stale || locked || editor.status !== "saved"}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I reviewed these exact rendered bytes and the effective script and
            voice settings above.
          </label>
          <button
            disabled={busy || !eligible || approved}
            onClick={() =>
              void run(async () => {
                const latest = session.getSnapshot()
                if (
                  latest.status !== "saved" ||
                  latest.revision !== context.revision
                )
                  throw new StudioClientError(
                    409,
                    "Save or reconcile your changes before approval",
                  )
                if (speech.length)
                  await studioCall("approve", {
                    projectId,
                    expectedRevision: context.revision,
                    idempotencyKey: keys.current.script,
                    kind: "SCRIPT",
                  })
                await studioCall("approve", {
                  projectId,
                  expectedRevision: context.revision,
                  idempotencyKey: keys.current.render,
                  kind: "PUBLICATION",
                  renderAttemptId: attemptId,
                })
                setApproved(true)
                await onApproved()
              })
            }
          >
            {approved
              ? "Approved exact render"
              : "Approve this exact render and script"}
          </button>
        </>
      )}
    </section>
  )
}
