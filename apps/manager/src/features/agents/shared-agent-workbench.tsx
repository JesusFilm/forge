"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { apiFetch } from "@/lib/api-fetch"
import type {
  SharedAgentCatalogItem,
  SharedAgentRunRequest,
  SharedAgentRunResponse,
  SharedAgentSession,
  SharedAgentSessionResponse,
  SharedAgentSubtitleContextStatus,
  SharedAgentVideoHydrationResponse,
  SharedAgentVideoItem,
} from "./shared-agent-contract"

function buildDraft(agent: SharedAgentCatalogItem): SharedAgentRunRequest {
  return {
    goal: agent.starterPrompt,
    supportingContext: "",
    fields: Object.fromEntries(agent.fields.map((field) => [field.key, ""])),
  }
}

function getApiErrorMessage(
  payload:
    | {
        error?: string
        details?: string[]
      }
    | null
    | undefined,
): string {
  return payload?.details?.length
    ? payload.details.join(" ")
    : payload?.error || "Shared agent request failed."
}

function getSubtitleContextCopy(
  status: SharedAgentSubtitleContextStatus,
): string {
  if (status === "included") {
    return "Subtitle transcript context included."
  }

  if (status === "unavailable") {
    return "No trusted subtitle transcript was available."
  }

  return "Metadata-only hydration."
}

function getApprovalStatusCopy(status: "pending" | "approved" | "declined") {
  if (status === "approved") return "Applied"
  if (status === "declined") return "Declined"
  return "Approval required"
}

