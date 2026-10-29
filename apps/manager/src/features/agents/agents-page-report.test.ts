import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { AgentsPage } from "./agents-page"

it("renders the requested durable run even when it is absent from recent history", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AgentsPage, {
      initialAutomations: [],
      languageOptions: [],
      requestedReport: {
        automationName: "Old automation",
        run: {
          documentId: "sixth-report",
          automationDocumentId: "old-automation",
          status: "success",
          runMode: "dry_run",
          scheduledFor: "2026-04-12T09:00:00.000Z",
          eligibleCount: 1,
          enqueuedCount: 0,
          skippedDuplicateCount: 0,
          errorCount: 0,
          jobDocumentIds: [],
          errors: [],
          summary: "Sixth report selected",
        },
      },
    }),
  )
  expect(markup).toContain("Run report: Old automation")
  expect(markup).toContain("Sixth report selected")
})
