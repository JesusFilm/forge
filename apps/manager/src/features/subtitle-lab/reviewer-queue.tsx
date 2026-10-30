"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { CheckCircle2, Languages, LoaderCircle, RefreshCw } from "lucide-react"

import {
  loadReviewerQueue,
  type ReviewerQueueItem,
  type ReviewerQueueState,
} from "./subtitle-review-data"

type ReadyQueueState = Extract<ReviewerQueueState, { status: "ready" }>

export function mergeReviewerQueuePage(
  current: ReadyQueueState,
  next: ReviewerQueueState,
): { state: ReadyQueueState; error: string | null } {
  if (next.status !== "ready") {
    return {
      state: current,
      error:
        next.status === "error"
          ? next.message
          : "More reviews could not be loaded.",
    }
  }
  const items = new Map<string, ReviewerQueueItem>(
    current.items.map((item) => [item.id, item]),
  )
  for (const item of next.items) items.set(item.id, item)
  return {
    state: {
      status: "ready",
      items: [...items.values()],
      nextCursor: next.nextCursor,
    },
    error: null,
  }
}

export function ReviewerQueue({
  initialState,
}: {
  initialState?: ReviewerQueueState
}) {
  const [state, setState] = useState<ReviewerQueueState>(
    initialState ?? { status: "loading" },
  )
  const [retryNonce, setRetryNonce] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  useEffect(() => {
    if (initialState && retryNonce === 0) return
    let active = true
    void loadReviewerQueue(null).then((nextState) => {
      if (active) setState(nextState)
    })
    return () => {
      active = false
    }
  }, [initialState, retryNonce])

  async function loadMore(current: ReadyQueueState) {
    if (!current.nextCursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    const merged = mergeReviewerQueuePage(
      current,
      await loadReviewerQueue(current.nextCursor),
    )
    setState(merged.state)
    setLoadMoreError(merged.error)
    setLoadingMore(false)
  }

  return (
    <main className="subtitle-review-queue-page">
      <header className="subtitle-review-page-heading">
        <div>
          <p className="subtitle-review-eyebrow">Language review</p>
          <h1>Your subtitle reviews</h1>
          <p>
            Compare assigned subtitle tracks while the video stays in sync.
            Tracks remain blind until your review is submitted.
          </p>
        </div>
      </header>

      {state.status === "loading" ? (
        <QueueStateCard ariaLive title="Loading assigned reviews">
          <LoaderCircle className="subtitle-review-spin" aria-hidden="true" />
          Checking your current language grants and assignments…
        </QueueStateCard>
      ) : state.status === "empty" ? (
        <QueueStateCard title="No reviews assigned">
          <Languages aria-hidden="true" />
          You are signed in as a language-qualified reviewer. New assignments
          will appear here when an operator adds them.
        </QueueStateCard>
      ) : state.status === "error" ? (
        <QueueStateCard ariaLive title="Reviews temporarily unavailable">
          <RefreshCw aria-hidden="true" />
          <span>{state.message}</span>
          <button
            type="button"
            className="subtitle-review-secondary-button"
            onClick={() => {
              setState({ status: "loading" })
              setRetryNonce((value) => value + 1)
            }}
          >
            Try again
          </button>
        </QueueStateCard>
      ) : (
        <section aria-label="Assigned subtitle reviews">
          <div className="subtitle-review-queue-list">
            {state.items.map((assignment) => {
              const submitted = assignment.submittedAt != null
              return (
                <Link
                  key={assignment.id}
                  href={`/subtitle-review/${encodeURIComponent(assignment.id)}`}
                  className="subtitle-review-queue-item"
                >
                  <div
                    className="subtitle-review-queue-icon"
                    aria-hidden="true"
                  >
                    {submitted ? <CheckCircle2 /> : <Languages />}
                  </div>
                  <div className="subtitle-review-queue-copy">
                    <div className="subtitle-review-queue-title-row">
                      <h2>{humanize(assignment.collectionKey)}</h2>
                      <span
                        className={`subtitle-review-status${submitted ? " is-submitted" : ""}`}
                      >
                        {submitted ? "Submitted" : "Ready to review"}
                      </span>
                    </div>
                    <p>
                      {humanize(assignment.targetLanguageSlug)} · Round{" "}
                      {assignment.round}
                      {assignment.kind === "SPECIALIST"
                        ? " · Specialist review"
                        : ""}
                    </p>
                    <span className="small">
                      Assigned {formatDate(assignment.assignedAt)}
                    </span>
                  </div>
                  <span
                    className="subtitle-review-queue-arrow"
                    aria-hidden="true"
                  >
                    →
                  </span>
                  <span className="sr-only">Open review</span>
                </Link>
              )
            })}
          </div>
          {loadMoreError ? (
            <p className="subtitle-review-submit-error" role="alert">
              {loadMoreError} Existing assignments remain available.
            </p>
          ) : null}
          {state.nextCursor ? (
            <button
              type="button"
              className="subtitle-review-secondary-button subtitle-review-load-more"
              onClick={() => void loadMore(state)}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading more…" : "Load more reviews"}
            </button>
          ) : null}
        </section>
      )}
    </main>
  )
}

function QueueStateCard({
  title,
  ariaLive = false,
  children,
}: {
  title: string
  ariaLive?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className="subtitle-review-state-card"
      aria-live={ariaLive ? "polite" : undefined}
    >
      <h2>{title}</h2>
      <div className="subtitle-review-state-copy">{children}</div>
    </section>
  )
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .toLocaleLowerCase()
    .replace(/\b\w/g, (character) => character.toLocaleUpperCase())
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return "recently"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
