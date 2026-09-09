import { OFFLINE_INDEX_STORAGE_KEY, offlineRecordKey } from "../offlineManifest"
import {
  createExportSessionStore,
  EXPORT_STAGING_NOTES_STORAGE_KEY,
  getExportSessionStore,
  resetExportSessionStoreForTests,
  type ExportOutcome,
  type ExportRunHandle,
  type ExportStoragePort,
} from "../exportSession"
import {
  RAW_EXPORT_ALBUM_NAME,
  RAW_EXPORT_DIR_NAME,
  RAW_EXPORT_ENABLED,
  RAW_EXPORT_ID_PREFIX,
  RAW_EXPORT_MAX_FILENAME_LENGTH,
} from "../rawExportConstants"

/** A port standing in for AsyncStorage, recording every key it is asked for. */
function memoryPort() {
  const values = new Map<string, string>()
  const touched: string[] = []
  const port: ExportStoragePort = {
    get: async (key) => {
      touched.push(key)
      return values.get(key) ?? null
    },
    set: async (key, value) => {
      touched.push(key)
      values.set(key, value)
    },
    remove: async (key) => {
      touched.push(key)
      values.delete(key)
    },
  }
  return { port, values, touched }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TARGET = "birth-of-jesus"

describe("rawExportConstants", () => {
  it("keeps the export id namespace disjoint from a bare video slug", () => {
    const exportId = `${RAW_EXPORT_ID_PREFIX}${TARGET}`
    expect(exportId).not.toBe(TARGET)
    expect(RAW_EXPORT_ID_PREFIX).toContain(":")
    // A slug is lower-case letters, digits and hyphens; the prefix must break it.
    expect(exportId).not.toMatch(/^[a-z0-9-]+$/)
  })

  it("fixes the album name, the staging directory and the filename bound", () => {
    expect(RAW_EXPORT_ALBUM_NAME).toBe("Jesus Film Watch")
    expect(RAW_EXPORT_DIR_NAME).toBe("raw-exports")
    expect(RAW_EXPORT_MAX_FILENAME_LENGTH).toBe(120)
    expect(RAW_EXPORT_ENABLED).toBe(true)
  })

  it("types the build-time switch as a boolean the later units can test", () => {
    // A literal `true` type makes this comparison a typecheck error, which is
    // what every off-branch in R33 would hit.
    const off: boolean = RAW_EXPORT_ENABLED === false
    expect(off).toBe(false)
  })
})

describe("in-flight exports", () => {
  it("publishes a started export with its progress fraction", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const changes: number[] = []
    store.subscribe(() => changes.push(store.getSnapshot().activeCount))

    const run = store.run(
      { target: TARGET, runId: "run-1", title: "Birth of Jesus" },
      async (handle) => {
        handle.publishProgress(0.42)
        return gate.promise
      },
    )
    await Promise.resolve()

    const snapshot = store.getSnapshot()
    expect(snapshot.activeCount).toBe(1)
    expect(snapshot.byTarget[TARGET]).toMatchObject({
      target: TARGET,
      runId: "run-1",
      title: "Birth of Jesus",
      progress: 0.42,
      cancelRequested: false,
    })
    expect(changes.length).toBeGreaterThan(0)

    gate.resolve("saved")
    await run
  })

  it("returns the same snapshot reference until something changes", () => {
    const store = createExportSessionStore()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it("clamps a progress fraction to the zero-to-one range", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        handle.publishProgress(2)
        return gate.promise
      },
    )
    await Promise.resolve()
    expect(store.getSnapshot().byTarget[TARGET]?.progress).toBe(1)

    gate.resolve("saved")
    await run
  })

  it("ignores progress published after the run ends", async () => {
    const store = createExportSessionStore()
    let escaped: ExportRunHandle | null = null
    await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        escaped = handle
        return "saved"
      },
    )

    escaped!.publishProgress(0.9)
    expect(store.getSnapshot().activeCount).toBe(0)
    expect(store.getSnapshot().byTarget[TARGET]).toBeUndefined()
  })

  it("refuses a second export of a target already in flight (AE15)", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const first = store.run(
      { target: TARGET, runId: "run-1" },
      async () => gate.promise,
    )
    await Promise.resolve()

    const second = jest.fn(async (): Promise<ExportOutcome> => "saved")
    const refusal = await store.run({ target: TARGET, runId: "run-2" }, second)

    expect(refusal).toEqual({ started: false, reason: "alreadyExporting" })
    expect(second).not.toHaveBeenCalled()
    expect(store.getSnapshot().byTarget[TARGET]?.runId).toBe("run-1")

    gate.resolve("saved")
    await first
  })

  it("admits a different target while one export is in flight", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const first = store.run(
      { target: TARGET, runId: "run-1" },
      async () => gate.promise,
    )
    const secondGate = deferred<ExportOutcome>()
    const second = store.run(
      { target: "jesus-calms-the-storm", runId: "run-1" },
      async () => secondGate.promise,
    )
    await Promise.resolve()

    expect(store.getSnapshot().activeCount).toBe(2)

    gate.resolve("saved")
    secondGate.resolve("saved")
    await Promise.all([first, second])
  })

  it("admits the same target again once the first export ends", async () => {
    const store = createExportSessionStore()
    await store.run(
      { target: TARGET, runId: "run-1" },
      async (): Promise<ExportOutcome> => "failed",
    )
    const second = await store.run(
      { target: TARGET, runId: "run-2" },
      async (): Promise<ExportOutcome> => "saved",
    )
    expect(second).toEqual({
      started: true,
      outcome: "saved",
      errorMessage: null,
    })
  })
})

