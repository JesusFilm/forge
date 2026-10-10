import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { JobErrorLogSection } from "@/features/jobs/job-error-log-section"
import type { JobError } from "@/types/job"

const loggedError: JobError = {
  step: "transcription",
  message: "Transcription failed",
  at: "2026-04-12T14:30:00.000Z",
  code: "transcription_failed",
  operatorHint: "Check the source subtitle track.",
}

describe("JobErrorLogSection", () => {
  it("renders no diagnostic card when there are no logged errors", () => {
    const markup = renderToStaticMarkup(
      React.createElement(JobErrorLogSection, { errors: [] }),
    )

    expect(markup).toBe("")
    expect(markup).not.toContain("Error Log")
    expect(markup).not.toContain("No errors recorded")
  })

  it("renders the existing diagnostic table when errors are logged", () => {
    const markup = renderToStaticMarkup(
      React.createElement(JobErrorLogSection, { errors: [loggedError] }),
    )

    expect(markup).toContain('id="error-log"')
    expect(markup).toContain("Error Log")
    expect(markup).toContain("Transcription")
    expect(markup).toContain("transcription_failed")
    expect(markup).toContain("Transcription failed")
    expect(markup).toContain("Check the source subtitle track.")
  })
})
