import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { FileAudio2 } from "lucide-react"
import { describe, expect, it } from "vitest"

import { CollapsibleStepRow } from "@/features/jobs/collapsible-step-row"

describe("CollapsibleStepRow", () => {
  it("renders visible artifact labels next to artifact link icons", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        "table",
        null,
        React.createElement(
          "tbody",
          null,
          React.createElement(CollapsibleStepRow, {
            stepName: "transcription",
            title: "Transcription",
            description: "Generates transcript artifacts.",
            icon: FileAudio2,
            duration: "8s",
            artifacts: [
              {
                key: "subtitles",
                label: "Subtitles processed",
                url: "/api/jobs/job-1/artifacts/subtitles",
              },
            ],
            status: "completed",
            statusIcon: React.createElement("span", null, "Complete"),
            retries: 0,
          }),
        ),
      ),
    )

    expect(markup).toContain("Subtitles processed")
    expect(markup).toContain("Open Subtitles processed in a new tab")
  })
})
