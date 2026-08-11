// Covers the account-sync CONTRACT (document names + wire field names pinned
// against admin's WatchProgressUpsertInput) and the pure merge rules. Imports
// the document + pure modules only — `watchProgressSync.ts` itself drags in
// the Apollo client, which jest cannot parse (recordWatchEvent precedent).

import { print } from "graphql"

import {
  PROGRESS_QUERY_OPERATION_NAME,
  PROGRESS_UPSERT_OPERATION_NAME,
  USER_TOKEN_OPERATIONS,
  overlappingAllowlistOperations,
} from "../authHeaders"
import { type ContinueWatchingEntry } from "./continueWatching"
import {
  GET_MY_WATCH_PROGRESS,
  UPSERT_MY_WATCH_PROGRESS,
} from "./watchProgressDocuments"
import {
  mergeAccountRowsIntoShelf,
  parseAccountProgressRows,
  toWatchProgressUpsertEntries,
  type AccountWatchProgressRow,
} from "./watchProgressMerge"

function entry(
  overrides: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry {
  return {
    videoId: "video-1",
    slug: "stunned",
    title: "Stunned",
    imageUrl: "https://img.example/stunned.jpg",
    positionSeconds: 120,
    durationSeconds: 600,
    progress: 0.2,
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  }
}

function row(
  overrides: Partial<AccountWatchProgressRow> = {},
): AccountWatchProgressRow {
  return {
    videoId: "video-1",
    positionSeconds: 300,
    durationSeconds: 600,
    completed: false,
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  }
}

describe("document contract", () => {
  it("pins both operation names to the user-bearer allowlist constants", () => {
    // The rename trap: the link attaches the signed-in bearer BY NAME, so a
    // drifted document name silently lands every call as anonymous.
    expect(print(GET_MY_WATCH_PROGRESS)).toContain(
      `query ${PROGRESS_QUERY_OPERATION_NAME}`,
    )
    expect(print(UPSERT_MY_WATCH_PROGRESS)).toContain(
      `mutation ${PROGRESS_UPSERT_OPERATION_NAME}`,
    )
  })

  it("targets admin's wire type and fields by their exact names", () => {
    const upsert = print(UPSERT_MY_WATCH_PROGRESS)
    expect(upsert).toContain("[WatchProgressUpsertInput!]!")
    expect(upsert).toContain("upsertMyWatchProgress(entries: $entries)")
    expect(print(GET_MY_WATCH_PROGRESS)).toContain("myWatchProgress")
  })

  it("allowlists both ops for the user bearer, still disjoint from fleet", () => {
    expect(USER_TOKEN_OPERATIONS).toContain(PROGRESS_QUERY_OPERATION_NAME)
    expect(USER_TOKEN_OPERATIONS).toContain(PROGRESS_UPSERT_OPERATION_NAME)
    expect(overlappingAllowlistOperations()).toEqual([])
  })
})

describe("toWatchProgressUpsertEntries", () => {
  it("emits exactly the WatchProgressUpsertInput field set, slug as videoSlug", () => {
    const [mapped] = toWatchProgressUpsertEntries([entry()])
    // Key set pinned as the destination wire contract — a renamed or added
    // local field must show up here as a red test, not a silent drop.
    expect(mapped).toEqual({
      videoId: "video-1",
      videoSlug: "stunned",
      positionSeconds: 120,
      durationSeconds: 600,
      updatedAt: "2026-08-10T00:00:00.000Z",
    })
    expect(Object.keys(mapped!).sort()).toEqual([
      "durationSeconds",
      "positionSeconds",
      "updatedAt",
      "videoId",
      "videoSlug",
    ])
  })

  it("drops entries the server would reject instead of defaulting them", () => {
    const mapped = toWatchProgressUpsertEntries([
      entry({ videoId: "no-duration", durationSeconds: null }),
      entry({ videoId: "zero-duration", durationSeconds: 0 }),
      entry({ videoId: "negative-position", positionSeconds: -1 }),
      entry({ videoId: "no-stamp", updatedAt: "" }),
      entry({ videoId: "good" }),
    ])
    expect(mapped.map((m) => m.videoId)).toEqual(["good"])
  })

  it("caps the batch at the shelf maximum", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      entry({ videoId: `video-${i}` }),
    )
    expect(toWatchProgressUpsertEntries(many)).toHaveLength(10)
  })
})

describe("parseAccountProgressRows", () => {
  it("returns [] for non-arrays and drops unusable rows", () => {
    expect(parseAccountProgressRows(null)).toEqual([])
    expect(parseAccountProgressRows({})).toEqual([])
    const parsed = parseAccountProgressRows([
      null,
      "junk",
      { videoId: 42 },
      { videoId: "no-duration", positionSeconds: 10 },
      { videoId: "zero-duration", positionSeconds: 10, durationSeconds: 0 },
      { videoId: "good", positionSeconds: 10, durationSeconds: 100 },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({
      videoId: "good",
      positionSeconds: 10,
      durationSeconds: 100,
      completed: false,
      updatedAt: null,
    })
  })

  it("keeps completed and updatedAt when present", () => {
    const [parsed] = parseAccountProgressRows([
      {
        videoId: "v",
        positionSeconds: 90,
        durationSeconds: 100,
        completed: true,
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    ])
    expect(parsed!.completed).toBe(true)
    expect(parsed!.updatedAt).toBe("2026-08-11T00:00:00.000Z")
  })
})

describe("mergeAccountRowsIntoShelf", () => {
  it("advances a local entry when the account is further along, keeping display fields", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry({ positionSeconds: 120, progress: 0.2 })],
      [row({ positionSeconds: 300 })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.positionSeconds).toBe(300)
    expect(merged[0]!.progress).toBeCloseTo(0.5)
    expect(merged[0]!.title).toBe("Stunned")
    expect(merged[0]!.slug).toBe("stunned")
    expect(merged[0]!.updatedAt).toBe("2026-08-11T00:00:00.000Z")
  })

  it("keeps the local entry when it is further along than the account", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry({ positionSeconds: 480, progress: 0.8 })],
      [row({ positionSeconds: 300 })],
    )
    expect(merged[0]!.positionSeconds).toBe(480)
    expect(merged[0]!.updatedAt).toBe("2026-08-10T00:00:00.000Z")
  })

  it("drops an entry the account finished elsewhere — flag or ratio", () => {
    expect(
      mergeAccountRowsIntoShelf([entry()], [row({ completed: true })]),
    ).toEqual([])
    expect(
      mergeAccountRowsIntoShelf(
        [entry()],
        [row({ positionSeconds: 580, completed: false })],
      ),
    ).toEqual([])
  })

  it("skips account rows for videos the shelf does not know", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry()],
      [row({ videoId: "started-on-phone-only", positionSeconds: 50 })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.videoId).toBe("video-1")
    expect(merged[0]!.positionSeconds).toBe(120)
  })

  it("keeps local entries with no matching account row untouched", () => {
    const local = [entry({ videoId: "local-only" })]
    expect(mergeAccountRowsIntoShelf(local, [])).toEqual(local)
  })

  it("falls back to a seconds comparison when local duration is unknown", () => {
    const merged = mergeAccountRowsIntoShelf(
      [
        entry({
          positionSeconds: 100,
          durationSeconds: null,
          progress: null,
        }),
      ],
      [row({ positionSeconds: 150, durationSeconds: 600 })],
    )
    expect(merged[0]!.positionSeconds).toBe(150)
    expect(merged[0]!.durationSeconds).toBe(600)
  })
})
