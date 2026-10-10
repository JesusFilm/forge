import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ReviewerQueue, mergeReviewerQueuePage } from "./reviewer-queue"

describe("reviewer queue", () => {
  it("renders a useful empty state without exposing internal identifiers", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReviewerQueue, {
        initialState: { status: "empty" },
      }),
    )

    expect(markup).toContain("No reviews assigned")
    expect(markup).toContain("language-qualified")
  })

  it("distinguishes a retryable service outage from an empty queue", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReviewerQueue, {
        initialState: {
          status: "error",
          message: "The review service is temporarily unavailable.",
        },
      }),
    )

    expect(markup).toContain("temporarily unavailable")
    expect(markup).toContain("Try again")
    expect(markup).not.toContain("No reviews assigned")
  })

  it("appends cursor pages without duplicate assignments and preserves items on outage", () => {
    const current = {
      status: "ready" as const,
      items: [
        {
          id: "assignment-1",
          status: "ASSIGNED",
          kind: "STANDARD",
          round: 1,
          targetLanguageId: "hidden-language",
          targetLanguageSlug: "spanish",
          caseId: "hidden-case",
          collectionKey: "JESUS_FILM",
          videoId: "hidden-video",
          assignedAt: "2026-08-20T00:00:00.000Z",
          submittedAt: null,
        },
      ],
      nextCursor: "cursor-2",
    }
    const duplicate = { ...current.items[0]!, status: "SUBMITTED" }
    const appended = mergeReviewerQueuePage(current, {
      status: "ready",
      items: [duplicate, { ...current.items[0]!, id: "assignment-2" }],
      nextCursor: null,
    })
    expect(appended.state.items.map(({ id }) => id)).toEqual([
      "assignment-1",
      "assignment-2",
    ])
    expect(appended.state.items[0]?.status).toBe("SUBMITTED")

    const outage = mergeReviewerQueuePage(appended.state, {
      status: "error",
      message: "Temporarily unavailable",
      retryable: true,
    })
    expect(outage.state).toBe(appended.state)
    expect(outage.error).toBe("Temporarily unavailable")
  })

  it("does not render raw language, case, video, or assignment identifiers", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReviewerQueue, {
        initialState: {
          status: "ready",
          items: [
            {
              id: "assignment-private",
              status: "ASSIGNED",
              kind: "STANDARD",
              round: 1,
              targetLanguageId: "language-private",
              targetLanguageSlug: "spanish",
              caseId: "case-private",
              collectionKey: "JESUS_FILM",
              videoId: "video-private",
              assignedAt: "2026-08-20T00:00:00.000Z",
              submittedAt: null,
            },
          ],
          nextCursor: null,
        },
      }),
    )

    expect(markup).toContain("Jesus Film")
    expect(markup).toContain("Spanish")
    expect(markup).not.toContain("language-private")
    expect(markup).not.toContain("case-private")
    expect(markup).not.toContain("video-private")
    expect(markup).not.toContain(">assignment-private<")
  })
})
