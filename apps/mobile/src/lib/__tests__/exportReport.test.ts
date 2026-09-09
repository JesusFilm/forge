/**
 * The report fold and its views hold no React, so they test with no renderer
 * and no mocks. A fold bug and a wording bug fail separately here, which a
 * rendered component tree cannot separate.
 */

import {
  EXPORT_REPORT_AUTO_DISMISS_MS,
  MAX_VISIBLE_REPORTS,
  foldSignal,
  viewFor,
  type ExportReportRecord,
  type ExportReportSignal,
} from "../exportReport"
import { RAW_EXPORT_ALBUM_NAME } from "../rawExportConstants"

const NOW = 1_000_000

function fold(
  signals: readonly ExportReportSignal[],
  now = NOW,
): ExportReportRecord[] {
  return signals.reduce<ExportReportRecord[]>(
    (records, signal) => foldSignal(records, signal, now),
    [],
  )
}

function only(signals: readonly ExportReportSignal[]): ExportReportRecord {
  const records = fold(signals)
  expect(records).toHaveLength(1)
  return records[0]
}

function episode(
  target: string,
  outcome: ExportReportSignal["outcome"],
  extra: Partial<ExportReportSignal> = {},
): ExportReportSignal {
  return {
    runId: "series-run",
    target,
    outcome,
    title: "Washi Gospel",
    runSize: 12,
    ...extra,
  }
}

function single(
  outcome: ExportReportSignal["outcome"],
  extra: Partial<ExportReportSignal> = {},
): ExportReportSignal {
  return {
    runId: "run-1",
    target: "birth-of-jesus",
    outcome,
    title: "Birth of Jesus",
    ...extra,
  }
}

describe("folding a run into one report", () => {
  it("folds twelve episode signals into one record", () => {
    const record = only([
      ...Array.from({ length: 10 }, (_value, index) =>
        episode(`episode-${index}`, "saved", { albumIntent: "album" }),
      ),
      episode("episode-10", "failed"),
      episode("episode-11", "failed"),
    ])

    expect(Object.keys(record.outcomes)).toHaveLength(12)
    expect(record.runSize).toBe(12)
    expect(viewFor(record).headline).toBe("Saved 10 of 12 episodes.")
    expect(viewFor(record).detail).toBe("2 did not save.")
  })

  it("counts a re-published episode once", () => {
    const record = only([
      episode("episode-0", "failed", { runSize: 3 }),
      episode("episode-0", "saved", { runSize: 3 }),
      episode("episode-0", "saved", { runSize: 3 }),
    ])

    expect(viewFor(record).headline).toBe("Saved 1 of 3 episodes.")
    expect(viewFor(record).detail).toBeNull()
  })

  it("keeps two runs apart by run id", () => {
    const records = fold([
      single("saved", { albumIntent: "album" }),
      { ...single("failed"), runId: "run-2", target: "the-story-of-jesus" },
    ])

    expect(records.map((record) => record.runId)).toEqual(["run-1", "run-2"])
  })

  it("keeps only the newest reports once the cap is reached", () => {
    const records = fold(
      Array.from({ length: MAX_VISIBLE_REPORTS + 1 }, (_value, index) => ({
        ...single("saved"),
        runId: `run-${index}`,
      })),
    )

    expect(records).toHaveLength(MAX_VISIBLE_REPORTS)
    expect(records[0].runId).toBe("run-1")
  })

  it("keeps the run size a later signal does not carry", () => {
    const record = only([
      episode("episode-0", "saved", { runSize: 5 }),
      // R28's restored signals may carry no run size at all.
      { ...episode("episode-1", "cancelled"), runSize: undefined },
    ])

    expect(record.runSize).toBe(5)
    expect(viewFor(record).headline).toBe("Saved 1 of 5 episodes.")
  })

  it("keeps the title and the album intent a later signal omits", () => {
    const record = only([
      episode("episode-0", "saved", { runSize: 2, albumIntent: "album" }),
      { ...episode("episode-1", "saved", { runSize: 2 }), title: undefined },
    ])

    expect(record.title).toBe("Washi Gospel")
    expect(record.albumIntent).toBe("album")
  })
})

describe("the worst outcome wins for a single export", () => {
  const cases: ReadonlyArray<
    readonly [
      ExportReportSignal["outcome"],
      ExportReportSignal["outcome"],
      string,
    ]
  > = [
    ["saved", "failed", "The video did not save."],
    ["failed", "saved", "The video did not save."],
    ["failed", "blocked", "The export did not start."],
    [
      "blocked",
      "refused",
      "Permission is needed to save to your photo library.",
    ],
    ["cancelled", "abandoned", "The export did not finish."],
    ["saved", "cancelled", "Export cancelled."],
  ]

  it.each(cases)("reports %s then %s as %s", (first, second, headline) => {
    const record = only([
      { ...single(first), target: "birth-of-jesus" },
      { ...single(second), target: "the-story-of-jesus" },
    ])

    expect(viewFor(record).headline).toBe(headline)
  })

  it("reports a lone saved export as saved", () => {
    expect(viewFor(only([single("saved")])).headline).toBe(
      "Saved to your photo library.",
    )
  })
})

