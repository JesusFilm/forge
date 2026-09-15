import type { ExportFolder } from "../rawExport"
import { startRawExportAfterPick } from "../rawExportStart"

const FOLDER: ExportFolder = { uri: "file:///picked/Downloads/" }

function harness(pick: () => Promise<ExportFolder | null>) {
  const calls: string[] = []
  const deps = {
    pickFolder: async () => {
      calls.push("pick")
      return pick()
    },
    dismiss: () => {
      calls.push("dismiss")
    },
    start: (folder: ExportFolder) => {
      calls.push(`start:${folder.uri}`)
    },
  }
  return { calls, deps }
}

describe("startRawExportAfterPick", () => {
  it("picks, THEN dismisses, THEN starts with the picked folder", async () => {
    const { calls, deps } = harness(async () => FOLDER)

    await expect(startRawExportAfterPick(deps)).resolves.toBe("started")
    expect(calls).toEqual(["pick", "dismiss", `start:${FOLDER.uri}`])
  })

  it("a dismissed picker dismisses nothing and starts nothing", async () => {
    const { calls, deps } = harness(async () => null)

    await expect(startRawExportAfterPick(deps)).resolves.toBe("dismissed")
    expect(calls).toEqual(["pick"])
  })

  it("does not swallow a picker that throws", async () => {
    // The binding maps every rejection to null itself; a throw that reaches
    // this seam is a programming error and must surface, not start a run.
    const { calls, deps } = harness(async () => {
      throw new Error("boom")
    })

    await expect(startRawExportAfterPick(deps)).rejects.toThrow("boom")
    expect(calls).toEqual(["pick"])
  })

  it("dismisses BEFORE it starts — a start that dismissed after itself would race the run", async () => {
    // Anti-vacuous: falsify the order the first test pins.
    const { calls, deps } = harness(async () => FOLDER)
    const swapped = {
      ...deps,
      start: (folder: ExportFolder) => {
        deps.start(folder)
        deps.dismiss()
      },
      dismiss: () => {},
    }
    await startRawExportAfterPick(swapped)
    expect(calls).not.toEqual(["pick", "dismiss", `start:${FOLDER.uri}`])
  })
})
