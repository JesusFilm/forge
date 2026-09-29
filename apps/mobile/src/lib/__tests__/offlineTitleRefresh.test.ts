/**
 * U7 (R4): stored offline titles follow the UI language once the app is
 * online. The refresh writes through the lifecycle's field-level patch, so a
 * download state change that lands while it fetches is never lost.
 */
import { ENGLISH_ADMIN_FORMS, adminFormsFor } from "../../i18n/adminLanguage"
import {
  createDownloadLifecycle,
  type DownloadLifecycleDeps,
} from "../downloadLifecycle"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
} from "../offlineManifest"
import {
  OFFLINE_TITLE_REFRESH_MAX_RECORDS,
  createOfflineTitleRefresher,
  recordsNeedingTitles,
  refreshOfflineTitles,
  type OfflineTitleRefreshDeps,
} from "../offlineTitleRefresh"
import type { VideoTextSource } from "../videoText"

const RU = adminFormsFor("ru")

function record(
  videoSlug: string,
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId: `dub-${videoSlug}`,
    renditionDocumentId: `rend-${videoSlug}`,
    qualityLabel: "High",
    title: `English ${videoSlug}`,
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: `file:///offline/${videoSlug}/media.mp4`,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1000,
    totalBytes: 1000,
    ...overrides,
  }
}

function text(slug: string, russian: string | null): VideoTextSource {
  return {
    locales: russian ? [{ languageSlug: "russian", title: russian }] : [],
    englishLocales: [{ languageSlug: "english", title: `English ${slug}` }],
  }
}

/** The records map as the provider holds it, behind the real lifecycle. */
function world(records: OfflineDownloadRecord[]) {
  const map = new Map(records.map((r) => [r.videoSlug, r]))
  const deps: Pick<DownloadLifecycleDeps, "getRecord" | "writeRecord"> = {
    getRecord: (slug) => map.get(slug),
    writeRecord: async (next) => {
      map.set(next.videoSlug, next)
    },
  }
  // The title patch reads and writes records only.
  const lifecycle = createDownloadLifecycle(
    deps as unknown as DownloadLifecycleDeps,
  )
  return { map, lifecycle }
}

type Pending = {
  slug: string
  resolve: (value: VideoTextSource | null) => void
  reject: (error: Error) => void
}