describe("terminal outcomes release the slot", () => {
  const outcomes: ExportOutcome[] = [
    "saved",
    "failed",
    "blocked",
    "refused",
    "cancelled",
    "abandoned",
  ]

  it.each(outcomes)("releases the slot on outcome %s", async (outcome) => {
    const store = createExportSessionStore()
    const result = await store.run(
      { target: TARGET, runId: "run-1" },
      async (): Promise<ExportOutcome> => outcome,
    )
    expect(result).toEqual({ started: true, outcome, errorMessage: null })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("releases the slot when the callback rejects", async () => {
    const store = createExportSessionStore()
    const result = await store.run(
      { target: TARGET, runId: "run-1" },
      async (): Promise<ExportOutcome> => {
        throw new Error("transfer died")
      },
    )
    expect(result).toEqual({
      started: true,
      outcome: "failed",
      errorMessage: "transfer died",
    })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("releases the slot when the callback throws synchronously", async () => {
    const store = createExportSessionStore()
    const result = await store.run({ target: TARGET, runId: "run-1" }, () => {
      throw new Error("built the spec wrong")
    })
    expect(result).toEqual({
      started: true,
      outcome: "failed",
      errorMessage: "built the spec wrong",
    })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("neither leaks the slot nor loses the outcome when a listener throws", async () => {
    const store = createExportSessionStore()
    store.subscribe(() => {
      throw new Error("listener exploded")
    })
    const survivor = jest.fn()
    store.subscribe(survivor)
    const work = jest.fn(async (): Promise<ExportOutcome> => "saved")

    const result = await store.run({ target: TARGET, runId: "run-1" }, work)

    expect(result).toEqual({
      started: true,
      outcome: "saved",
      errorMessage: null,
    })
    expect(work).toHaveBeenCalledTimes(1)
    expect(survivor).toHaveBeenCalled()
    expect(store.getSnapshot().activeCount).toBe(0)
  })
})

describe("cancellation", () => {
  it("reports cancelled, not failed, when the callback rejects after a cancel", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1" },
      async (): Promise<ExportOutcome> => gate.promise,
    )
    await Promise.resolve()

    expect(store.requestCancel(TARGET)).toBe(true)
    expect(store.getSnapshot().byTarget[TARGET]?.cancelRequested).toBe(true)
    gate.reject(new Error("task aborted"))

    await expect(run).resolves.toEqual({
      started: true,
      outcome: "cancelled",
      errorMessage: "task aborted",
    })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("reports cancelled when the callback returns failed after a cancel", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1" },
      async () => gate.promise,
    )
    await Promise.resolve()
    store.requestCancel(TARGET)
    gate.resolve("failed")

    await expect(run).resolves.toMatchObject({ outcome: "cancelled" })
  })

  it("leaves a blocked outcome alone after a cancel", async () => {
    const store = createExportSessionStore()
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1" },
      async () => gate.promise,
    )
    await Promise.resolve()
    store.requestCancel(TARGET)
    gate.resolve("blocked")

    await expect(run).resolves.toMatchObject({ outcome: "blocked" })
  })

  it("calls the run's canceller and exposes the request to the callback", async () => {
    const store = createExportSessionStore()
    const onCancel = jest.fn()
    const seen: boolean[] = []
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1", onCancel },
      async (handle): Promise<ExportOutcome> => {
        seen.push(handle.isCancelRequested())
        await gate.promise
        seen.push(handle.isCancelRequested())
        return "cancelled"
      },
    )
    await Promise.resolve()
    store.requestCancel(TARGET)
    gate.resolve("cancelled")
    await run

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([false, true])
  })

  it("reports no cancel for a target with no export in flight", () => {
    const store = createExportSessionStore()
    expect(store.requestCancel(TARGET)).toBe(false)
  })
})

describe("staging notes", () => {
  it("survives a simulated process restart while the session does not", async () => {
    const { port, values } = memoryPort()
    const killed = createExportSessionStore({ storage: port })
    const gate = deferred<ExportOutcome>()
    const run = killed.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({
          stagedPath: "/raw-exports/run-1/birth-of-jesus.mp4",
          albumIntent: "album",
        })
        await handle.markTransferFinished()
        return gate.promise
      },
    )
    await new Promise<void>((resolve) => setImmediate(() => resolve()))
    expect(killed.getSnapshot().activeCount).toBe(1)

    // The process dies here: a new store reads the same persisted storage.
    const relaunched = createExportSessionStore({ storage: port })

    expect(relaunched.getSnapshot().activeCount).toBe(0)
    expect(relaunched.getSnapshot().byTarget).toEqual({})
    await expect(relaunched.readStagingNote(TARGET)).resolves.toMatchObject({
      target: TARGET,
      runId: "run-1",
      stagedPath: "/raw-exports/run-1/birth-of-jesus.mp4",
      albumIntent: "album",
      transferFinished: true,
    })
    await expect(relaunched.listStagingNotes()).resolves.toHaveLength(1)
    expect(values.size).toBe(1)

    gate.resolve("saved")
    await run
  })

  it("records an unfinished transfer until the run marks it finished", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    const gate = deferred<ExportOutcome>()
    const run = store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({
          stagedPath: "/raw-exports/run-1/file.mp4",
          albumIntent: "library",
        })
        return gate.promise
      },
    )
    await new Promise<void>((resolve) => setImmediate(() => resolve()))

    await expect(store.readStagingNote(TARGET)).resolves.toMatchObject({
      transferFinished: false,
      albumIntent: "library",
    })

    gate.resolve("saved")
    await run
  })

  it("clears the note on every terminal outcome", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    for (const outcome of [
      "saved",
      "failed",
      "cancelled",
      "abandoned",
    ] as ExportOutcome[]) {
      await store.run(
        { target: TARGET, runId: outcome },
        async (handle): Promise<ExportOutcome> => {
          await handle.stage({
            stagedPath: `/raw-exports/${outcome}/file.mp4`,
            albumIntent: "album",
          })
          return outcome
        },
      )
      await expect(store.readStagingNote(TARGET)).resolves.toBeNull()
    }
  })

  it("clears the note when the callback throws synchronously after staging", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    await store.writeStagingNote({
      target: TARGET,
      runId: "run-1",
      stagedPath: "/raw-exports/run-1/file.mp4",
      albumIntent: "album",
      transferFinished: false,
    })

    await store.run({ target: TARGET, runId: "run-1" }, () => {
      throw new Error("sync failure")
    })

    await expect(store.readStagingNote(TARGET)).resolves.toBeNull()
  })

  it("keeps a deferred note past the terminal outcome for the later save (KTD4)", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({
          stagedPath: "/raw-exports/run-1/file.mp4",
          albumIntent: "album",
        })
        await handle.markTransferFinished()
        handle.deferStagingNote()
        return "saved"
      },
    )

    await expect(store.readStagingNote(TARGET)).resolves.toMatchObject({
      transferFinished: true,
    })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("keeps one target's note when another target's run ends", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    await store.writeStagingNote({
      target: "jesus-calms-the-storm",
      runId: "run-9",
      stagedPath: "/raw-exports/run-9/other.mp4",
      albumIntent: "album",
      transferFinished: true,
    })

    await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({
          stagedPath: "/raw-exports/run-1/file.mp4",
          albumIntent: "album",
        })
        return "saved"
      },
    )

    await expect(store.listStagingNotes()).resolves.toEqual([
      expect.objectContaining({ target: "jesus-calms-the-storm" }),
    ])
  })

  it("keeps both notes when two targets stage at the same time", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    await Promise.all([
      store.writeStagingNote({
        target: "a",
        runId: "run-1",
        stagedPath: "/raw-exports/run-1/a.mp4",
        albumIntent: "album",
        transferFinished: false,
      }),
      store.writeStagingNote({
        target: "b",
        runId: "run-1",
        stagedPath: "/raw-exports/run-1/b.mp4",
        albumIntent: "album",
        transferFinished: false,
      }),
    ])

    await expect(store.listStagingNotes()).resolves.toHaveLength(2)
  })

  it("drops a corrupt or foreign-version persisted note", async () => {
    const { port, values } = memoryPort()
    values.set(EXPORT_STAGING_NOTES_STORAGE_KEY, "{ not json")
    const store = createExportSessionStore({ storage: port })
    await expect(store.listStagingNotes()).resolves.toEqual([])

    values.set(
      EXPORT_STAGING_NOTES_STORAGE_KEY,
      JSON.stringify({ [TARGET]: { version: 99, target: TARGET } }),
    )
    await expect(store.readStagingNote(TARGET)).resolves.toBeNull()
  })

  it("does not fail a run when the storage port rejects", async () => {
    const failing: ExportStoragePort = {
      get: async () => {
        throw new Error("storage gone")
      },
      set: async () => {
        throw new Error("storage gone")
      },
      remove: async () => {
        throw new Error("storage gone")
      },
    }
    const store = createExportSessionStore({ storage: failing })

    const result = await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle
          .stage({ stagedPath: "/x.mp4", albumIntent: "album" })
          .catch(() => undefined)
        return "saved"
      },
    )

    expect(result).toMatchObject({ outcome: "saved" })
    expect(store.getSnapshot().activeCount).toBe(0)
  })

  it("no-ops without a storage port so a caller that forgets cannot throw", async () => {
    const store = createExportSessionStore()
    const result = await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({ stagedPath: "/x.mp4", albumIntent: "album" })
        await handle.markTransferFinished()
        return "saved"
      },
    )

    expect(result).toMatchObject({ outcome: "saved" })
    await expect(store.readStagingNote(TARGET)).resolves.toBeNull()
  })

  it("accepts the storage port the provider attaches later", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore()
    store.attachStorage(port)

    await store.writeStagingNote({
      target: TARGET,
      runId: "run-1",
      stagedPath: "/raw-exports/run-1/file.mp4",
      albumIntent: "album",
      transferFinished: true,
    })

    await expect(store.readStagingNote(TARGET)).resolves.toMatchObject({
      target: TARGET,
    })
  })
})

