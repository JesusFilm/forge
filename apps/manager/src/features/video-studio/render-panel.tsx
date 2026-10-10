"use client"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { z } from "zod"
import {
  studioRenderStateSchema,
  type StudioRenderState,
} from "@forge/studio-contracts/publication-state"
import type { EditorSession } from "./editor-session"
import { studioCall, StudioClientError } from "./client"
import { prepareRender } from "./prepare-render"
import { PublicationSubmission } from "./publication-submission"
import ExactRenderReview from "./exact-render-review"
import type { RenderHandoff } from "./render-review-state"

export default function RenderPanel({
  session,
  projectId,
  onClose,
  handoff,
}: {
  session: EditorSession
  projectId: string
  onClose: () => void
  handoff?: RenderHandoff
}) {
  const editor = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [state, setState] = useState<StudioRenderState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(
      handoff?.attemptId ?? null,
    )
  const submission = useRef(new PublicationSubmission()).current
  const latestState = useRef(state)
  latestState.current = state
  const refresh = useCallback(async () => {
    const next = studioRenderStateSchema.parse(
      await studioCall("render-state", projectId),
    )
    setState(next)
    return next
  }, [projectId])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = studioRenderStateSchema.parse(
          await studioCall("render-state", projectId),
        )
        if (active) setState(next)
      } catch {
        if (active) setError("Render status unavailable. Your job is retained.")
      } finally {
        if (active) timer = setTimeout(poll, 2500)
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [projectId])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Shorts command failed")
    } finally {
      try {
        await refresh()
      } catch {
        /* Polling reports refresh failure; preserve the submitted command outcome. */
      }
      setBusy(false)
    }
  }
  const base = () => ({
    projectId,
    expectedRevision: editor.revision,
    idempotencyKey: crypto.randomUUID(),
  })
  const locked = Boolean(state?.project.firstPublishedAt),
    current = state?.attempts.find((attempt) =>
      selected
        ? attempt.id === selected
        : attempt.baseRevision === editor.revision,
    ),
    release = current?.catalogRelease
  const approval = state?.approvals.find(
    (approval) => approval.renderAttemptId === current?.id,
  )
  const editable = !locked && editor.status === "saved" && !busy
  const publish = async () => {
    if (!submission.command) {
      if (!release || !current || !approval)
        throw new StudioClientError(409, "Review and approve this render first")
      const binding = {
        ...base(),
        approvalId: approval.id,
        renderAttemptId: current.id,
        releaseId: release.id,
      }
      await submission.prepare(
        binding,
        async (captured) => {
          const response = await fetch("/api/shorts/publication", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: captured.projectId,
              expectedRevision: captured.expectedRevision,
              approvalId: captured.approvalId,
              renderAttemptId: captured.renderAttemptId,
              releaseId: captured.releaseId,
            }),
            signal: AbortSignal.timeout(45000),
          })
          if (!response.ok)
            throw new StudioClientError(
              response.status,
              "Publication is not ready. The release remains hidden.",
            )
          return z
            .object({
              result: z.object({
                releaseId: z.string(),
                readinessId: z.string(),
              }),
            })
            .parse(await response.json()).result
        },
        (captured) => {
          const editorNow = session.getSnapshot(),
            latest = latestState.current
          return (
            editorNow.status === "saved" &&
            editorNow.revision === captured.expectedRevision &&
            !latest?.project.firstPublishedAt &&
            Boolean(
              latest?.attempts.some(
                (attempt) =>
                  attempt.id === captured.renderAttemptId &&
                  attempt.baseRevision === captured.expectedRevision &&
                  attempt.catalogRelease?.id === captured.releaseId,
              ),
            ) &&
            Boolean(
              latest?.approvals.some(
                (approval) =>
                  approval.id === captured.approvalId &&
                  approval.renderAttemptId === captured.renderAttemptId,
              ),
            )
          )
        },
      )
    }
    await submission.submit(
      (command) => studioCall("publish", command),
      (error) =>
        error instanceof StudioClientError && error.publicationRejected,
    )
    await session.reload()
  }
  return (
    <div className="nle-dialog-backdrop">
      <section
        className="nle-dialog nle-production"
        role="dialog"
        aria-modal="true"
        aria-label="Render and publish"
      >
        <header>
          <h2>Render and publish</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p>
          Render the saved revision, review its video, then approve publication
          to Watch.
        </p>
        {error && <p role="alert">{error}</p>}
        <p role="status">
          {state?.project.lifecycle === "PUBLISHED"
            ? "Published on Watch"
            : locked
              ? "Unpublished permanently"
              : current
                ? `Render: ${current.status}. Video processing: ${current.muxJob?.state ?? "Not started"}.`
                : selected
                  ? "Linked render selected; see exact evidence below"
                  : "No render yet"}
        </p>
        {editor.status !== "saved" && (
          <p>Save your changes before rendering.</p>
        )}
        <button
          disabled={
            !editable || ["QUEUED", "RUNNING"].includes(current?.status ?? "")
          }
          onClick={() =>
            void run(async () => {
              const revision = await prepareRender(session, projectId)
              await studioCall("request", {
                ...base(),
                expectedRevision: revision,
                kind: "RENDER",
                instructions: [],
              })
            })
          }
        >
          Render saved revision
        </button>
        {current && ["QUEUED", "RUNNING"].includes(current.status) && (
          <button
            disabled={busy || locked}
            onClick={() =>
              void run(async () => {
                await studioCall("render-cancel", {
                  ...base(),
                  attemptId: current.id,
                })
              })
            }
          >
            Cancel render
          </button>
        )}
        <label>
          Render evidence
          <select
            value={selected ?? current?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="" disabled>
              Select a render
            </option>
            {handoff &&
              !state?.attempts.some(
                (attempt) => attempt.id === handoff.attemptId,
              ) && (
                <option value={handoff.attemptId}>
                  Linked revision {handoff.revision} · {handoff.attemptId}
                </option>
              )}
            {state?.attempts.map((attempt) => (
              <option key={attempt.id} value={attempt.id}>
                Revision {attempt.baseRevision} · {attempt.status} ·{" "}
                {attempt.id}
              </option>
            ))}
          </select>
        </label>
        <p>
          Recent renders are listed here. Older exact render links remain
          usable. Close this panel and use History to inspect attributed changes
          or restore an earlier document as a new revision.
        </p>
        {(selected || current?.id) &&
          (!current || ["SUCCEEDED", "STALE"].includes(current.status)) && (
            <ExactRenderReview
              key={selected ?? current!.id}
              session={session}
              projectId={projectId}
              attemptId={selected ?? current!.id}
              expectedRevision={
                selected === handoff?.attemptId ? handoff?.revision : undefined
              }
              currentRevision={state?.project.revision ?? editor.revision}
              locked={locked}
              onApproved={refresh}
            />
          )}
        {(!locked || submission.command) && (
          <button
            disabled={
              busy ||
              (!submission.command &&
                (!editable ||
                  !release ||
                  !approval ||
                  current?.baseRevision !== editor.revision ||
                  state?.project.revision !== editor.revision))
            }
            onClick={() => void run(publish)}
          >
            {submission.command
              ? "Retry exact publication"
              : "Publish to Watch"}
          </button>
        )}
        {submission.rejected && !locked && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                submission.discardRejected()
                await publish()
              })
            }
          >
            Prepare current approved render
          </button>
        )}
        {submission.command && !submission.rejected && (
          <p>
            An uncertain submission is retained. Retry resolves its original
            receipt; it cannot publish another version.
          </p>
        )}
        {state?.project.lifecycle === "PUBLISHED" && (
          <>
            <p>
              Published content cannot be edited, replaced or published again.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await studioCall("unpublish", base())
                  await session.reload()
                })
              }
            >
              Unpublish permanently
            </button>
          </>
        )}
        {locked && state?.project.lifecycle === "UNPUBLISHED" && (
          <p>
            This project remains locked. Create a new project for another
            publication.
          </p>
        )}
      </section>
    </div>
  )
}
