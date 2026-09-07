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
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import type { EditorSession } from "./editor-session"
import { studioCall, StudioClientError } from "./client"
import { PublicationSubmission } from "./publication-submission"

export default function RenderPanel({
  session,
  projectId,
  watchOrigin,
  onClose,
}: {
  session: EditorSession
  projectId: string
  watchOrigin?: string
  onClose: () => void
}) {
  const editor = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [state, setState] = useState<StudioRenderState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState<string | null>(null),
    [reviewUrl, setReviewUrl] = useState<string | null>(null),
    [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null)
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
  useEffect(
    () => () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    },
    [reviewUrl],
  )
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Studio command failed")
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
    current = state?.attempts.find(
      (attempt) => attempt.baseRevision === editor.revision,
    ),
    release = current?.catalogRelease
  const approval = state?.approvals.find(
    (approval) => approval.renderAttemptId === current?.id,
  )
  const editable = !locked && editor.status === "saved" && !busy
  const review = async () => {
    if (!current) return
    const response = await fetch("/api/studio/render-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, renderAttemptId: current.id }),
      signal: AbortSignal.timeout(45000),
    })
    if (!response.ok)
      throw new StudioClientError(response.status, "Render review unavailable")
    const blob = await response.blob()
    setReviewUrl(URL.createObjectURL(blob))
    setReviewAttemptId(current.id)
    setReviewed(null)
  }
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
          const response = await fetch("/api/studio/publication", {
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
  const watchHref =
    release?.video.slug && release.dub.language?.slug
      ? `${(watchOrigin ?? "https://www.jesusfilm.org").replace(/\/$/, "")}/watch${buildCanonicalWatchVideoPath(encodeURIComponent(release.video.slug), encodeURIComponent(release.dub.language.slug))}`
      : null
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
              await studioCall("request", {
                ...base(),
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
        {release && (
          <button disabled={busy} onClick={() => void run(review)}>
            Review rendered video
          </button>
        )}
        {reviewUrl && (
          <video
            controls
            src={reviewUrl}
            style={{ width: "100%", maxHeight: 360 }}
          />
        )}
        {reviewUrl && current && reviewAttemptId === current.id && !locked && (
          <label>
            <input
              type="checkbox"
              checked={reviewed === current.id}
              onChange={(event) =>
                setReviewed(event.target.checked ? current.id : null)
              }
            />
            I reviewed this rendered revision.
          </label>
        )}
        {release && !locked && (
          <button
            disabled={
              !editable ||
              reviewed !== current?.id ||
              reviewAttemptId !== current?.id ||
              Boolean(approval)
            }
            onClick={() =>
              void run(async () => {
                await studioCall("approve", {
                  ...base(),
                  kind: "PUBLICATION",
                  renderAttemptId: current!.id,
                })
              })
            }
          >
            {approval ? "Approved" : "Approve this render"}
          </button>
        )}
        {(!locked || submission.command) && (
          <button
            disabled={
              busy ||
              (!submission.command && (!editable || !release || !approval))
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
            {watchHref && (
              <a href={watchHref} target="_blank" rel="noreferrer">
                Open on Watch
              </a>
            )}
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