describe("the staging note is not offline state", () => {
  it("touches no offline manifest key (KTD5)", async () => {
    const { port, touched } = memoryPort()
    const store = createExportSessionStore({ storage: port })

    await store.run(
      { target: TARGET, runId: "run-1" },
      async (handle): Promise<ExportOutcome> => {
        await handle.stage({
          stagedPath: "/raw-exports/run-1/file.mp4",
          albumIntent: "album",
        })
        await handle.markTransferFinished()
        return "saved"
      },
    )
    await store.listStagingNotes()

    expect(touched.length).toBeGreaterThan(0)
    for (const key of touched) {
      expect(key).toBe(EXPORT_STAGING_NOTES_STORAGE_KEY)
    }
  })

  it("keys the note outside the offline namespace", () => {
    expect(EXPORT_STAGING_NOTES_STORAGE_KEY).not.toBe(offlineRecordKey(TARGET))
    expect(EXPORT_STAGING_NOTES_STORAGE_KEY).not.toBe(OFFLINE_INDEX_STORAGE_KEY)
    expect(EXPORT_STAGING_NOTES_STORAGE_KEY.startsWith("offline.")).toBe(false)
  })

  it("carries no offline record fields a reconciliation could read", async () => {
    const { port } = memoryPort()
    const store = createExportSessionStore({ storage: port })
    await store.writeStagingNote({
      target: TARGET,
      runId: "run-1",
      stagedPath: "/raw-exports/run-1/file.mp4",
      albumIntent: "album",
      transferFinished: true,
    })

    const note = await store.readStagingNote(TARGET)
    expect(Object.keys(note ?? {}).sort()).toEqual([
      "albumIntent",
      "runId",
      "stagedPath",
      "target",
      "transferFinished",
      "version",
    ])
  })
})

