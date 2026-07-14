"use client"

// Shorts Studio job detail (plan 2026-06-11-002 "UI" — the editor screen):
// phase-driven sections, 5s polling while a workflow runs, draft/caption
// editor with a live Remotion <Player> preview (dynamically imported,
// ssr:false), render/retry controls, output panel with Mux playback +
// download + clone.
//
// Perf rules pinned by the plan: inputProps are memoized over a stable
// serialization, text-input commits are debounced ~250ms before reaching the
// preview, and the Player is NEVER keyed by draftVersion (a remount resets
// playback and refetches the waveform's audio windows).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import nextDynamic from "next/dynamic"
import {
  applyTokenTextEdit,
  deletePage,
  deleteToken,
} from "@forge/shorts-compositions/captions"
import type {
  ShortDraft,
  ShortInputProps,
} from "@forge/shorts-compositions/schema"
import {
  SHORT_TEMPLATES,
  type ShortTemplateDefinition,
} from "@forge/shorts-compositions/registry"
import { useVideoPlayerCore } from "@forge/video-player"
import {
  Clapperboard,
  Copy,
  Download,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { apiFetch } from "@/lib/api-fetch"
// Type-only import (erased at compile time) — the route module itself never
// enters the client bundle; its response type is the single source of truth.
import type { ShortsDraftStateResponse } from "@/app/api/shorts/jobs/[id]/draft/route"
import type { JobRecord } from "@/types/job"
import {
  buildShortsCloneHref,
  buildShortsMediaHref,
  formatClipInput,
  formatShortsAnnotation,
  getShortsJobSummary,
  isActiveShortsPhase,
  isEditorShortsPhase,
  type ShortsJobSummary,
} from "./shorts-presenter"
import { ShortsStepsTable } from "./shorts-steps-table"

const SHORTS_POLL_INTERVAL_MS = 5_000
const PREVIEW_DEBOUNCE_MS = 250

// KEEP remotion out of the SSR pass/server bundle: the Player wrapper only
// ever loads in the browser.
const ShortPreview = nextDynamic(() => import("./short-preview"), {
  ssr: false,
  loading: () => <p className="small jobs-empty-state">Loading preview…</p>,
})

type ShortsJobDetailProps = {
  initialJob: JobRecord
}

type EditorState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "loaded"
      draft: ShortDraft | null
      draftVersion: number
      captions: ShortsDraftStateResponse["captions"]
      clipMeta: ShortsDraftStateResponse["clipMeta"]
    }

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

