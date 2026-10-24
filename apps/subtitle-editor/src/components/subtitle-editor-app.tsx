"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { env } from "@/config/env"
import {
  MIN_SUPPORTED_VIEWPORT_WIDTH,
  buildManagerJobUrl,
  decodeLaunchEnvelope,
  isSupportedViewportWidth,
  type LaunchEnvelope,
} from "@/lib/editor-helpers"
import {
  ManagerClientError,
  bootstrapReviewSession,
  exchangeLaunchCode,
  saveReviewedVtt,
  type BootstrapReviewSessionResult,
} from "@/lib/manager-client"

type EditorPhase =
  | "loading"
  | "blocked"
  | "ready"
  | "saving"
  | "saved"
  | "error"

type Props = {
  initialLaunch: string | null
  initialLaunchEnvelope: LaunchEnvelope | null
}

type Initialization = {
  launch: LaunchEnvelope
  token: string | null
  promise: Promise<{ token: string; review: BootstrapReviewSessionResult }>
}

function describeManagerClientError(error: unknown): string {
  if (error instanceof ManagerClientError) {
    if (error.kind === "validation") {
      return error.message || "The reviewed VTT could not be saved."
    }

    if (error.kind === "conflict") {
      return "This review is out of date. Reload the latest version before saving again."
    }

    if (error.kind === "unauthorized" || error.kind === "forbidden") {
      return "The review session expired or is no longer allowed. Return to Manager and relaunch."
    }

    if (error.kind === "not_found") {
      return "The source job or subtitle artifact is no longer available."
    }

    return error.message || "The Manager request failed."
  }

  if (error instanceof Error) {
    return error.message
  }

  return "The Manager request failed."
}

function getReturnUrl(jobId: string | null): string {
  if (!jobId) {
    return env.NEXT_PUBLIC_MANAGER_BASE_URL
  }

  return buildManagerJobUrl(env.NEXT_PUBLIC_MANAGER_BASE_URL, jobId)
}