function deferredFetch() {
  const pending: Pending[] = []
  const fetchText = jest.fn(
    (slug: string) =>
      new Promise<VideoTextSource | null>((resolve, reject) => {
        pending.push({ slug, resolve, reject })
      }),
  )
  return { pending, fetchText }
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

describe("recordsNeedingTitles", () => {
  it("reads a record with no titleLocale as en", () => {
    const legacy = record("a")
    expect(recordsNeedingTitles([legacy], "en")).toEqual([])
    expect(recordsNeedingTitles([legacy], "ru")).toEqual([legacy])
  })

  it("skips a record already in the UI locale, and a canceled one", () => {
    expect(
      recordsNeedingTitles(
        [
          record("a", { titleLocale: "ru" }),
          record("b", { state: "canceled" }),
        ],
        "ru",
      ),
    ).toEqual([])
  })
})

describe("refreshOfflineTitles", () => {
  function deps(
    w: ReturnType<typeof world>,
    fetchText: OfflineTitleRefreshDeps["fetchText"],
    overrides: Partial<OfflineTitleRefreshDeps> = {},
  ): OfflineTitleRefreshDeps {
    return {
      records: () => [...w.map.values()],
      forms: () => RU,
      epoch: () => 1,
      fetchText,
      patch: w.lifecycle.patchTitles,
      ...overrides,
    }
  }

  it("refreshes a record with no titleLocale under a non-en UI, and patches only the titles", async () => {
    const w = world([
      record("a", { seriesSlug: "s", seriesTitle: "English s" }),
    ])
    const before = w.map.get("a")!
    await refreshOfflineTitles(
      deps(w, async (slug) =>
        text(slug, slug === "a" ? "Русский a" : "Русский s"),
      ),
    )
    expect(w.map.get("a")).toEqual({
      ...before,
      title: "Русский a",
      seriesTitle: "Русский s",
      titleLocale: "ru",
    })
  })

  it("keeps a state change that lands while the text is fetched", async () => {
    const w = world([record("a", { state: "downloading", bytesWritten: 10 })])
    const { pending, fetchText } = deferredFetch()
    const run = refreshOfflineTitles(deps(w, fetchText))
    await flush()
    expect(pending).toHaveLength(1)

    // The download finishes while the text request is in flight.
    const current = w.map.get("a")!
    w.map.set("a", { ...current, state: "downloaded", bytesWritten: 1000 })

    pending[0]!.resolve(text("a", "Русский a"))
    await run
    expect(w.map.get("a")).toMatchObject({
      state: "downloaded",
      bytesWritten: 1000,
      title: "Русский a",
      titleLocale: "ru",
    })
  })

  it("keeps the English title, stamped with the UI locale, when Admin has no row", async () => {
    const w = world([record("a")])
    await refreshOfflineTitles(deps(w, async (slug) => text(slug, null)))
    expect(w.map.get("a")).toMatchObject({
      title: "English a",
      titleLocale: "ru",
    })
  })

  it("writes nothing for a record whose request failed, so the next pass tries again", async () => {
    const w = world([record("a"), record("b")])
    await refreshOfflineTitles(
      deps(w, async (slug) => {
        if (slug === "a") throw new Error("offline")
        return text(slug, "Русский b")
      }),
    )
    expect(w.map.get("a")?.titleLocale).toBeUndefined()
    expect(w.map.get("b")?.titleLocale).toBe("ru")
  })

  it("never stamps a series episode whose series request failed", async () => {
    const w = world([
      record("a", { seriesSlug: "s", seriesTitle: "English s" }),
    ])
    await refreshOfflineTitles(
      deps(w, async (slug) => {
        if (slug === "s") throw new Error("offline")
        return text(slug, "Русский a")
      }),
    )
    expect(w.map.get("a")).toMatchObject({
      title: "English a",
      seriesTitle: "English s",
    })
    expect(w.map.get("a")?.titleLocale).toBeUndefined()
  })

  it("asks once per slug, and a series shared by episodes once", async () => {
    const w = world([
      record("a", { seriesSlug: "s" }),
      record("b", { seriesSlug: "s" }),
    ])
    const fetchText = jest.fn(async (slug: string) =>
      text(slug, `Русский ${slug}`),
    )
    await refreshOfflineTitles(deps(w, fetchText))
    expect(fetchText.mock.calls.map(([slug]) => slug).sort()).toEqual([
      "a",
      "b",
      "s",
    ])
  })

  it("drops every answer when the UI language changes during the pass", async () => {
    let epoch = 1
    const w = world([record("a")])
    const { pending, fetchText } = deferredFetch()
    const run = refreshOfflineTitles(deps(w, fetchText, { epoch: () => epoch }))
    await flush()
    epoch = 2
    pending[0]!.resolve(text("a", "Русский a"))
    await run
    expect(w.map.get("a")?.titleLocale).toBeUndefined()
  })

  it("sends nothing under an English UI for records from before U7", async () => {
    const w = world([record("a")])
    const fetchText = jest.fn(async () => null)
    await refreshOfflineTitles(
      deps(w, fetchText, { forms: () => ENGLISH_ADMIN_FORMS }),
    )
    expect(fetchText).not.toHaveBeenCalled()
  })

  it("refreshes at most one batch per pass", async () => {
    const many = Array.from(
      { length: OFFLINE_TITLE_REFRESH_MAX_RECORDS + 5 },
      (_, index) => record(`v${index}`),
    )
    const w = world(many)
    const fetchText = jest.fn(async (slug: string) => text(slug, "Русский"))
    await refreshOfflineTitles(deps(w, fetchText))
    expect(fetchText).toHaveBeenCalledTimes(OFFLINE_TITLE_REFRESH_MAX_RECORDS)
  })
})

describe("createOfflineTitleRefresher", () => {
  it("runs one pass at a time, and one more for a request that came during it", async () => {
    const w = world([record("a")])
    const { pending, fetchText } = deferredFetch()
    const refresher = createOfflineTitleRefresher({
      records: () => [...w.map.values()],
      forms: () => RU,
      epoch: () => 1,
      fetchText,
      patch: w.lifecycle.patchTitles,
    })
    refresher.request()
    refresher.request()
    refresher.request()
    await flush()
    expect(fetchText).toHaveBeenCalledTimes(1)
    pending[0]!.reject(new Error("offline"))
    await flush()
    // The queued request ran once more, and the record still needed titles.
    expect(fetchText).toHaveBeenCalledTimes(2)
    pending[1]!.resolve(text("a", "Русский a"))
    await flush()
    expect(w.map.get("a")?.titleLocale).toBe("ru")
    expect(fetchText).toHaveBeenCalledTimes(2)
  })
})