export function SharedAgentWorkbench({
  agents,
}: {
  agents: SharedAgentCatalogItem[]
}) {
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "")
  const selectedAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  )
  const [draft, setDraft] = useState<SharedAgentRunRequest | null>(
    selectedAgent ? buildDraft(selectedAgent) : null,
  )
  const [session, setSession] = useState<SharedAgentSession | null>(null)
  const [result, setResult] = useState<SharedAgentRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [videoQuery, setVideoQuery] = useState("")
  const [videoResults, setVideoResults] = useState<SharedAgentVideoItem[]>([])
  const [videoSearchError, setVideoSearchError] = useState<string | null>(null)
  const [isSearchingVideos, setIsSearchingVideos] = useState(false)
  const [selectedVideo, setSelectedVideo] =
    useState<SharedAgentVideoItem | null>(null)
  const [subtitleContextStatus, setSubtitleContextStatus] =
    useState<SharedAgentSubtitleContextStatus>("omitted")
  const [isHydratingVideo, setIsHydratingVideo] = useState(false)
  const searchRequestIdRef = useRef(0)
  const hydrationRequestIdRef = useRef(0)
  const previousAgentIdRef = useRef(selectedAgentId)
  const selectedVideoDocumentId = selectedVideo?.documentId ?? null

  function syncSession(nextSession: SharedAgentSession) {
    setSession(nextSession)
    setResult(nextSession.latestRun)
    if (nextSession.latestDraft) {
      setDraft(nextSession.latestDraft)
    }
  }

  useEffect(() => {
    if (!selectedAgent) {
      setDraft(null)
      setSession(null)
      setResult(null)
      previousAgentIdRef.current = selectedAgentId
      return
    }

    if (!selectedVideoDocumentId) {
      setDraft(buildDraft(selectedAgent))
      setSession(null)
      setResult(null)
      setError(null)
      setSubtitleContextStatus("omitted")
      previousAgentIdRef.current = selectedAgentId
      return
    }

    if (previousAgentIdRef.current === selectedAgentId) {
      return
    }

    previousAgentIdRef.current = selectedAgentId
    const requestId = ++hydrationRequestIdRef.current
    setIsHydratingVideo(true)
    setError(null)
    setSession(null)
    setResult(null)

    void (async () => {
      try {
        const response = await apiFetch(
          `/api/agents/videos/${encodeURIComponent(selectedVideoDocumentId)}/hydrate?agentId=${encodeURIComponent(selectedAgent.id)}`,
        )
        const payload = (await response.json()) as
          | SharedAgentVideoHydrationResponse
          | { error?: string; details?: string[] }

        if (requestId !== hydrationRequestIdRef.current) {
          return
        }

        if (!response.ok || !("draft" in payload)) {
          setError(getApiErrorMessage("error" in payload ? payload : undefined))
          return
        }

        setSelectedVideo(payload.video)
        setSubtitleContextStatus(payload.subtitleContextStatus)
        setDraft(payload.draft)
      } catch (requestError) {
        if (requestId !== hydrationRequestIdRef.current) {
          return
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to hydrate library video.",
        )
      } finally {
        if (requestId === hydrationRequestIdRef.current) {
          setIsHydratingVideo(false)
        }
      }
    })()
  }, [selectedAgent, selectedAgentId, selectedVideoDocumentId])

  useEffect(() => {
    const trimmedQuery = videoQuery.trim()
    if (trimmedQuery.length < 2) {
      setVideoResults([])
      setVideoSearchError(null)
      setIsSearchingVideos(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      const requestId = ++searchRequestIdRef.current
      setIsSearchingVideos(true)
      setVideoSearchError(null)

      void (async () => {
        try {
          const response = await apiFetch(
            `/api/agents/videos?query=${encodeURIComponent(trimmedQuery)}`,
          )
          const payload = (await response.json()) as
            | { videos: SharedAgentVideoItem[] }
            | { error?: string; details?: string[] }

          if (requestId !== searchRequestIdRef.current) {
            return
          }

          if (!response.ok || !("videos" in payload)) {
            setVideoSearchError(
              getApiErrorMessage("error" in payload ? payload : undefined),
            )
            return
          }

          setVideoResults(payload.videos)
        } catch (requestError) {
          if (requestId !== searchRequestIdRef.current) {
            return
          }

          setVideoSearchError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to search library videos.",
          )
        } finally {
          if (requestId === searchRequestIdRef.current) {
            setIsSearchingVideos(false)
          }
        }
      })()
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [videoQuery])

  async function hydrateSelectedVideo(video: SharedAgentVideoItem) {
    if (!selectedAgent) return

    const requestId = ++hydrationRequestIdRef.current
    setIsHydratingVideo(true)
    setError(null)
    setSession(null)
    setResult(null)

    try {
      const response = await apiFetch(
        `/api/agents/videos/${encodeURIComponent(video.documentId)}/hydrate?agentId=${encodeURIComponent(selectedAgent.id)}`,
      )
      const payload = (await response.json()) as
        | SharedAgentVideoHydrationResponse
        | { error?: string; details?: string[] }

      if (requestId !== hydrationRequestIdRef.current) {
        return
      }

      if (!response.ok || !("draft" in payload)) {
        setError(getApiErrorMessage("error" in payload ? payload : undefined))
        return
      }

      setSelectedVideo(payload.video)
      setSubtitleContextStatus(payload.subtitleContextStatus)
      setDraft(payload.draft)
      setVideoResults([])
    } catch (requestError) {
      if (requestId !== hydrationRequestIdRef.current) {
        return
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to hydrate library video.",
      )
    } finally {
      if (requestId === hydrationRequestIdRef.current) {
        setIsHydratingVideo(false)
      }
    }
  }

  function clearSelectedVideo() {
    hydrationRequestIdRef.current += 1
    setSelectedVideo(null)
    setSubtitleContextStatus("omitted")
    setResult(null)
    setSession(null)
    setError(null)
    setDraft(selectedAgent ? buildDraft(selectedAgent) : null)
  }

  async function ensureSession(): Promise<SharedAgentSession> {
    if (
      session &&
      session.agent.id === selectedAgent?.id &&
      (session.video?.documentId ?? null) === selectedVideoDocumentId
    ) {
      return session
    }

    const response = await apiFetch("/api/agents/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgent?.id,
        videoDocumentId: selectedVideoDocumentId ?? undefined,
      }),
    })
    const payload = (await response.json()) as
      | SharedAgentSessionResponse
      | { error?: string; details?: string[] }

    if (!response.ok || !("session" in payload)) {
      throw new Error(
        getApiErrorMessage("error" in payload ? payload : undefined),
      )
    }

    syncSession(payload.session)
    return payload.session
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAgent || !draft) return

    setIsRunning(true)
    setError(null)

    try {
      const currentSession = await ensureSession()
      const response = await apiFetch(
        `/api/agents/sessions/${encodeURIComponent(currentSession.id)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
        },
      )
      const payload = (await response.json()) as
        | SharedAgentSessionResponse
        | { error?: string; details?: string[] }

      if (!response.ok || !("session" in payload)) {
        setError(getApiErrorMessage("error" in payload ? payload : undefined))
        return
      }

      syncSession(payload.session)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Shared agent execution failed.",
      )
    } finally {
      setIsRunning(false)
    }
  }

  async function handleApproval(action: "approve" | "decline") {
    if (!result?.pendingApproval) return

    setIsApproving(true)
    setError(null)

    try {
      const response = await apiFetch(
        `/api/agents/approvals/${encodeURIComponent(result.pendingApproval.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      )
      const payload = (await response.json()) as
        | SharedAgentSessionResponse
        | { error?: string; details?: string[] }

      if (!response.ok || !("session" in payload)) {
        setError(getApiErrorMessage("error" in payload ? payload : undefined))
        return
      }

      syncSession(payload.session)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Shared agent approval failed.",
      )
    } finally {
      setIsApproving(false)
    }
  }

  if (!selectedAgent || !draft) {
    return <p className="small agents-empty">No shared agents configured.</p>
  }

  return (
    <div className="shared-agents-workbench">
      <div
        className="shared-agent-list"
        role="tablist"
        aria-label="Shared agents"
      >
        {agents.map((agent) => {
          const isActive = agent.id === selectedAgent.id
          return (
            <button
              key={agent.id}
              type="button"
              className={`shared-agent-list-item${isActive ? " is-active" : ""}`}
              onClick={() => setSelectedAgentId(agent.id)}
              role="tab"
              aria-selected={isActive}
            >
              <span className="shared-agent-list-title">{agent.name}</span>
              <span className="shared-agent-list-summary">{agent.summary}</span>
            </button>
          )
        })}
      </div>

      <div className="shared-agent-panel">
        <div className="shared-agent-panel-header">
          <div>
            <h4 className="shared-agent-panel-title">{selectedAgent.name}</h4>
            <p className="small shared-agent-panel-copy">
              {selectedAgent.description}
            </p>
          </div>
          <div className="shared-agent-panel-badges">
            <span className="badge paused">{selectedAgent.category}</span>
            {selectedAgent.capabilities.supportsWriteback ? (
              <span className="badge active">Approval-gated apply</span>
            ) : (
              <span className="badge">Advisory</span>
            )}
          </div>
        </div>

        <section className="shared-agent-library">
          <div className="shared-agent-library-header">
            <div>
              <h5 className="shared-agent-library-title">Library video</h5>
              <p className="small shared-agent-library-copy">
                Search the library and hydrate this agent with real video
                metadata and subtitle context.
              </p>
            </div>
            {selectedVideo ? (
              <button
                type="button"
                className="collection-cache-clear jobs-refresh-link"
                onClick={clearSelectedVideo}
              >
                Clear video
              </button>
            ) : null}
          </div>

          <label className="jobs-field">
            <span className="jobs-field-label">Search library videos</span>
            <input
              className="jobs-input"
              value={videoQuery}
              placeholder="Search by title or slug"
              onChange={(event) => setVideoQuery(event.target.value)}
            />
          </label>

          {selectedVideo ? (
            <div className="shared-agent-video-selection">
              <div>
                <div className="shared-agent-video-title">
                  {selectedVideo.title}
                </div>
                <div className="small shared-agent-video-meta">
                  {selectedVideo.primaryLanguage ?? "Language unavailable"}
                  {selectedVideo.slug ? ` · ${selectedVideo.slug}` : ""}
                </div>
              </div>
              <div className="small shared-agent-video-status">
                {getSubtitleContextCopy(subtitleContextStatus)}
              </div>
              {selectedVideo.description ? (
                <p className="small shared-agent-video-description">
                  {selectedVideo.description}
                </p>
              ) : null}
            </div>
          ) : null}

          {isSearchingVideos ? (
            <p className="small shared-agent-video-empty">
              Searching library...
            </p>
          ) : null}

          {videoSearchError ? (
            <p className="jobs-status-error">{videoSearchError}</p>
          ) : null}

          {!isSearchingVideos && videoResults.length > 0 ? (
            <div className="shared-agent-video-results">
              {videoResults.map((video) => {
                const isActive = selectedVideo?.documentId === video.documentId

                return (
                  <button
                    key={video.documentId}
                    type="button"
                    className={`shared-agent-video-result${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      void hydrateSelectedVideo(video)
                    }}
                  >
                    <span className="shared-agent-video-result-title">
                      {video.title}
                    </span>
                    <span className="shared-agent-video-result-meta">
                      {video.primaryLanguage ?? "Language unavailable"}
                      {video.slug ? ` · ${video.slug}` : ""}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {!selectedVideo &&
          !isSearchingVideos &&
          videoQuery.trim().length >= 2 &&
          videoResults.length === 0 &&
          !videoSearchError ? (
            <p className="small shared-agent-video-empty">
              No library videos matched that search.
            </p>
          ) : null}

          {!selectedVideo && videoQuery.trim().length < 2 ? (
            <p className="small shared-agent-video-empty">
              Type at least 2 characters to search the library, or paste your
              own source material below.
            </p>
          ) : null}
        </section>

        <form className="shared-agent-form" onSubmit={handleSubmit}>
          <label className="jobs-field">
            <span className="jobs-field-label">Goal</span>
            <textarea
              className="jobs-input shared-agent-textarea"
              value={draft.goal}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        goal: event.target.value,
                      }
                    : current,
                )
              }
            />
          </label>

          <label className="jobs-field">
            <span className="jobs-field-label">Supporting context</span>
            <textarea
              className="jobs-input shared-agent-textarea"
              value={draft.supportingContext ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        supportingContext: event.target.value,
                      }
                    : current,
                )
              }
            />
          </label>

          <div className="shared-agent-fields">
            {selectedAgent.fields.map((field) => (
              <label key={field.key} className="jobs-field">
                <span className="jobs-field-label">{field.label}</span>
                {field.kind === "textarea" ? (
                  <textarea
                    className="jobs-input shared-agent-textarea"
                    value={draft.fields[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              fields: {
                                ...current.fields,
                                [field.key]: event.target.value,
                              },
                            }
                          : current,
                      )
                    }
                  />
                ) : (
                  <input
                    className="jobs-input"
                    value={draft.fields[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              fields: {
                                ...current.fields,
                                [field.key]: event.target.value,
                              },
                            }
                          : current,
                      )
                    }
                  />
                )}
                {field.description ? (
                  <span className="small shared-agent-field-copy">
                    {field.description}
                  </span>
                ) : null}
              </label>
            ))}
          </div>

          <div className="agents-row-actions shared-agent-actions">
            <button
              type="submit"
              className="jobs-primary-button"
              disabled={isRunning || isHydratingVideo || isApproving}
            >
              {isHydratingVideo
                ? "Hydrating video..."
                : isRunning
                  ? "Running..."
                  : session
                    ? "Send to session"
                    : "Start session"}
            </button>
            {error ? <span className="jobs-status-error">{error}</span> : null}
          </div>
        </form>

        {result ? (
          <section className="shared-agent-result" aria-live="polite">
            <div className="shared-agent-result-meta">
              <span>
                Tokens {result.usage.totalTokens} ({result.usage.promptTokens}{" "}
                in / {result.usage.completionTokens} out)
              </span>
              {result.workflowId ? <span>{result.workflowId}</span> : null}
              {session ? <span>Session {session.id.slice(0, 8)}</span> : null}
              {result.traceId ? (
                <span>Trace {result.traceId.slice(0, 8)}</span>
              ) : null}
            </div>

            <div className="shared-agent-summary">
              <h5 className="shared-agent-result-heading">Summary</h5>
              <p className="small shared-agent-summary-copy">
                {result.result.summary}
              </p>
            </div>

            {result.result.recommendations.length > 0 ? (
              <div className="shared-agent-structured-block">
                <h5 className="shared-agent-result-heading">Recommendations</h5>
                <div className="shared-agent-recommendations">
                  {result.result.recommendations.map(
                    (recommendation, index) => (
                      <div
                        key={`${recommendation.label}-${index}`}
                        className="shared-agent-recommendation"
                      >
                        <div className="shared-agent-recommendation-title">
                          {recommendation.label}
                        </div>
                        <div className="small shared-agent-recommendation-copy">
                          {recommendation.rationale}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {result.draftPatch ? (
              <div className="shared-agent-structured-block">
                <div className="shared-agent-result-row">
                  <h5 className="shared-agent-result-heading">Draft patch</h5>
                  {result.pendingApproval ? (
                    <span className="badge active">
                      {getApprovalStatusCopy(result.pendingApproval.status)}
                    </span>
                  ) : null}
                </div>
                <dl className="shared-agent-patch-preview">
                  {result.draftPatch.title ? (
                    <>
                      <dt>Title</dt>
                      <dd>{result.draftPatch.title}</dd>
                    </>
                  ) : null}
                  {result.draftPatch.description ? (
                    <>
                      <dt>Description</dt>
                      <dd>{result.draftPatch.description}</dd>
                    </>
                  ) : null}
                  {result.draftPatch.slug ? (
                    <>
                      <dt>Slug</dt>
                      <dd>{result.draftPatch.slug}</dd>
                    </>
                  ) : null}
                  {result.draftPatch.snippet ? (
                    <>
                      <dt>Snippet</dt>
                      <dd>{result.draftPatch.snippet}</dd>
                    </>
                  ) : null}
                  {result.draftPatch.imageAlt ? (
                    <>
                      <dt>Image alt</dt>
                      <dd>{result.draftPatch.imageAlt}</dd>
                    </>
                  ) : null}
                </dl>
                {result.pendingApproval?.status === "pending" ? (
                  <div className="shared-agent-approval-actions">
                    <button
                      type="button"
                      className="jobs-primary-button"
                      disabled={isApproving}
                      onClick={() => {
                        void handleApproval("approve")
                      }}
                    >
                      {isApproving ? "Applying..." : "Approve and apply"}
                    </button>
                    <button
                      type="button"
                      className="collection-cache-clear jobs-refresh-link"
                      disabled={isApproving}
                      onClick={() => {
                        void handleApproval("decline")
                      }}
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {result.toolEvents.length > 0 ? (
              <div className="shared-agent-structured-block">
                <h5 className="shared-agent-result-heading">Tool events</h5>
                <div className="shared-agent-tool-events">
                  {result.toolEvents.map((event) => (
                    <div key={event.id} className="shared-agent-tool-event">
                      <span className="shared-agent-tool-name">
                        {event.name}
                      </span>
                      <span className="small shared-agent-tool-summary">
                        {event.summary}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <pre className="shared-agent-output">{result.output}</pre>
          </section>
        ) : null}
      </div>
    </div>
  )
}
