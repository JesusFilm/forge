/**
 * Explore clip evidence (KTD9, R32, R33). The driver cases feed the events the
 * feed composition will, into real clip-mode recorders over a fake network.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
    require("crypto").createHash("sha256").update(data).digest("hex"),
  ),
}))
// R33: no module in the clip evidence import graph may load a progress
// writer. One that did would fail this whole file at import.
jest.mock("../../watchProgress/store", () => {
  throw new Error("clip evidence loaded the watch progress store")
})
jest.mock("../../watchProgress/recorder", () => {
  throw new Error("clip evidence loaded the watch progress recorder")
})
jest.mock("../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../config", () => ({ getApiToken: jest.fn(() => "fleet") }))
jest.mock("../../recommendations/enabled", () => ({
  isRecommendationClientEnabled: jest.fn(() => true),
}))
jest.mock("../../recommendations/transport", () => ({
  EVIDENCE_DEADLINE_MS: 5_000,
  mutateWithDeadline: jest.fn(),
}))
jest.mock("../../recommendations/viewerIdentityClient", () => {
  const store = {
    get: jest.fn(),
    invalidate: jest.fn(async () => undefined),
    touch: jest.fn(),
    holdPlayback: jest.fn(() => () => undefined),
  }
  return {
    getRecommendationViewerStore: () => store,
    viewerIdentityBridge: () => ({
      getIdentity: () => store.get(),
      invalidateIdentity: () => store.invalidate(),
      touch: () => store.touch(),
    }),
  }
})

import AsyncStorage from "@react-native-async-storage/async-storage"

import { getApiToken } from "../../config"
import { isRecommendationClientEnabled } from "../../recommendations/enabled"
import {
  RATE_LIMIT_WINDOW_MS,
  RecommendationClientError,
} from "../../recommendations/errors"
import {
  CLAIM_RECOMMENDATION_EPISODE,
  ISSUE_WATCH_PLAYBACK_CONTEXT,
  RECORD_RECOMMENDATION_PLAYBACK,
} from "../../recommendations/operations"
import {
  DIRECT_DISCOVERY,
  getPlaybackDiscoveryStore,
} from "../../recommendations/playbackDiscovery"
import type { PlaybackFactsVariables } from "../../recommendations/playbackFacts"
import * as recorderModule from "../../recommendations/playbackRecorder"
import {
  createRecommendationPlaybackRecorder,
  type RecommendationPlaybackRecorder,
} from "../../recommendations/playbackRecorder"
import { createPlaybackRecorderForMedia } from "../../recommendations/playbackRecorderClient"
import { getPendingClaimStore } from "../../recommendations/selection"
import { mutateWithDeadline } from "../../recommendations/transport"
import { getRecommendationViewerStore } from "../../recommendations/viewerIdentityClient"
import {
  CLIP_EPISODE_GAP_MS,
  CLIP_EPISODE_START_MS,
  CLIP_EPISODES_PER_SESSION,
  CLIP_EVIDENCE_DIGEST_PREFIX,
  CLIP_EVIDENCE_STORAGE_KEY,
  CLIP_EVIDENCE_VERSION,
  createClipEvidence,
  createClipEvidenceBudget,
  createClipEvidenceForFeed,
  digestSessionToken,
  parseStoredClipEvidence,
  resetClipEvidenceBudgetForTests,
  serializeClipEvidence,
} from "../clipEvidence"

const T0 = Date.parse("2026-09-25T00:00:00.000Z")
const VIEWER = "v".repeat(43)
const SESSION = "s".repeat(43)
const ROTATED = "r".repeat(43)
const HOME_NONCE = "h".repeat(32)
const CONTEXT_NONCE = "c".repeat(32)
const EPISODE = {
  episodeId: "ep-1",
  capability: "cap-1",
  activeUntil: "2026-09-25T01:00:00.000Z",
  hardUntil: "2026-09-25T02:00:00.000Z",
}
/** The clip window starts here in every case; the video runs 600 s. */
const WINDOW_START = 100

