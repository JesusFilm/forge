import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { EnrichActionControls } from "@/features/coverage/enrich-action-controls"

describe("EnrichActionControls", () => {
  it("defaults to 'Enrich Now' when idle", () => {
    const markup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        enrichActionReady: true,
        enrichFeedback: null,
        isEnrichSubmitting: false,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
      }),
    )

    expect(markup).toContain("Enrich Now")
    expect(markup).not.toContain("Run Now")
  })

  it("renders a custom actionLabel/submittingLabel when provided", () => {
    const idleMarkup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        actionLabel: "Run Now",
        enrichActionReady: true,
        enrichFeedback: null,
        isEnrichSubmitting: false,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
      }),
    )

    expect(idleMarkup).toContain("Run Now")
    expect(idleMarkup).not.toContain("Enrich Now")

    const submittingMarkup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        actionLabel: "Run Now",
        enrichActionReady: true,
        enrichFeedback: null,
        isEnrichSubmitting: true,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
        submittingLabel: "Running...",
      }),
    )

    expect(submittingMarkup).toContain("Running...")
    expect(submittingMarkup).not.toContain("Creating jobs...")
  })

  it("shows a disabled pending action while keeping cancel available", () => {
    const markup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        enrichActionReady: true,
        enrichFeedback: null,
        isEnrichSubmitting: true,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
      }),
    )

    expect(markup.match(/disabled=""/g)).toHaveLength(1)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain("Creating jobs...")
    expect(markup).toContain("Submitting enrichment request...")
    expect(markup).not.toContain('role="status"')
    expect(markup).not.toContain('aria-live="polite"')
  })

  it("renders accepted feedback with a Jobs link", () => {
    const markup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        enrichActionReady: true,
        enrichFeedback: {
          tone: "success",
          message: "1 enrichment job started.",
          action: {
            href: "/dashboard/jobs/job-1",
            label: "Open job",
          },
        },
        isEnrichSubmitting: false,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
      }),
    )

    expect(markup).toContain("1 enrichment job started.")
    expect(markup).toContain('href="/dashboard/jobs/job-1"')
    expect(markup).toContain("Open job")
    expect(markup).not.toContain('aria-haspopup="dialog"')
  })

  it("renders error feedback with details as a dialog trigger", () => {
    const markup = renderToStaticMarkup(
      React.createElement(EnrichActionControls, {
        enrichActionReady: true,
        enrichFeedback: {
          tone: "error",
          message:
            "Validation failed: targetLanguageIds: Expected a language id",
          details: [
            {
              label: "targetLanguageIds",
              message: "Expected a language id",
            },
          ],
        },
        isEnrichSubmitting: false,
        languageSelectionRequired: false,
        onCancel: vi.fn(),
        onEnrich: vi.fn(),
      }),
    )

    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain(
      "Validation failed: targetLanguageIds: Expected a language id",
    )
  })
})