function TemplatePicker({
  value,
  onPick,
}: {
  value: ShortDraft["templateId"]
  onPick: (template: ShortTemplateDefinition) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Template"
      className="grid cols-2 shorts-template-grid"
    >
      {SHORT_TEMPLATES.map((template) => {
        const isSelected = template.id === value
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onPick(template)}
            // The selected border is driven by [aria-checked] in globals.css.
            className="collection-card jobs-card shorts-template-card"
          >
            <strong>{template.label}</strong>
            <p className="small shorts-template-card-description">
              {template.description}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function CaptionPagesEditor({
  draft,
  onDraftChange,
}: {
  draft: ShortDraft
  onDraftChange: (next: ShortDraft) => void
}) {
  const [expandedPage, setExpandedPage] = useState<number | null>(null)

  const pages = draft.captionPages

  return (
    <div className="jobs-field">
      <div className="small jobs-field-label">
        Captions ({pages.length} page{pages.length === 1 ? "" : "s"})
      </div>
      <ul className="jobs-step-detail-list shorts-caption-pages">
        {pages.map((page, pageIndex) => {
          const isExpanded = expandedPage === pageIndex
          return (
            <li
              key={`${page.startMs}-${pageIndex}`}
              className="jobs-step-detail-item"
            >
              <div className="shorts-caption-page-row">
                <button
                  type="button"
                  className="jobs-step-artifact-link shorts-caption-page-toggle"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedPage(isExpanded ? null : pageIndex)}
                  title={isExpanded ? "Collapse page" : "Edit page tokens"}
                >
                  <span className="jobs-step-artifact-label">
                    {formatClipInput(page.startMs / 1000)} · {page.text}
                  </span>
                </button>
                <button
                  type="button"
                  className="jobs-step-artifact-link"
                  aria-label={`Delete caption page ${pageIndex + 1}`}
                  title="Delete this caption page"
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      captionPages: deletePage(pages, pageIndex),
                    })
                  }
                >
                  <Trash2
                    className="jobs-step-artifact-icon"
                    aria-hidden="true"
                    size={14}
                  />
                </button>
              </div>
              {isExpanded ? (
                <div className="shorts-caption-tokens">
                  {page.tokens.map((token, tokenIndex) => (
                    <span
                      key={`${token.fromMs}-${tokenIndex}`}
                      className="shorts-caption-token"
                    >
                      <input
                        className="jobs-input shorts-caption-token-input"
                        // Token text carries the leading-space convention;
                        // applyTokenTextEdit preserves it on edit.
                        value={token.text}
                        aria-label={`Token ${tokenIndex + 1} of page ${pageIndex + 1}`}
                        // Genuinely dynamic: sized to the token's text.
                        style={{
                          width: `${Math.max(4, token.text.length + 1)}ch`,
                        }}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            captionPages: applyTokenTextEdit(
                              pages,
                              pageIndex,
                              tokenIndex,
                              event.target.value,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="jobs-step-artifact-link"
                        aria-label={`Delete token ${tokenIndex + 1} of page ${pageIndex + 1}`}
                        title="Delete this word"
                        onClick={() =>
                          onDraftChange({
                            ...draft,
                            captionPages: deleteToken(
                              pages,
                              pageIndex,
                              tokenIndex,
                            ),
                          })
                        }
                      >
                        <Trash2
                          className="jobs-step-artifact-icon"
                          aria-hidden="true"
                          size={12}
                        />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function OutputPanel({
  job,
  summary,
}: {
  job: JobRecord
  summary: ShortsJobSummary
}) {
  const output = summary.report?.output
  const playbackId = output?.ready ? output.playbackId : null
  const cloneHref = buildShortsCloneHref(summary)

  return (
    <section className="collection-card jobs-card">
      <div className="jobs-card-header">
        <h3 className="jobs-section-title">Output</h3>
        <div className="studio-page-intro-actions">
          <a
            href={buildShortsMediaHref(job.id, "output")}
            download
            className="jobs-primary-button"
          >
            <Download className="icon" aria-hidden="true" />
            Download MP4
          </a>
          {cloneHref ? (
            // Built from a validated route template; typedRoutes can't see
            // through the helper's string return type.
            <Link href={cloneHref as Route} className="jobs-primary-button">
              <Copy className="icon" aria-hidden="true" />
              Clone
            </Link>
          ) : null}
        </div>
      </div>
      {playbackId ? (
        <OutputMuxPlayer playbackId={playbackId} />
      ) : (
        <p className="small jobs-empty-state">
          Mux processing… playback will appear here when the asset is ready.
        </p>
      )}
    </section>
  )
}

function OutputMuxPlayer({ playbackId }: { playbackId: string }) {
  const { containerRef, videoRef } = useVideoPlayerCore({
    src: `https://stream.mux.com/${playbackId}.m3u8`,
    nativeControls: true,
  })

  return (
    <div className="jobs-review-video" ref={containerRef}>
      <div className="shorts-output-frame">
        <video
          className="video-js vjs-default-skin shorts-video-fill"
          ref={videoRef}
          playsInline
        />
      </div>
    </div>
  )
}

export function ShortsJobDetail({ initialJob }: ShortsJobDetailProps) {
  const [job, setJob] = useState<JobRecord>(initialJob)
  const [editor, setEditor] = useState<EditorState>({ status: "loading" })
  const [dirty, setDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<
    "save" | "render" | "retry" | "force-prepare" | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionInfo, setActionInfo] = useState<string | null>(null)
  // Keeps polling alive right after a render/retry 202 until the workflow's
  // phase write lands (the report still shows the pre-launch phase).
  const [recentLaunch, setRecentLaunch] = useState(false)

  const summary = getShortsJobSummary(job)
  const phase = summary?.phase ?? "queued"
  const isLaunchFailed = summary?.isLaunchFailed ?? false
  const activeStall = summary?.activeStall ?? null
  // A launch-failed job (phase "queued" + status "failed") is NOT active:
  // nothing is running, so skip the progress section and phase polling
  // (recentLaunch covers the window right after a retry 202).
  const isActive = isActiveShortsPhase(phase) && !isLaunchFailed && !activeStall
  const isEditor = isEditorShortsPhase(phase)

  // -------------------------------------------------------------------
  // Job polling: 5s while a workflow runs (or a launch was just accepted),
  // stopped on review/terminal phases.
  // -------------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch(
        `/api/jobs/${encodeURIComponent(initialJob.id)}`,
        { cache: "no-store" },
      )
      if (!response.ok) return
      const payload = (await response.json()) as { job?: JobRecord }
      if (payload.job) {
        setJob(payload.job)
      }
    } catch {
      // transient polling failure — keep the previous snapshot
    }
  }, [initialJob.id])

  const shouldPoll = isActive || recentLaunch

  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void refresh()
    }, SHORTS_POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refresh, shouldPoll])

  useEffect(() => {
    // Once the workflow's phase write lands, normal phase-driven polling
    // takes over.
    if (recentLaunch && isActive) {
      setRecentLaunch(false)
    }
  }, [isActive, recentLaunch])

  // -------------------------------------------------------------------
  // Editor state: fetched when entering a reviewable phase; re-fetched
  // after a workflow run completes (captions/draft may have regenerated).
  // -------------------------------------------------------------------
  const [editorLoadKey, setEditorLoadKey] = useState(0)
  const wasActiveRef = useRef(isActive)

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      setEditorLoadKey((key) => key + 1)
    }
    wasActiveRef.current = isActive
  }, [isActive])

  useEffect(() => {
    if (!isEditor) return
    let cancelled = false
    setEditor({ status: "loading" })

    void (async () => {
      try {
        const response = await apiFetch(
          `/api/shorts/jobs/${encodeURIComponent(initialJob.id)}/draft`,
          { cache: "no-store" },
        )
        if (!response.ok) {
          if (!cancelled) {
            setEditor({
              status: "failed",
              message: `Could not load the draft (${response.status}).`,
            })
          }
          return
        }
        const payload = (await response.json()) as ShortsDraftStateResponse
        if (cancelled) return
        setEditor({
          status: "loaded",
          draft: payload.draft?.draft ?? null,
          draftVersion: payload.draft?.draftVersion ?? 0,
          captions: payload.captions,
          clipMeta: payload.clipMeta,
        })
        setDirty(false)
      } catch {
        if (!cancelled) {
          setEditor({
            status: "failed",
            message: "Could not load the draft — reload the page to retry.",
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialJob.id, isEditor, editorLoadKey])

  const draft = editor.status === "loaded" ? editor.draft : null
  const clipMeta = editor.status === "loaded" ? editor.clipMeta : null
  const captions = editor.status === "loaded" ? editor.captions : null
  const localDraftVersion = editor.status === "loaded" ? editor.draftVersion : 0

  const setDraft = useCallback((next: ShortDraft) => {
    setEditor((current) =>
      current.status === "loaded" ? { ...current, draft: next } : current,
    )
    setDirty(true)
  }, [])

  const updateDraft = useCallback(
    (patch: Partial<ShortDraft>) => {
      if (!draft) return
      setDraft({ ...draft, ...patch })
    },
    [draft, setDraft],
  )

  // -------------------------------------------------------------------
  // Preview input props: debounced draft -> memoized over a stable
  // serialization. clipUrl is the SAME-ORIGIN relative media route — the
  // shared composition does not zod-parse its props (verified), and the
  // browser resolves relative URLs against this origin with cookies.
  // -------------------------------------------------------------------
  const debouncedDraft = useDebouncedValue(draft, PREVIEW_DEBOUNCE_MS)
  const debouncedDraftJson = useMemo(
    () => (debouncedDraft ? JSON.stringify(debouncedDraft) : null),
    [debouncedDraft],
  )

  const previewInputProps = useMemo<ShortInputProps | null>(() => {
    if (!debouncedDraftJson || !clipMeta) return null
    const parsed = JSON.parse(debouncedDraftJson) as ShortDraft
    return {
      ...parsed,
      clipUrl: buildShortsMediaHref(initialJob.id, "clip"),
      fps: clipMeta.fps,
      clipDurationSec: clipMeta.durationSec,
      hasAudio: clipMeta.hasAudio,
    }
  }, [clipMeta, debouncedDraftJson, initialJob.id])

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!draft) return false
    setPendingAction("save")
    setActionError(null)
    setActionInfo(null)
    try {
      const response = await apiFetch(
        `/api/shorts/jobs/${encodeURIComponent(job.id)}/draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft: {
              ...draft,
              // Strict schema: an empty title is dropped, not sent as "".
              title:
                draft.title && draft.title.trim().length > 0
                  ? draft.title
                  : undefined,
            },
          }),
        },
      )
      const payload = (await response.json().catch(() => ({}))) as {
        draftVersion?: number
        reason?: string
        error?: string
      }
      if (response.ok && typeof payload.draftVersion === "number") {
        const draftVersion = payload.draftVersion
        setEditor((current) =>
          current.status === "loaded" ? { ...current, draftVersion } : current,
        )
        setDirty(false)
        return true
      }
      if (response.status === 409 && payload.reason === "captions_missing") {
        setActionError(
          "Captions are missing for this short — re-run prepare before saving a draft.",
        )
      } else if (response.status === 409) {
        setActionError(
          payload.error ?? "The draft can't be saved in the current phase.",
        )
      } else {
        setActionError(payload.error ?? "Failed to save the draft.")
      }
      return false
    } catch {
      setActionError("Failed to save the draft.")
      return false
    } finally {
      setPendingAction(null)
    }
  }, [draft, job.id])

  const requestRender = useCallback(async () => {
    if (dirty) {
      const confirmed = window.confirm(
        "You have unsaved draft changes. Save the draft and render?",
      )
      if (!confirmed) return
      const saved = await saveDraft()
      if (!saved) return
    }
    setPendingAction("render")
    setActionError(null)
    setActionInfo(null)
    try {
      const response = await apiFetch(
        `/api/shorts/jobs/${encodeURIComponent(job.id)}/render`,
        { method: "POST" },
      )
      const payload = (await response.json().catch(() => ({}))) as {
        reason?: string
        error?: string
        messages?: string[]
      }
      if (response.status === 202) {
        setRecentLaunch(true)
        await refresh()
        return
      }
      if (response.status === 409 && payload.reason === "already_in_flight") {
        setActionInfo("A render launch is already in flight for this short.")
        setRecentLaunch(true)
        return
      }
      if (response.status === 503) {
        setActionError(
          `Shorts Studio is not configured on this deployment. ${(payload.messages ?? []).join(" ")}`,
        )
        return
      }
      setActionError(payload.error ?? "Failed to launch the render.")
    } catch {
      setActionError("Failed to launch the render.")
    } finally {
      setPendingAction(null)
    }
  }, [dirty, job.id, refresh, saveDraft])

  const requestRetry = useCallback(
    async (force?: "prepare") => {
      if (force === "prepare") {
        const confirmed = window.confirm(
          "This re-runs transcription and DISCARDS caption edits. Continue?",
        )
        if (!confirmed) return
      }
      setPendingAction(force === "prepare" ? "force-prepare" : "retry")
      setActionError(null)
      setActionInfo(null)
      try {
        const response = await apiFetch(
          `/api/shorts/jobs/${encodeURIComponent(job.id)}/retry`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(force ? { force } : {}),
          },
        )
        const payload = (await response.json().catch(() => ({}))) as {
          reason?: string
          error?: string
        }
        if (response.status === 202) {
          setRecentLaunch(true)
          await refresh()
          return
        }
        if (response.status === 409 && payload.reason === "already_in_flight") {
          setActionInfo("A launch is already in flight for this short.")
          setRecentLaunch(true)
          return
        }
        setActionError(payload.error ?? "Failed to relaunch the workflow.")
      } catch {
        setActionError("Failed to relaunch the workflow.")
      } finally {
        setPendingAction(null)
      }
    },
    [job.id, refresh],
  )

  if (!summary) {
    return (
      <section className="collection-card jobs-card">
        <p className="small jobs-empty-state">
          This job has no shorts options.{" "}
          <Link href={`/dashboard/jobs/${job.id}`}>Open in Jobs</Link>
        </p>
      </section>
    )
  }

  const report = summary.report
  const latestError = job.errors.at(-1)
  // Launch-failed (queued + failed) surfaces the same failure card: a plain
  // retry POST relaunches prepare from scratch (todo 010).
  const isFailed =
    phase === "prepare_failed" ||
    phase === "render_failed" ||
    isLaunchFailed ||
    activeStall !== null
  // Stale detection prefers the local draftVersion (polling is stopped in
  // editor phases, so the report mirror may lag the latest save).
  const effectiveDraftVersion = Math.max(
    report?.draftVersion ?? 0,
    localDraftVersion,
  )
  const isStale =
    report?.lastRenderedDraftVersion != null &&
    effectiveDraftVersion > report.lastRenderedDraftVersion
  const runningStepDetails = job.steps.find(
    (step) => step.status === "running" && step.details?.progress != null,
  )?.details
  const captionsAvailable =
    (captions?.count ?? 0) > 0 && clipMeta?.hasAudio !== false
  const annotationLabel =
    summary.annotationLabel ??
    formatShortsAnnotation(captions?.annotation ?? null)

  return (
    <>
      <header className="studio-page-intro studio-page-intro--with-actions">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Shorts Studio</span>
          <h1>{summary.title}</h1>
          <p>
            Source {summary.sourceMuxAssetId} · clip {summary.clipRangeLabel}
            {report?.clipDurationSec != null
              ? ` · ${report.clipDurationSec.toFixed(1)}s`
              : ""}
          </p>
        </div>
        <div className="studio-page-intro-actions">
          <span
            className={`jobs-progress-summary jobs-progress-summary-${summary.phaseTone}`}
          >
            {summary.phaseLabel}
          </span>
          {annotationLabel ? (
            <span
              className="jobs-language-badge jobs-language-badge-muted"
              title={annotationLabel}
            >
              {annotationLabel}
            </span>
          ) : null}
        </div>
      </header>

      {actionError ? <p className="jobs-error-text">{actionError}</p> : null}
      {actionInfo ? (
        <p className="small jobs-status jobs-status-success" role="status">
          {actionInfo}
        </p>
      ) : null}

      {isActive ? (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h3 className="jobs-section-title">
              {phase === "mux_processing"
                ? "Publishing to Mux"
                : phase === "rendering"
                  ? "Rendering"
                  : "Preparing"}
            </h3>
            <span className="small jobs-live-status" role="status">
              {runningStepDetails?.progress != null
                ? `${Math.round(runningStepDetails.progress * 100)}%${
                    runningStepDetails.message
                      ? ` · ${runningStepDetails.message}`
                      : ""
                  }`
                : "Working…"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              runningStepDetails?.progress != null
                ? Math.round(runningStepDetails.progress * 100)
                : undefined
            }
            className="shorts-progress-track"
          >
            <div
              className="shorts-progress-fill"
              // Genuinely dynamic: live worker progress.
              style={{
                width: `${Math.round((runningStepDetails?.progress ?? 0.03) * 100)}%`,
              }}
            />
          </div>
        </section>
      ) : null}

      {isFailed ? (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h3 className="jobs-section-title">
              {activeStall
                ? activeStall.label
                : phase === "prepare_failed"
                  ? "Prepare failed"
                  : phase === "render_failed"
                    ? "Render failed"
                    : "Launch failed"}
            </h3>
            <div className="studio-page-intro-actions">
              <button
                type="button"
                className="jobs-primary-button"
                disabled={pendingAction !== null}
                onClick={() => void requestRetry()}
              >
                <RefreshCw
                  className={`icon${pendingAction === "retry" ? " is-spinning" : ""}`}
                  aria-hidden="true"
                />
                Retry
              </button>
              {phase === "prepare_failed" ? (
                <button
                  type="button"
                  className="jobs-primary-button"
                  disabled={pendingAction !== null}
                  onClick={() => void requestRetry("prepare")}
                >
                  <RefreshCw
                    className={`icon${pendingAction === "force-prepare" ? " is-spinning" : ""}`}
                    aria-hidden="true"
                  />
                  Re-run prepare (force)
                </button>
              ) : null}
            </div>
          </div>
          {activeStall ? (
            <p className="small jobs-empty-state">{activeStall.message}</p>
          ) : latestError ? (
            <>
              <p className="jobs-error-text">{latestError.message}</p>
              {latestError.operatorHint ? (
                <p className="small jobs-empty-state">
                  {latestError.operatorHint}
                </p>
              ) : null}
            </>
          ) : (
            <p className="small jobs-empty-state">No error detail recorded.</p>
          )}
        </section>
      ) : null}

      {phase === "completed" && isStale ? (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h3 className="jobs-section-title">Output is stale</h3>
            <button
              type="button"
              className="jobs-primary-button"
              disabled={pendingAction !== null}
              onClick={() => void requestRender()}
            >
              <Clapperboard
                className={`icon${pendingAction === "render" ? " is-spinning" : ""}`}
                aria-hidden="true"
              />
              Re-render
            </button>
          </div>
          <p className="small jobs-empty-state">
            The draft has changed since this render — re-render to update the
            output.
          </p>
        </section>
      ) : null}

      {phase === "completed" ? (
        <OutputPanel job={job} summary={summary} />
      ) : null}

      {isEditor ? (
        <section className="collection-card jobs-card">
          <div className="jobs-card-header">
            <h3 className="jobs-section-title">Editor</h3>
            <div className="studio-page-intro-actions">
              <button
                type="button"
                className="jobs-primary-button"
                disabled={pendingAction !== null || !draft || !dirty}
                onClick={() => void saveDraft()}
              >
                {pendingAction === "save" ? (
                  <RefreshCw className="icon is-spinning" aria-hidden="true" />
                ) : (
                  <Save className="icon" aria-hidden="true" />
                )}
                {dirty ? "Save draft" : "Saved"}
              </button>
              <button
                type="button"
                className="jobs-primary-button"
                disabled={pendingAction !== null || !draft}
                onClick={() => void requestRender()}
              >
                {pendingAction === "render" ? (
                  <RefreshCw className="icon is-spinning" aria-hidden="true" />
                ) : (
                  <Clapperboard className="icon" aria-hidden="true" />
                )}
                {dirty ? "Save & render" : "Render"}
              </button>
            </div>
          </div>

          {editor.status === "loading" ? (
            <p className="small jobs-empty-state">Loading editor…</p>
          ) : editor.status === "failed" ? (
            <p className="jobs-error-text">{editor.message}</p>
          ) : !draft || !clipMeta ? (
            <p className="small jobs-empty-state">
              The draft or clip metadata is missing — re-run prepare to
              regenerate them.
            </p>
          ) : (
            <div className="grid cols-2 jobs-form-grid">
              {/* Left column: controls */}
              <div className="shorts-editor-controls">
                <div className="jobs-field">
                  <div className="small jobs-field-label">Template</div>
                  <TemplatePicker
                    value={draft.templateId}
                    onPick={(template) =>
                      updateDraft({
                        templateId: template.id,
                        ...template.defaults,
                        showCaptions: captionsAvailable
                          ? template.defaults.showCaptions
                          : false,
                      })
                    }
                  />
                </div>

                <div className="grid cols-2 jobs-form-grid">
                  <label className="jobs-field">
                    <div className="small jobs-field-label">Accent color</div>
                    <input
                      type="color"
                      className="jobs-input shorts-color-input"
                      value={draft.accentColor}
                      onChange={(event) =>
                        updateDraft({ accentColor: event.target.value })
                      }
                    />
                  </label>
                  <label className="jobs-field">
                    <div className="small jobs-field-label">Title</div>
                    <input
                      className="jobs-input"
                      value={draft.title ?? ""}
                      maxLength={80}
                      placeholder="Optional overlay title"
                      onChange={(event) =>
                        updateDraft({
                          title:
                            event.target.value.length > 0
                              ? event.target.value
                              : undefined,
                        })
                      }
                    />
                  </label>
                  {clipMeta.hasAudio ? (
                    <>
                      <label className="jobs-field">
                        <div className="small jobs-field-label">
                          Caption position
                        </div>
                        <select
                          className="jobs-input"
                          value={draft.captionPosition}
                          onChange={(event) =>
                            updateDraft({
                              captionPosition: event.target
                                .value as ShortDraft["captionPosition"],
                            })
                          }
                        >
                          <option value="center">Center band</option>
                          <option value="lower">Lower band</option>
                        </select>
                      </label>
                      <label className="jobs-field">
                        <div className="small jobs-field-label">
                          Caption font
                        </div>
                        <select
                          className="jobs-input"
                          value={draft.captionFont}
                          onChange={(event) =>
                            updateDraft({
                              captionFont: event.target
                                .value as ShortDraft["captionFont"],
                            })
                          }
                        >
                          <option value="montserrat">Montserrat</option>
                          <option value="inter">Inter</option>
                        </select>
                      </label>
                      <label className="jobs-field">
                        <div className="small jobs-field-label">Waveform</div>
                        <select
                          className="jobs-input"
                          value={draft.waveformStyle}
                          onChange={(event) =>
                            updateDraft({
                              waveformStyle: event.target
                                .value as ShortDraft["waveformStyle"],
                            })
                          }
                        >
                          <option value="bars">Bars</option>
                          <option value="none">None</option>
                        </select>
                      </label>
                      {captionsAvailable ? (
                        <label className="jobs-option shorts-option-align-end">
                          <input
                            type="checkbox"
                            checked={draft.showCaptions}
                            onChange={(event) =>
                              updateDraft({
                                showCaptions: event.target.checked,
                              })
                            }
                          />{" "}
                          Show captions
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {captionsAvailable ? (
                  <CaptionPagesEditor draft={draft} onDraftChange={setDraft} />
                ) : (
                  <p className="small jobs-empty-state">
                    Captions unavailable:{" "}
                    {annotationLabel ?? "no audio / unsupported language"}. The
                    short renders without captions
                    {clipMeta.hasAudio === false ? " or waveform" : ""}.
                  </p>
                )}

                {phase !== "prepare_failed" ? (
                  <div>
                    <button
                      type="button"
                      className="jobs-step-artifact-link"
                      disabled={pendingAction !== null}
                      onClick={() => void requestRetry("prepare")}
                      title="Re-runs transcription and discards caption edits"
                    >
                      <RefreshCw
                        className="jobs-step-artifact-icon"
                        aria-hidden="true"
                        size={14}
                      />
                      <span className="jobs-step-artifact-label">
                        Re-run prepare (discards caption edits)
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>

              {/* Right column: live preview */}
              <div className="shorts-preview-pane">
                {previewInputProps ? (
                  <ShortPreview inputProps={previewInputProps} />
                ) : (
                  <p className="small jobs-empty-state">
                    Preview unavailable without clip metadata.
                  </p>
                )}
                {isStale && phase !== "completed" ? (
                  <p className="small jobs-empty-state">
                    The last rendered output is older than this draft.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <ShortsStepsTable job={job} />
    </>
  )
}
