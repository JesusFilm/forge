import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AutomationRunHistory } from "./automation-run-history"

describe("AutomationRunHistory", () => {
  it("labels dry-run reports and shows would-enqueue counts", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AutomationRunHistory, {
        runs: [
          {
            documentId: "run-1",
            status: "success",
            runMode: "dry_run",
            scheduledFor: "2026-04-12T09:00:00.000Z",
            startedAt: "2026-04-12T09:00:00.000Z",
            eligibleCount: 2,
            enqueuedCount: 0,
            skippedDuplicateCount: 1,
            errorCount: 0,
            jobDocumentIds: [],
            errors: [],
            summary: "Dry run would enqueue 1 video.",
            report: {
              kind: "metadata",
              data: {
                runMode: "dry_run",
                automationDocumentId: "automation-1",
                automationRunDocumentId: "run-1",
                template: "metadata_missing",
                refreshMode: "missing_only",
                targetLanguageIds: [],
                maxVideosPerRun: 1,
                eligibleCount: 2,
                skippedDuplicateCount: 1,
                wouldEnqueueCount: 1,
                selectedCandidates: [
                  {
                    videoDocumentId: "video-1",
                    coreId: "core-1",
                    outputOwner: "missing",
                    automationKey: "metadata_missing:video-1:source",
                  },
                ],
                suppressedOperations: [
                  "createEnrichmentJobs",
                  "syncTranslatedSubtitlesToMux",
                ],
                summary: "Dry run would enqueue 1 video.",
                generatedAt: "2026-04-12T09:00:00.000Z",
              },
            },
          },
        ],
      }),
    )

    expect(markup).toContain("Dry run")
    expect(markup).toContain("1 would enqueue")
    expect(markup).toContain("video-1")
    expect(markup).toContain("createEnrichmentJobs")
    expect(markup).toContain("syncTranslatedSubtitlesToMux")
  })

  it("does not render malformed dry-run report details", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AutomationRunHistory, {
        runs: [
          {
            documentId: "run-1",
            status: "success",
            runMode: "dry_run",
            scheduledFor: "2026-04-12T09:00:00.000Z",
            startedAt: "2026-04-12T09:00:00.000Z",
            eligibleCount: 1,
            enqueuedCount: 0,
            skippedDuplicateCount: 0,
            errorCount: 0,
            jobDocumentIds: [],
            errors: [],
            summary: "Dry run would enqueue 1 video.",
            report: {
              kind: "metadata",
              data: {
                runMode: "dry_run",
                wouldEnqueueCount: 1,
              },
            } as never,
          },
        ],
      }),
    )

    expect(markup).toContain("Dry run")
    expect(markup).not.toContain("Dry-run report")
  })
})