describe("the run size splits the single view from the series view", () => {
  it("reads a signal with no run size as a single export", () => {
    const view = viewFor(only([single("saved", { albumIntent: "album" })]))

    expect(view.headline).toBe(`Saved to the ${RAW_EXPORT_ALBUM_NAME} album.`)
  })

  it("reads a run size of one as a single export", () => {
    const view = viewFor(only([single("failed", { runSize: 1 })]))

    expect(view.headline).toBe("The video did not save.")
  })

  it("reads a run size of two as a series, even after one episode", () => {
    const view = viewFor(only([episode("episode-0", "saved", { runSize: 2 })]))

    expect(view.headline).toBe("Saved 1 of 2 episodes.")
  })
})

describe("the saved headline names where the video landed", () => {
  it("names the album when the grant made one", () => {
    const view = viewFor(only([single("saved", { albumIntent: "album" })]))

    expect(view.headline).toBe(`Saved to the ${RAW_EXPORT_ALBUM_NAME} album.`)
  })

  it("names the library when the grant could not make an album", () => {
    const view = viewFor(only([single("saved", { albumIntent: "library" })]))

    expect(view.headline).toBe("Saved to your photo library.")
    expect(view.headline).not.toContain(RAW_EXPORT_ALBUM_NAME)
  })

  it("names the library when no intent reached the report", () => {
    expect(viewFor(only([single("saved")])).headline).toBe(
      "Saved to your photo library.",
    )
  })
})

describe("a refusal the system will not prompt for again", () => {
  it("offers settings and never expires", () => {
    const record = only([single("refused", { canAskAgain: false })])
    const view = viewFor(record)

    expect(record.expiresAt).toBeNull()
    expect(view.settings).toBe(true)
    expect(view.headline).toBe("Photo library access is off for this app.")
  })

  it("expires a first refusal and offers no settings action", () => {
    const record = only([single("refused", { canAskAgain: true })])
    const view = viewFor(record)

    expect(record.expiresAt).toBe(NOW + EXPORT_REPORT_AUTO_DISMISS_MS)
    expect(view.settings).toBe(false)
    expect(view.headline).toBe(
      "Permission is needed to save to your photo library.",
    )
  })

  it("holds a permanent refusal through a later episode outcome", () => {
    const record = only([
      episode("episode-0", "refused", { runSize: 3, canAskAgain: false }),
      episode("episode-1", "saved", { runSize: 3 }),
    ])
    const view = viewFor(record)

    expect(record.expiresAt).toBeNull()
    expect(view.settings).toBe(true)
    expect(view.detail).toContain("Turn on photo access in Settings")
  })

  it("words a first refusal in a run differently", () => {
    const record = only([
      episode("episode-0", "refused", { runSize: 3, canAskAgain: true }),
    ])

    expect(viewFor(record).detail).toBe("Photo library permission was refused.")
  })
})

describe("the series detail names every outcome the run reached", () => {
  it("reports a cancelled run's counts and its cancellation", () => {
    const record = only([
      episode("episode-0", "saved", { runSize: 5 }),
      episode("episode-1", "cancelled", { runSize: 5 }),
    ])
    const view = viewFor(record)

    expect(view.headline).toBe("Saved 1 of 5 episodes.")
    expect(view.detail).toBe("Export cancelled.")
    expect(view.icon).toBe("alert-circle")
  })

  it("joins every note the run produced", () => {
    const record = only([
      episode("episode-0", "saved", { runSize: 4 }),
      episode("episode-1", "failed", { runSize: 4 }),
      episode("episode-2", "blocked", { runSize: 4 }),
      episode("episode-3", "abandoned", { runSize: 4, detail: "No space." }),
    ])

    expect(viewFor(record).detail).toBe(
      "1 did not save. 1 did not start. 1 did not finish. No space.",
    )
  })

  it("marks a whole run that saved as done", () => {
    const record = only([
      episode("episode-0", "saved", { runSize: 2 }),
      episode("episode-1", "saved", { runSize: 2 }),
    ])
    const view = viewFor(record)

    expect(view.detail).toBeNull()
    expect(view.icon).toBe("checkmark-circle")
  })
})

describe("a detail the host cannot derive rides the report", () => {
  it("prefers the published detail over the derived one", () => {
    const view = viewFor(
      only([single("abandoned", { detail: "The app was closed." })]),
    )

    expect(view.detail).toBe("The app was closed.")
  })

  it("derives a detail for an abandoned export that carried none", () => {
    expect(viewFor(only([single("abandoned")])).detail).toBe(
      "Start it again to keep a copy.",
    )
  })
})