describe("the module singleton", () => {
  afterEach(() => {
    resetExportSessionStoreForTests()
  })

  it("hands every caller the same store", () => {
    expect(getExportSessionStore()).toBe(getExportSessionStore())
  })

  it("hands a fresh store out after a test reset", () => {
    const first = getExportSessionStore()
    resetExportSessionStoreForTests()
    expect(getExportSessionStore()).not.toBe(first)
  })
})

describe("snapshot identity under progress", () => {
  /** Hold a run open so progress can be published against a live slot. */
  function openRun(store: ReturnType<typeof createExportSessionStore>) {
    let handle: ExportRunHandle | undefined
    let release: (outcome: ExportOutcome) => void = () => {}
    const done = store.run({ target: "a", runId: "r" }, (h) => {
      handle = h
      return new Promise<ExportOutcome>((resolve) => {
        release = resolve
      })
    })
    return {
      get handle(): ExportRunHandle {
        if (!handle) throw new Error("run did not start")
        return handle
      },
      release: (outcome: ExportOutcome) => release(outcome),
      done,
    }
  }

  it("keeps `targets` identity across a progress tick", async () => {
    // The defect this pins: `targets` feeds FlatList's extraData through
    // deriveEpisodeBadges. A new identity per tick repaints every episode row
    // once a second for the whole transfer, with no content change.
    const store = createExportSessionStore()
    const run = openRun(store)
    await Promise.resolve()

    const before = store.getSnapshot().targets
    run.handle.publishProgress(0.25)
    run.handle.publishProgress(0.5)
    const after = store.getSnapshot().targets

    expect(after).toBe(before)
    expect([...after]).toEqual(["a"])
    run.release("saved")
    await run.done
  })

  it("changes `targets` identity when membership changes", async () => {
    // Anti-vacuous: a frozen set would pass the test above and never update.
    const store = createExportSessionStore()
    const empty = store.getSnapshot().targets
    const run = openRun(store)
    await Promise.resolve()

    const running = store.getSnapshot().targets
    expect(running).not.toBe(empty)
    expect([...running]).toEqual(["a"])

    run.release("saved")
    await run.done
    expect(store.getSnapshot().targets).not.toBe(running)
    expect([...store.getSnapshot().targets]).toEqual([])
  })

  it("does not notify when a progress value repeats", async () => {
    const store = createExportSessionStore()
    const run = openRun(store)
    await Promise.resolve()

    let notifications = 0
    const stop = store.subscribe(() => {
      notifications += 1
    })
    run.handle.publishProgress(0.4)
    run.handle.publishProgress(0.4)
    run.handle.publishProgress(0.4)
    stop()

    expect(notifications).toBe(1)
    run.release("saved")
    await run.done
  })
})