/** Node's own hash; this app ships no Node type definitions. */
type NodeCrypto = {
  createHash: (algorithm: "sha256") => {
    update: (data: string) => { digest: (encoding: "hex") => string }
  }
}

function sha256(value: string): string {
  const { createHash } = require("crypto") as NodeCrypto
  return createHash("sha256").update(value).digest("hex")
}

async function settle() {
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 12; i += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function receiptsFor(variables: PlaybackFactsVariables) {
  return variables.events.map((event, index) => ({
    eventId: event.eventId,
    status: "accepted",
    sequence: index + 1,
  }))
}

function makeStorage(items = new Map<string, string>()) {
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

type LogEntry = {
  at: number
  event: "context" | "claim" | "facts"
  mediaId: string
  kinds?: string[]
}

function feed(
  options: {
    items?: Map<string, string>
    session?: string | null
    available?: boolean
    claimFails?: (mediaId: string) => Error | null
    getSessionToken?: () => Promise<string | null>
  } = {},
) {
  const clock = { now: T0 }
  const timers: { at: number; run: () => void; live: boolean }[] = []
  const log: LogEntry[] = []
  const storage = makeStorage(options.items)
  const budget = createClipEvidenceBudget({
    getItem: storage.getItem,
    setItem: storage.setItem,
  })
  const session = options.session === undefined ? SESSION : options.session
  const at = () => clock.now - T0
  const wait = jest.fn(async () => undefined)
  const recorders: RecommendationPlaybackRecorder[] = []
  const createRecorder = jest.fn((mediaId: string) => {
    const recorder = createRecommendationPlaybackRecorder({
      mode: "clip",
      mediaId,
      discoveryKeys: [],
      takePendingNonce: () => null,
      restorePendingNonce: () => undefined,
      takeDiscovery: () => DIRECT_DISCOVERY,
      getIdentity: async () =>
        session == null
          ? { kind: "unprovisioned" as const }
          : {
              kind: "ready" as const,
              identity: { viewerToken: VIEWER, sessionToken: session },
              personalization: true,
            },
      issueContext: async (_identity, target) => {
        log.push({ at: at(), event: "context", mediaId: target })
        return { claimNonce: CONTEXT_NONCE }
      },
      claimEpisode: async (_identity, _nonce, target) => {
        log.push({ at: at(), event: "claim", mediaId: target })
        const failure = options.claimFails?.(target)
        if (failure) throw failure
        return EPISODE
      },
      sendFacts: async (variables: PlaybackFactsVariables) => {
        log.push({
          at: at(),
          event: "facts",
          mediaId: variables.mediaId,
          kinds: variables.events.map((event) => event.kind),
        })
        return receiptsFor(variables)
      },
      invalidateIdentity: async () => undefined,
      touch: () => undefined,
      holdPlayback: () => () => undefined,
      isForeground: () => true,
      now: () => clock.now,
      wait,
      report: jest.fn(),
    })
    recorders.push(recorder)
    return recorder
  })
  const getSessionToken = jest.fn(
    options.getSessionToken ?? (async () => session),
  )
  const evidence = createClipEvidence({
    isAvailable: () => options.available ?? true,
    createRecorder,
    getSessionToken,
    digest: digestSessionToken,
    budget,
    now: () => clock.now,
    setTimer: (run, ms) => {
      const timer = { at: clock.now + ms, run, live: true }
      timers.push(timer)
      return () => {
        timer.live = false
      }
    },
  })

  async function advance(ms: number) {
    const until = clock.now + ms
    for (;;) {
      const next = timers
        .filter((timer) => timer.live && timer.at <= until)
        .sort((a, b) => a.at - b.at)[0]
      if (next == null) break
      clock.now = Math.max(clock.now, next.at)
      next.live = false
      next.run()
      await settle()
    }
    clock.now = until
    await settle()
  }

  /** The feed's active clip plays for `seconds`, with one time update a second. */
  async function play(token: number, seconds: number) {
    evidence.setClip({
      token,
      mediaId: `media-${token}`,
      windowStartSeconds: WINDOW_START,
    })
    evidence.onPlayingChange(token, true, WINDOW_START)
    for (let s = 1; s <= seconds; s += 1) {
      await advance(1_000)
      evidence.onTime(token, WINDOW_START + s, 600)
    }
  }

  const contexts = () => log.filter((entry) => entry.event === "context")
  const facts = () => log.filter((entry) => entry.event === "facts")

  return {
    evidence,
    budget,
    storage,
    log,
    wait,
    recorders,
    createRecorder,
    getSessionToken,
    advance,
    play,
    contexts,
    facts,
    at,
  }
}

describe("AE12: the 3 s start and the session cap", () => {
  it("sends no claim when the viewer swipes to a new clip every 2 s", async () => {
    const h = feed()
    for (let token = 1; token <= 30; token += 1) await h.play(token, 2)
    h.evidence.dispose()
    await settle()
    expect(h.log).toEqual([])
    expect(h.getSessionToken).not.toHaveBeenCalled()
    expect(h.createRecorder).not.toHaveBeenCalled()
  })

  it("gives 15 clips of 10 s each 12 episodes, then none", async () => {
    const h = feed()
    for (let token = 1; token <= 15; token += 1) await h.play(token, 10)
    h.evidence.dispose()
    await settle()
    expect(h.contexts().map((entry) => entry.mediaId)).toEqual(
      Array.from(
        { length: CLIP_EPISODES_PER_SESSION },
        (_, i) => `media-${i + 1}`,
      ),
    )
    expect(h.contexts()[0].at).toBe(CLIP_EPISODE_START_MS)
    expect(
      h.budget.countFor(sha256(CLIP_EVIDENCE_DIGEST_PREFIX + SESSION)),
    ).toBe(CLIP_EPISODES_PER_SESSION)
    // A refused clip asks once, and does not ask again while it plays.
    expect(h.getSessionToken).toHaveBeenCalledTimes(15)
  })

  it("needs 3 s without a break: a pause restarts the count", async () => {
    const h = feed()
    h.evidence.setClip({
      token: 1,
      mediaId: "media-1",
      windowStartSeconds: WINDOW_START,
    })
    h.evidence.onPlayingChange(1, true, WINDOW_START)
    await h.advance(2_500)
    h.evidence.onPlayingChange(1, false, WINDOW_START + 2.5)
    await h.advance(5_000)
    h.evidence.onPlayingChange(1, true, WINDOW_START + 2.5)
    await h.advance(2_900)
    expect(h.contexts()).toEqual([])
    await h.advance(100)
    // Resumed at 7.5 s, so the 3 s run ends at 10.5 s.
    expect(h.contexts().map((entry) => entry.at)).toEqual([10_500])
  })

  it("starts nothing for a clip that loads but never plays", async () => {
    const h = feed()
    h.evidence.setClip({
      token: 1,
      mediaId: "media-1",
      windowStartSeconds: WINDOW_START,
    })
    await h.advance(30_000)
    expect(h.log).toEqual([])
    expect(h.getSessionToken).not.toHaveBeenCalled()
  })
})

describe("the 10 s gap", () => {
  it("starts an episode at most once per 10 s when every clip plays 4 s", async () => {
    const h = feed()
    for (let token = 1; token <= 12; token += 1) await h.play(token, 4)
    h.evidence.dispose()
    await settle()
    const starts = h.contexts().map((entry) => entry.at)
    expect(starts).toEqual([3_000, 15_000, 27_000, 39_000])
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(
        CLIP_EPISODE_GAP_MS,
      )
    }
  })

  it("starts a clip that reached 3 s inside the gap when the gap ends, if it still plays", async () => {
    const h = feed()
    await h.play(1, 5)
    await h.play(2, 10)
    expect(h.contexts().map((entry) => [entry.mediaId, entry.at])).toEqual([
      ["media-1", 3_000],
      ["media-2", 3_000 + CLIP_EPISODE_GAP_MS],
    ])
  })

  it("sends nothing for that clip when the viewer swipes before the gap ends", async () => {
    const h = feed()
    await h.play(1, 5)
    await h.play(2, 7)
    h.evidence.setClip(null)
    await h.advance(30_000)
    expect(h.contexts().map((entry) => entry.mediaId)).toEqual(["media-1"])
  })

  it("counts nothing when the viewer swipes while the count is still loading", async () => {
    let release: (token: string | null) => void = () => undefined
    const h = feed({
      getSessionToken: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    await h.play(1, 4)
    expect(h.getSessionToken).toHaveBeenCalledTimes(1)
    h.evidence.setClip({
      token: 2,
      mediaId: "media-2",
      windowStartSeconds: WINDOW_START,
    })
    release(SESSION)
    await settle()
    expect(h.createRecorder).not.toHaveBeenCalled()
    expect(
      h.budget.countFor(sha256(CLIP_EVIDENCE_DIGEST_PREFIX + SESSION)),
    ).toBe(0)
    expect(h.log).toEqual([])
  })

  it("starts a new 3 s run when the clip pauses and resumes during the lookup", async () => {
    let release: (token: string | null) => void = () => undefined
    const lookups = jest
      .fn<Promise<string | null>, []>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockImplementation(async () => SESSION)
    const h = feed({ getSessionToken: lookups })
    h.evidence.setClip({
      token: 1,
      mediaId: "media-1",
      windowStartSeconds: WINDOW_START,
    })
    h.evidence.onPlayingChange(1, true, WINDOW_START)
    await h.advance(3_500)
    h.evidence.onPlayingChange(1, false, WINDOW_START + 3.5)
    await h.advance(500)
    h.evidence.onPlayingChange(1, true, WINDOW_START + 3.5)
    release(SESSION)
    await settle()
    expect(h.contexts()).toEqual([])
    await h.advance(3_000)
    expect(h.contexts().map((entry) => entry.at)).toEqual([7_000])
  })
})

describe("the stored count", () => {
  const digest = (token: string) => sha256(CLIP_EVIDENCE_DIGEST_PREFIX + token)

  it("lets a relaunch with the same session count 2 more after 10, then none", async () => {
    const items = new Map<string, string>()
    const first = feed({ items })
    for (let token = 1; token <= 10; token += 1) await first.play(token, 10)
    first.evidence.dispose()
    await settle()
    expect(first.contexts()).toHaveLength(10)

    const relaunched = feed({ items })
    for (let token = 11; token <= 15; token += 1)
      await relaunched.play(token, 10)
    relaunched.evidence.dispose()
    await settle()
    expect(relaunched.contexts().map((entry) => entry.mediaId)).toEqual([
      "media-11",
      "media-12",
    ])
    expect(
      parseStoredClipEvidence(items.get(CLIP_EVIDENCE_STORAGE_KEY) ?? null),
    ).toEqual({
      sessionDigest: digest(SESSION),
      count: CLIP_EPISODES_PER_SESSION,
    })
  })

  it("starts a new count for a rotated session token", async () => {
    const items = new Map<string, string>()
    const first = feed({ items })
    for (let token = 1; token <= 13; token += 1) await first.play(token, 10)
    first.evidence.dispose()
    await settle()
    expect(first.contexts()).toHaveLength(CLIP_EPISODES_PER_SESSION)

    const rotated = feed({ items, session: ROTATED })
    for (let token = 14; token <= 16; token += 1) await rotated.play(token, 10)
    rotated.evidence.dispose()
    await settle()
    expect(rotated.contexts()).toHaveLength(3)
    expect(
      parseStoredClipEvidence(items.get(CLIP_EVIDENCE_STORAGE_KEY) ?? null),
    ).toEqual({
      sessionDigest: digest(ROTATED),
      count: 3,
    })
  })

  it("stores a digest of the session token, never the token", async () => {
    const items = new Map<string, string>()
    const h = feed({ items })
    await h.play(1, 10)
    h.evidence.dispose()
    await settle()
    const stored = items.get(CLIP_EVIDENCE_STORAGE_KEY) ?? ""
    expect(stored).toContain(digest(SESSION))
    expect(stored).not.toContain(SESSION)
    // Apart from any other digest of the same token.
    expect(stored).not.toContain(sha256(SESSION))
  })

  it("reads a corrupt, foreign-version or malformed value as no count", () => {
    const good = serializeClipEvidence({
      sessionDigest: "d".repeat(64),
      count: 3,
    })
    expect(parseStoredClipEvidence(good)).toEqual({
      sessionDigest: "d".repeat(64),
      count: 3,
    })
    expect(parseStoredClipEvidence(null)).toBeNull()
    expect(parseStoredClipEvidence("{not json")).toBeNull()
    expect(
      parseStoredClipEvidence(
        JSON.stringify({
          v: CLIP_EVIDENCE_VERSION + 1,
          s: "d".repeat(64),
          n: 3,
        }),
      ),
    ).toBeNull()
    expect(
      parseStoredClipEvidence(
        JSON.stringify({ v: CLIP_EVIDENCE_VERSION, s: "", n: 3 }),
      ),
    ).toBeNull()
    expect(
      parseStoredClipEvidence(
        JSON.stringify({ v: CLIP_EVIDENCE_VERSION, s: "d".repeat(64), n: -1 }),
      ),
    ).toBeNull()
  })
})

describe("one open episode, fed by the active clip only", () => {
  it("ends the previous clip's episode before it claims its own", async () => {
    const h = feed()
    await h.play(1, 12)
    await h.play(2, 10)
    const ended = h.log.findIndex(
      (entry) =>
        entry.event === "facts" &&
        entry.mediaId === "media-1" &&
        entry.kinds?.includes("playback_end"),
    )
    const claimed = h.log.findIndex(
      (entry) => entry.event === "context" && entry.mediaId === "media-2",
    )
    expect(ended).toBeGreaterThanOrEqual(0)
    expect(claimed).toBeGreaterThan(ended)
    expect(h.recorders[0].getState().terminal).toBe(true)
    expect(h.recorders[1].getState().terminal).toBe(false)
  })

  it("keeps one episode across a pause and a resume of the same clip", async () => {
    const h = feed()
    await h.play(1, 5)
    h.evidence.onPlayingChange(1, false, WINDOW_START + 5)
    await h.advance(4_000)
    h.evidence.onPlayingChange(1, true, WINDOW_START + 5)
    await h.advance(20_000)
    h.evidence.dispose()
    await settle()
    expect(h.contexts()).toHaveLength(1)
    const kinds = h.facts().flatMap((entry) => entry.kinds ?? [])
    expect(kinds.filter((kind) => kind === "playback_navigation")).toHaveLength(
      2,
    )
  })

  it("never starts a recorder from the standby player's events", async () => {
    const h = feed()
    h.evidence.setClip({
      token: 1,
      mediaId: "media-1",
      windowStartSeconds: WINDOW_START,
    })
    // Token 2 is the standby: it may buffer and even report play edges.
    h.evidence.onPlayingChange(2, true, WINDOW_START)
    for (let s = 1; s <= 10; s += 1) {
      await h.advance(1_000)
      h.evidence.onTime(2, WINDOW_START + s, 600)
    }
    expect(h.createRecorder).not.toHaveBeenCalled()
    expect(h.getSessionToken).not.toHaveBeenCalled()
    h.evidence.onPlayingChange(1, true, WINDOW_START)
    await h.advance(CLIP_EPISODE_START_MS)
    expect(h.createRecorder.mock.calls).toEqual([["media-1"]])
  })

  it("records a loop back to the clip start with no seek fact", async () => {
    const h = feed()
    await h.play(1, 20)
    // The feed loops at the window end; one time update can still show the old playhead.
    h.evidence.onLoop(1)
    await h.advance(250)
    h.evidence.onTime(1, WINDOW_START + 20.2, 600)
    for (let s = 1; s <= 5; s += 1) {
      await h.advance(1_000)
      h.evidence.onTime(1, WINDOW_START + s, 600)
    }
    h.evidence.dispose()
    await settle()
    const kinds = h.facts().flatMap((entry) => entry.kinds ?? [])
    expect(kinds).toContain("playback_end")
    expect(kinds).not.toContain("playback_seek")
  })

  it("records the same jump as a seek when no loop explains it", async () => {
    const h = feed()
    await h.play(1, 20)
    await h.advance(250)
    h.evidence.onTime(1, WINDOW_START + 20.2, 600)
    for (let s = 1; s <= 5; s += 1) {
      await h.advance(1_000)
      h.evidence.onTime(1, WINDOW_START + s, 600)
    }
    h.evidence.dispose()
    await settle()
    const kinds = h.facts().flatMap((entry) => entry.kinds ?? [])
    expect(kinds).toContain("playback_seek")
  })
})

describe("the shared client", () => {
  it("sends nothing at all when the client is off or unprovisioned", async () => {
    const h = feed({ available: false })
    for (let token = 1; token <= 3; token += 1) await h.play(token, 10)
    h.evidence.dispose()
    await settle()
    expect(h.log).toEqual([])
    expect(h.getSessionToken).not.toHaveBeenCalled()
    expect(h.createRecorder).not.toHaveBeenCalled()
    expect(h.storage.getItem).not.toHaveBeenCalled()
  })

  it("sends nothing when the viewer store has no identity", async () => {
    const h = feed({ session: null })
    await h.play(1, 10)
    h.evidence.dispose()
    await settle()
    expect(h.log).toEqual([])
    expect(h.createRecorder).not.toHaveBeenCalled()
  })

  it("waits one window on a rate-limited clip claim, drops it, and lets the next clip claim its own", async () => {
    const h = feed({
      claimFails: (mediaId) =>
        mediaId === "media-1"
          ? new RecommendationClientError("RATE_LIMITED")
          : null,
    })
    await h.play(1, 10)
    await h.play(2, 10)
    h.evidence.dispose()
    await settle()
    const claims = h.log.filter((entry) => entry.event === "claim")
    expect(claims.map((entry) => entry.mediaId)).toEqual([
      "media-1",
      "media-1",
      "media-2",
    ])
    expect(h.wait.mock.calls).toEqual([[RATE_LIMIT_WINDOW_MS]])
    expect(h.facts().every((entry) => entry.mediaId === "media-2")).toBe(true)
    expect(h.facts().length).toBeGreaterThan(0)
  })

  it("arms the progress-writer guard this file relies on", () => {
    expect(() => require("../../watchProgress/store")).toThrow(
      "clip evidence loaded the watch progress store",
    )
  })
})

describe("the real wiring", () => {
  const mutate = mutateWithDeadline as jest.Mock
  const viewerStore = getRecommendationViewerStore() as unknown as {
    get: jest.Mock
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: T0 })
    resetClipEvidenceBudgetForTests()
    await AsyncStorage.clear()
    getPendingClaimStore().clear()
    getPlaybackDiscoveryStore().clear()
    mutate.mockReset()
    mutate.mockImplementation(async (document: unknown, variables: unknown) => {
      if (document === ISSUE_WATCH_PLAYBACK_CONTEXT)
        return { issueWatchPlaybackContext: { claimNonce: CONTEXT_NONCE } }
      if (document === CLAIM_RECOMMENDATION_EPISODE)
        return { claimSemanticRecommendationEpisode: EPISODE }
      if (document === RECORD_RECOMMENDATION_PLAYBACK)
        return {
          recordSemanticRecommendationPlayback: receiptsFor(
            variables as PlaybackFactsVariables,
          ),
        }
      throw new Error("unexpected operation")
    })
    viewerStore.get.mockReset()
    viewerStore.get.mockResolvedValue({
      kind: "ready",
      identity: { viewerToken: VIEWER, sessionToken: SESSION },
      personalization: true,
    })
    ;(isRecommendationClientEnabled as jest.Mock).mockReturnValue(true)
    ;(getApiToken as jest.Mock).mockReturnValue("fleet")
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  async function flush() {
    for (let i = 0; i < 60; i += 1) await Promise.resolve()
  }

  async function watchOneClip() {
    const evidence = createClipEvidenceForFeed()
    evidence.setClip({
      token: 1,
      mediaId: "media-1",
      windowStartSeconds: WINDOW_START,
    })
    evidence.onPlayingChange(1, true, WINDOW_START)
    for (let s = 1; s <= 10; s += 1) {
      await jest.advanceTimersByTimeAsync(1_000)
      await flush()
      evidence.onTime(1, WINDOW_START + s, 600)
    }
    evidence.dispose()
    await flush()
  }

  it("claims a clip as direct and leaves Home's nonce and the search mark for the watch page", async () => {
    getPendingClaimStore().set({
      mediaId: "media-1",
      claimNonce: HOME_NONCE,
      selectedAt: T0,
    })
    getPlaybackDiscoveryStore().mark("media-1", "search")
    await watchOneClip()
    const issued = mutate.mock.calls.filter(
      ([document]) => document === ISSUE_WATCH_PLAYBACK_CONTEXT,
    )
    expect(issued).toHaveLength(1)
    expect(issued[0][1]).toMatchObject({
      mediaId: "media-1",
      discoverySource: "direct",
      provenance: {},
    })
    const claims = mutate.mock.calls.filter(
      ([document]) => document === CLAIM_RECOMMENDATION_EPISODE,
    )
    expect(claims).toHaveLength(1)
    expect(claims[0][1]).toMatchObject({ claimNonce: CONTEXT_NONCE })
    expect(getPendingClaimStore().peek()?.claimNonce).toBe(HOME_NONCE)
    expect(getPlaybackDiscoveryStore().take(["media-1"]).source).toBe("search")
    const stored = await AsyncStorage.getItem(CLIP_EVIDENCE_STORAGE_KEY)
    expect(parseStoredClipEvidence(stored)).toEqual({
      sessionDigest: sha256(CLIP_EVIDENCE_DIGEST_PREFIX + SESSION),
      count: 1,
    })
  })

  it("hands a clip recorder no discovery keys and no way to take Home's nonce", () => {
    getPendingClaimStore().set({
      mediaId: "media-1",
      claimNonce: HOME_NONCE,
      selectedAt: T0,
    })
    getPlaybackDiscoveryStore().mark("media-1", "search")
    const create = jest.spyOn(
      recorderModule,
      "createRecommendationPlaybackRecorder",
    )
    try {
      expect(
        createPlaybackRecorderForMedia({ mediaId: "media-1", mode: "clip" }),
      ).not.toBeNull()
      const deps = create.mock.calls[0][0]
      expect(deps.mode).toBe("clip")
      expect(deps.discoveryKeys).toEqual([])
      expect(deps.takePendingNonce("media-1")).toBeNull()
      expect(deps.takeDiscovery(["media-1"])).toEqual(DIRECT_DISCOVERY)
      expect(getPendingClaimStore().peek()?.claimNonce).toBe(HOME_NONCE)
      expect(getPlaybackDiscoveryStore().take(["media-1"]).source).toBe(
        "search",
      )
    } finally {
      create.mockRestore()
    }
  })

  it("still hands the watch page's recorder the real stores", () => {
    getPendingClaimStore().set({
      mediaId: "media-1",
      claimNonce: HOME_NONCE,
      selectedAt: T0,
    })
    const create = jest.spyOn(
      recorderModule,
      "createRecommendationPlaybackRecorder",
    )
    try {
      createPlaybackRecorderForMedia({
        mediaId: "media-1",
        discoveryKeys: ["jesus", "media-1"],
      })
      const deps = create.mock.calls[0][0]
      expect(deps.mode).toBeUndefined()
      expect(deps.discoveryKeys).toEqual(["jesus", "media-1"])
      expect(deps.takePendingNonce("media-1")).toBe(HOME_NONCE)
    } finally {
      create.mockRestore()
    }
  })

  it.each([
    [
      "disabled",
      () => (isRecommendationClientEnabled as jest.Mock).mockReturnValue(false),
    ],
    [
      "unprovisioned",
      () => (getApiToken as jest.Mock).mockReturnValue(undefined),
    ],
  ])("sends nothing at all when the client is %s", async (_name, turnOff) => {
    turnOff()
    await watchOneClip()
    expect(mutate).not.toHaveBeenCalled()
    expect(viewerStore.get).not.toHaveBeenCalled()
    expect(await AsyncStorage.getItem(CLIP_EVIDENCE_STORAGE_KEY)).toBeNull()
  })
})
