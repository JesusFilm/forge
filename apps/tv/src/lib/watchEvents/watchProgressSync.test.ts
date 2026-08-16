// Covers the account-sync CONTRACT (document names + wire field names pinned
// against admin's WatchProgressUpsertInput) and the pure merge rules. Imports
// the document + pure modules only — `watchProgressSync.ts` itself drags in
// the Apollo client, which jest cannot parse (recordWatchEvent precedent).

import { getOperationAST, print, type DocumentNode } from "graphql"

import {
  PROGRESS_QUERY_OPERATION_NAME,
  PROGRESS_UPSERT_OPERATION_NAME,
  USER_TOKEN_OPERATIONS,
  overlappingAllowlistOperations,
  PROGRESS_CLEAR_OPERATION_NAME,
} from "../authHeaders"

import { type ContinueWatchingEntry } from "./continueWatching"
import {
  CLEAR_MY_WATCH_PROGRESS,
  GET_MY_WATCH_PROGRESS,
  UPSERT_MY_WATCH_PROGRESS,
} from "./watchProgressDocuments"
import {
  completionsToUpsertEntries,
  mayFlushShelfToAccount,
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

/** The document's declared operation name, read from the AST rather than
 *  matched in printed text: a `toContain("query MyWatchProgress")` assertion
 *  also passes for `MyWatchProgressV2`, which is exactly the superstring
 *  rename that detaches the user bearer and makes every call anonymous. */
function operationNameOf(document: DocumentNode): string | null {
  return getOperationAST(document)?.name?.value ?? null
}

describe("document contract", () => {
  it("pins both operation names EXACTLY to the user-bearer allowlist constants", () => {
    // The rename trap: the link attaches the signed-in bearer BY NAME, so a
    // drifted document name silently lands every call as anonymous.
    expect(operationNameOf(GET_MY_WATCH_PROGRESS)).toBe(
      PROGRESS_QUERY_OPERATION_NAME,
    )
    expect(operationNameOf(UPSERT_MY_WATCH_PROGRESS)).toBe(
      PROGRESS_UPSERT_OPERATION_NAME,
    )
    expect(operationNameOf(CLEAR_MY_WATCH_PROGRESS)).toBe(
      PROGRESS_CLEAR_OPERATION_NAME,
    )
    // Falsify the pin itself: a superstring rename must NOT satisfy it.
    expect(operationNameOf(GET_MY_WATCH_PROGRESS)).not.toBe(
      `${PROGRESS_QUERY_OPERATION_NAME}V2`,
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

  // One case per REJECTION CLAUSE, each isolating a single bad field, so a
  // deleted guard fails exactly one case instead of hiding behind a fixture
  // that trips several at once.
  it.each([
    ["null duration", entry({ durationSeconds: null })],
    ["zero duration", entry({ durationSeconds: 0 })],
    ["negative duration", entry({ durationSeconds: -10 })],
    // Infinity is production-reachable: expo-video reports it for a live or
    // not-yet-loaded item, and it would serialize as null into a Float!.
    ["infinite duration", entry({ durationSeconds: Number.POSITIVE_INFINITY })],
    ["NaN duration", entry({ durationSeconds: Number.NaN })],
    ["negative position", entry({ positionSeconds: -1 })],
    ["infinite position", entry({ positionSeconds: Number.POSITIVE_INFINITY })],
    ["NaN position", entry({ positionSeconds: Number.NaN })],
    ["empty stamp", entry({ updatedAt: "" })],
  ])("drops an entry with a %s rather than defaulting it", (_label, bad) => {
    expect(toWatchProgressUpsertEntries([bad])).toEqual([])
  })

  it("keeps a good entry alongside rejected ones (anti-vacuous)", () => {
    const mapped = toWatchProgressUpsertEntries([
      entry({ videoId: "bad", durationSeconds: null }),
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

  // One case per rejection clause — same per-gate discipline as the mapper.
  it.each([
    [
      "empty videoId",
      { videoId: "", positionSeconds: 10, durationSeconds: 100 },
    ],
    [
      "negative position",
      { videoId: "v", positionSeconds: -1, durationSeconds: 100 },
    ],
    [
      "non-numeric position",
      { videoId: "v", positionSeconds: "10", durationSeconds: 100 },
    ],
    [
      "negative duration",
      { videoId: "v", positionSeconds: 10, durationSeconds: -100 },
    ],
  ])("drops a row with an %s", (_label, row) => {
    expect(parseAccountProgressRows([row])).toEqual([])
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
  it("advances a local entry when the account row is newer, keeping display fields", () => {
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

  it("keeps the local entry when it is newer than the account row", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry({ positionSeconds: 480, updatedAt: "2026-08-12T00:00:00.000Z" })],
      [row({ positionSeconds: 300, updatedAt: "2026-08-11T00:00:00.000Z" })],
    )
    expect(merged[0]!.positionSeconds).toBe(480)
    expect(merged[0]!.updatedAt).toBe("2026-08-12T00:00:00.000Z")
  })

  // The convergence rule, and the one furthest-wins gets wrong: a viewer who
  // deliberately rewinds on their phone must see the rewind here, or the TV
  // keeps re-pushing a position the server's staleness guard always rejects.
  it("accepts a NEWER account row that is EARLIER in the video (rewind converges)", () => {
    const merged = mergeAccountRowsIntoShelf(
      [
        entry({
          positionSeconds: 480,
          progress: 0.8,
          updatedAt: "2026-08-10T00:00:00.000Z",
        }),
      ],
      [row({ positionSeconds: 60, updatedAt: "2026-08-11T00:00:00.000Z" })],
    )
    expect(merged[0]!.positionSeconds).toBe(60)
    expect(merged[0]!.progress).toBeCloseTo(0.1)
  })

  it("drops an entry the account watched past the SHELF's finished threshold", () => {
    // 0.95 of 600s = 570s.
    expect(
      mergeAccountRowsIntoShelf([entry()], [row({ positionSeconds: 580 })]),
    ).toEqual([])
  })

  // Server marks complete at 0.90, the shelf keeps cards until 0.95. Trusting
  // the server's flag deleted every entry in that band on every sync — the
  // film you are 92% through vanishing off the shelf you just pushed it from.
  it("keeps a 90-95% entry even when the account row says completed", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry()],
      [row({ positionSeconds: 552, completed: true })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.positionSeconds).toBe(552)
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

  // Tie-break path: identical stamps force the furthest-along comparison, and
  // these two fixtures discriminate WHICH comparison runs. Under the ratio
  // rule the row (0.25) loses to local progress 0.9; under a seconds rule it
  // would win (150 > 100). Only the duration-bearing/duration-less pair
  // separates them — with a fixture where both agree, deleting either branch
  // leaves the suite green.
  const SAME_STAMP = "2026-08-10T00:00:00.000Z"

  it("tie-breaks by RATIO when the local duration is known", () => {
    const merged = mergeAccountRowsIntoShelf(
      [
        entry({
          positionSeconds: 100,
          durationSeconds: 111,
          progress: 0.9,
          updatedAt: SAME_STAMP,
        }),
      ],
      [
        row({
          positionSeconds: 150,
          durationSeconds: 600,
          updatedAt: SAME_STAMP,
        }),
      ],
    )
    expect(merged[0]!.positionSeconds).toBe(100)
  })

  it("tie-breaks by SECONDS when the local duration is unknown", () => {
    const merged = mergeAccountRowsIntoShelf(
      [
        entry({
          positionSeconds: 100,
          durationSeconds: null,
          progress: null,
          updatedAt: SAME_STAMP,
        }),
      ],
      [
        row({
          positionSeconds: 150,
          durationSeconds: 600,
          updatedAt: SAME_STAMP,
        }),
      ],
    )
    expect(merged[0]!.positionSeconds).toBe(150)
    expect(merged[0]!.durationSeconds).toBe(600)
  })

  it("tie-breaks by seconds when the account row carries no stamp", () => {
    const merged = mergeAccountRowsIntoShelf(
      [entry({ positionSeconds: 100, durationSeconds: null, progress: null })],
      [row({ positionSeconds: 150, updatedAt: null })],
    )
    expect(merged[0]!.positionSeconds).toBe(150)
    // A null server stamp must not erase the local one.
    expect(merged[0]!.updatedAt).toBe("2026-08-10T00:00:00.000Z")
  })
})

describe("mayFlushShelfToAccount", () => {
  it("authorizes the flush only when the marker names the signing-out account", () => {
    expect(mayFlushShelfToAccount("user-a", "user-a")).toBe(true)
  })

  // Each refusal is its own case: these are the shared-TV states where the
  // shelf on disk is NOT the property of the account holding the bearer.
  it.each([
    ["another viewer's shelf", "user-a", "user-b"],
    ["an unowned shelf (interrupted sign-out)", null, "user-b"],
    ["an unknown signer", "user-a", null],
    ["an unknown signer, unowned shelf", null, null],
    ["an empty subject", "user-a", ""],
    ["an undefined subject", "user-a", undefined],
  ])("refuses %s", (_label, marker, userId) => {
    expect(
      mayFlushShelfToAccount(
        marker as string | null,
        userId as string | null | undefined,
      ),
    ).toBe(false)
  })
})

describe("completionsToUpsertEntries (todo 025)", () => {
  const completion = {
    videoId: "video-1",
    slug: "stunned",
    positionSeconds: 600,
    durationSeconds: 600,
    updatedAt: "2026-08-10T00:00:00.000Z",
  }

  it("maps a completion onto the same wire field set, slug as videoSlug", () => {
    expect(completionsToUpsertEntries([completion])).toEqual([
      {
        videoId: "video-1",
        videoSlug: "stunned",
        positionSeconds: 600,
        durationSeconds: 600,
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ])
  })

  // Per-clause rejections, mirroring the shelf mapper's discipline.
  it.each([
    ["zero duration", { ...completion, durationSeconds: 0 }],
    ["NaN duration", { ...completion, durationSeconds: Number.NaN }],
    ["negative position", { ...completion, positionSeconds: -1 }],
    ["empty stamp", { ...completion, updatedAt: "" }],
  ])("drops a completion with a %s", (_label, bad) => {
    expect(completionsToUpsertEntries([bad])).toEqual([])
  })
})