export function SubtitleEditorApp({
  initialLaunch,
  initialLaunchEnvelope,
}: Props) {
  const [phase, setPhase] = useState<EditorPhase>("loading")
  const [viewportWidth, setViewportWidth] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeTone, setNoticeTone] = useState<"info" | "error">("info")
  const [draft, setDraft] = useState("")
  const [jobId, setJobId] = useState<string | null>(
    initialLaunchEnvelope?.jobId ?? null,
  )
  const [editSessionToken, setEditSessionToken] = useState<string | null>(null)
  const [bootstrap, setBootstrap] =
    useState<BootstrapReviewSessionResult | null>(null)
  const [baseFingerprint, setBaseFingerprint] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [lastSavedRevision, setLastSavedRevision] = useState<number | null>(
    null,
  )
  const [pendingLoadLabel, setPendingLoadLabel] = useState("Waiting for launch")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const initialization = useRef<Initialization | null>(null)
  const [sessionOwner, setSessionOwner] = useState<Initialization | null>(null)
  const [loadedOwner, setLoadedOwner] = useState<Initialization | null>(null)
  const [retainedDrafts, setRetainedDrafts] = useState<
    { jobId: string; vtt: string }[]
  >([])
  const dirtyRef = useRef(false)
  const operationRef = useRef<object | null>(null)
  const saveIntent = useRef<{ id: string; vtt: string; base: string } | null>(
    null,
  )
  const draftRef = useRef("")

  const resolvedLaunch = useMemo(() => {
    return (
      initialLaunchEnvelope ??
      (initialLaunch ? decodeLaunchEnvelope(initialLaunch) : null)
    )
  }, [initialLaunch, initialLaunchEnvelope])
  const blockedViewport =
    viewportWidth !== null && !isSupportedViewportWidth(viewportWidth)
  const missingLaunch = viewportWidth !== null && !resolvedLaunch

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const updateViewport = () => {
      setViewportWidth(window.innerWidth)
    }

    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [])

  const launchJobId = resolvedLaunch?.jobId
  const launchCode = resolvedLaunch?.launchCode
  useEffect(() => {
    const previous = initialization.current
    if (
      previous &&
      (previous.launch.jobId !== launchJobId ||
        previous.launch.launchCode !== launchCode)
    ) {
      // Keep old unsaved bytes available for deliberate disposition, without
      // carrying their base, intent or capability into another launch.
      if (dirtyRef.current) {
        const vtt = draftRef.current
        setRetainedDrafts((drafts) => [
          ...drafts,
          { jobId: previous.launch.jobId, vtt },
        ])
      }
      initialization.current = null
      operationRef.current = null
      setSessionOwner(null)
      setLoadedOwner(null)
      setEditSessionToken(null)
      setBootstrap(null)
      setBaseFingerprint(null)
      saveIntent.current = null
      draftRef.current = ""
      setDraft("")
      dirtyRef.current = false
      setIsDirty(false)
      setIsSaved(false)
      setLastSavedRevision(null)
      setNotice(null)
    }
    if (!launchJobId || !launchCode) return
    let active = true
    const launch = { jobId: launchJobId, launchCode }
    // Scrub before any media/other request. Referrer policy also covers the
    // initial document. The capability is retained only in this hook instance.
    window.history.replaceState({}, "", window.location.pathname)
    let request = initialization.current
    if (
      !request ||
      request.launch.jobId !== launch.jobId ||
      request.launch.launchCode !== launch.launchCode
    ) {
      const owned = {
        launch,
        token: null as string | null,
        promise: null as unknown as Promise<{
          token: string
          review: BootstrapReviewSessionResult
        }>,
      }
      owned.promise = (async () => {
        const exchanged = await exchangeLaunchCode({
          jobId: launch.jobId,
          launchCode: launch.launchCode,
        })
        owned.token = exchanged.editSessionToken
        const review = await bootstrapReviewSession({
          jobId: launch.jobId,
          editSessionToken: owned.token,
        })
        return { token: owned.token, review }
      })()
      initialization.current = owned
      request = owned
    }
    const owned = request
    setSessionOwner(owned)
    setPhase("loading")
    setJobId(launch.jobId)
    setPendingLoadLabel("Loading review session")
    void owned.promise.then(
      ({ token, review }) => {
        if (!active || initialization.current !== owned) return
        setLoadedOwner(owned)
        setEditSessionToken(token)
        setBootstrap(review)
        setBaseFingerprint(review.baseArtifactFingerprint)
        setDraft(review.vtt)
        draftRef.current = review.vtt
        saveIntent.current = null
        dirtyRef.current = false
        setIsDirty(false)
        setIsSaved(false)
        setLastSavedRevision(null)
        setNotice(null)
        setPhase("ready")
        setPendingLoadLabel("Ready")
      },
      (error) => {
        if (!active || initialization.current !== owned) return
        setEditSessionToken(owned.token)
        setPhase("error")
        setNotice(describeManagerClientError(error))
        setNoticeTone("error")
        setPendingLoadLabel("Could not load review session")
      },
    )
    // Unsubscribe this render, never cancel or repeat the one-use exchange.
    return () => {
      active = false
      operationRef.current = null
    }
  }, [launchJobId, launchCode])

  const ownsLaunch = (owner: Initialization | null) =>
    !!owner &&
    owner.launch.jobId === launchJobId &&
    owner.launch.launchCode === launchCode
  const canSave = ownsLaunch(loadedOwner)
  const canReload = !!editSessionToken && ownsLaunch(sessionOwner)

  async function handleSave() {
    const owner = loadedOwner
    if (
      !canSave ||
      initialization.current !== owner ||
      operationRef.current ||
      !editSessionToken ||
      !bootstrap ||
      !jobId ||
      !baseFingerprint
    )
      return
    const operation = {}
    operationRef.current = operation
    const submitted = draftRef.current
    const previous = saveIntent.current
    const intent =
      previous &&
      previous.vtt === submitted &&
      previous.base === baseFingerprint
        ? previous
        : { id: crypto.randomUUID(), vtt: submitted, base: baseFingerprint }
    saveIntent.current = intent
    setPhase("saving")
    setNotice("Saving reviewed subtitles...")
    setNoticeTone("info")
    try {
      const result = await saveReviewedVtt({
        jobId,
        editSessionToken,
        vtt: submitted,
        baseArtifactFingerprint: intent.base,
        clientSaveId: intent.id,
      })
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(submitted),
      )
      const fingerprint = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      if (
        operationRef.current !== operation ||
        initialization.current !== owner
      )
        return
      if (
        fingerprint !== result.contentFingerprint ||
        result.jobId !== jobId ||
        result.baseArtifactFingerprint !== intent.base
      )
        throw new Error("Manager did not acknowledge the submitted draft.")
      setBaseFingerprint(result.contentFingerprint)
      setLastSavedRevision(result.revision)
      const unchanged = draftRef.current === submitted
      dirtyRef.current = !unchanged
      setIsDirty(!unchanged)
      setIsSaved(unchanged)
      setPhase(unchanged ? "saved" : "ready")
      setNotice(
        `Saved as reviewed revision r${String(result.revision).padStart(4, "0")}.`,
      )
      setNoticeTone("info")
    } catch (error) {
      if (operationRef.current !== operation) return
      setPhase("ready")
      setNotice(describeManagerClientError(error))
      setNoticeTone("error")
    } finally {
      if (operationRef.current === operation) operationRef.current = null
    }
  }

  async function handleReloadLatest() {
    const owner = initialization.current
    if (
      !canReload ||
      owner !== sessionOwner ||
      operationRef.current ||
      !jobId ||
      !editSessionToken
    )
      return
    if (
      isDirty &&
      !window.confirm("Load the latest version and discard this unsaved draft?")
    )
      return
    const operation = {}
    operationRef.current = operation
    const submitted = draftRef.current
    try {
      setPhase("loading")
      setNotice("Reloading the latest reviewed subtitles...")
      setNoticeTone("info")
      const review = await bootstrapReviewSession({ jobId, editSessionToken })
      if (
        operationRef.current !== operation ||
        initialization.current !== owner
      )
        return
      // A response cannot replace a draft edited after this request started.
      if (draftRef.current !== submitted)
        throw new Error(
          "The draft changed while loading. Try loading latest again.",
        )
      setLoadedOwner(owner)
      setBootstrap(review)
      setBaseFingerprint(review.baseArtifactFingerprint)
      setDraft(review.vtt)
      draftRef.current = review.vtt
      saveIntent.current = null
      dirtyRef.current = false
      setIsDirty(false)
      setIsSaved(false)
      setLastSavedRevision(null)
      setPhase("ready")
      setNotice("Loaded the latest reviewed version.")
      setNoticeTone("info")
      setPendingLoadLabel("Ready")
    } catch (error) {
      if (operationRef.current !== operation) return
      setPhase(bootstrap ? "ready" : "error")
      setNotice(describeManagerClientError(error))
      setNoticeTone("error")
    } finally {
      if (operationRef.current === operation) operationRef.current = null
    }
  }

  function handleDraftChange(value: string) {
    draftRef.current = value
    setDraft(value)
    dirtyRef.current = true
    setIsDirty(true)
    setIsSaved(false)
    if (phase === "saved" || phase === "error") setPhase("ready")
    if (noticeTone === "error") setNotice(null)
  }

  function handleReturnToManager() {
    const target = getReturnUrl(jobId)
    const shouldWarn = (isDirty && !isSaved) || retainedDrafts.length > 0
    if (shouldWarn && typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Return to Manager and discard the unsaved draft?",
      )
      if (!confirmed) {
        return
      }
    }

    window.location.assign(target)
  }

  const returnUrl = getReturnUrl(jobId)

  if (viewportWidth === null) {
    return (
      <div className="blocked-shell">
        <div className="blocked-card">
          <h1>Checking editor viewport</h1>
          <p>The subtitle editor is preparing its review layout.</p>
        </div>
      </div>
    )
  }

  if (blockedViewport) {
    return (
      <div className="blocked-shell">
        <div className="blocked-card">
          <h1>Use a wider viewport to review subtitles</h1>
          <p>
            The editor is built for a minimum width of{" "}
            {MIN_SUPPORTED_VIEWPORT_WIDTH}px. Return to Manager for now, or
            reopen this review on a larger screen.
          </p>
          <div className="footer-actions" style={{ marginTop: "1rem" }}>
            <button type="button" onClick={handleReturnToManager}>
              Return to Manager
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (missingLaunch) {
    return (
      <div className="blocked-shell">
        <div className="blocked-card">
          <h1>Could not open the review session</h1>
          <p>The subtitle review session could not be loaded.</p>
          <div className="footer-actions" style={{ marginTop: "1rem" }}>
            <button type="button" onClick={handleReturnToManager}>
              Return to Manager
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div>
          <h1 className="editor-title">Subtitle review editor</h1>
          <p className="editor-subtitle">
            {pendingLoadLabel}
            {bootstrap?.targetLanguage ? ` • ${bootstrap.targetLanguage}` : ""}
            {jobId ? ` • job ${jobId}` : ""}
          </p>
        </div>
        <div className="editor-actions">
          <button type="button" onClick={handleReturnToManager}>
            Return to Manager
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              phase === "saving" ||
              phase === "loading" ||
              !canSave ||
              !bootstrap
            }
          >
            {phase === "saving" ? "Saving..." : "Save reviewed subtitles"}
          </button>
        </div>
      </header>

      {retainedDrafts.map((retained, index) => (
        <section className="panel" key={index}>
          <div className="panel-body stack">
            <p>
              Unsaved draft from job {retained.jobId}. Copy it before
              discarding; it cannot be saved in this review.
            </p>
            <textarea
              className="editor-textarea"
              aria-label={`Unsaved draft from job ${retained.jobId}`}
              value={retained.vtt}
              readOnly
            />
            <button
              type="button"
              onClick={() =>
                setRetainedDrafts((drafts) =>
                  drafts.filter((draft) => draft !== retained),
                )
              }
            >
              Discard retained draft
            </button>
          </div>
        </section>
      ))}
      <main className="editor-main">
        <section className="panel">
          <div className="panel-body stack">
            <div>
              <p className="label">Media preview</p>
              {bootstrap?.mediaUrl ? (
                <iframe
                  title="Subtitle review preview"
                  className="preview-frame"
                  src={bootstrap.mediaUrl}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="notice">
                  {phase === "loading"
                    ? "Loading preview..."
                    : "Preview will appear after the session loads."}
                </div>
              )}
            </div>
            <div className="notice">
              <div className="helper">
                {bootstrap?.baseArtifactKey
                  ? `Editing base artifact ${bootstrap.baseArtifactKey}`
                  : "No reviewed base yet."}
              </div>
              <div className="helper">
                {lastSavedRevision
                  ? `Latest saved revision: r${String(lastSavedRevision).padStart(4, "0")}`
                  : "Draft changes are kept locally until you save."}
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-body stack">
            <div>
              <p className="label">VTT editor</p>
              <textarea
                ref={textareaRef}
                className="editor-textarea"
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                spellCheck={false}
                aria-label="Subtitle VTT text"
                placeholder="WEBVTT..."
                disabled={
                  !canSave ||
                  !bootstrap ||
                  phase === "loading" ||
                  phase === "saving"
                }
              />
            </div>
            <p className="status" aria-live="polite">
              {notice ? (
                <span className={noticeTone === "error" ? "status-error" : ""}>
                  {notice}
                </span>
              ) : (
                "The current draft stays in memory through recoverable errors."
              )}
            </p>
            <div className="footer-actions">
              <button
                type="button"
                onClick={handleSave}
                disabled={
                  !canSave ||
                  !bootstrap ||
                  phase === "saving" ||
                  phase === "loading"
                }
              >
                {phase === "saving" ? "Saving..." : "Save reviewed subtitles"}
              </button>
              <button
                type="button"
                onClick={handleReloadLatest}
                disabled={
                  !canReload || phase === "saving" || phase === "loading"
                }
              >
                Reload latest reviewed version
              </button>
            </div>
            <p className="helper">
              Returning to Manager uses <code>{returnUrl}</code>.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
