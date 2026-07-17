import type { ShowcaseHop } from "./hopSchedule"
import {
  CHAPTER_CARD_DURATION_MS,
  INITIAL_REEL_STATE,
  INTERSTITIAL_EVERY_N_CHAPTERS,
  REEL_FAILURE_BREAKER_THRESHOLD,
  currentChapter,
  currentExcerpt,
  nextExcerpt,
  reelReducer,
  stillsPosters,
  type ReelEvent,
  type ReelState,
} from "./reelState"
import type { ShowcaseChapter, ShowcaseExcerpt, ShowcaseQueue } from "./types"

// ── Fixtures ────────────────────────────────────────────────────────

function excerpt(chapterId: string, coreId: string): ShowcaseExcerpt {
  return {
    id: `${chapterId}:${coreId}`,
    coreId,
    slug: `${coreId}-slug`,
    title: `Title ${coreId}`,
    posterUrl: `https://img/${coreId}.jpg`,
    rawLabel: "SHORT_FILM",
  }
}

function chapter(id: string, coreIds: readonly string[]): ShowcaseChapter {
  return {
    id,
    title: `Chapter ${id}`,
    subtitle: null,
    excerpts: coreIds.map((coreId) => excerpt(id, coreId)),
  }
}

function curatedQueue(
  chapters: ShowcaseChapter[],
  statLines: string[] = ["1,900 languages"],
): ShowcaseQueue {
  return { kind: "curated", chapters, statLines }
}

/** U2 forces statLines to [] on this path; the reel must not depend on that. */
function fallbackQueue(chapters: ShowcaseChapter[]): ShowcaseQueue {
  return { kind: "fallback", chapters, statLines: [] }
}

function run(state: ReelState, ...events: ReelEvent[]): ReelState {
  return events.reduce(reelReducer, state)
}

/** Plays the screen's role: answers the loop-boundary refresh the reel armed. */
function answerRefresh(state: ReelState, queue: ShowcaseQueue): ReelState {
  return state.refresh.status === "pending"
    ? reelReducer(state, { type: "queueRefreshed", queue })
    : state
}

function started(queue: ShowcaseQueue): ReelState {
  return reelReducer(INITIAL_REEL_STATE, { type: "resolved", queue })
}

/** Drives the current chapter to its end through real events, not hand-set state. */
function completeChapter(state: ReelState): ReelState {
  const chapter = currentChapter(state)
  if (chapter == null) throw new Error("no current chapter to complete")
  let next =
    state.phase === "chapterCard"
      ? reelReducer(state, { type: "cardTimerElapsed" })
      : state
  for (let i = 0; i < chapter.excerpts.length; i++) {
    next = reelReducer(next, { type: "excerptEnded" })
  }
  return next
}

const threeChapters = () => [
  chapter("a", ["v1", "v2"]),
  chapter("b", ["v3", "v4"]),
  chapter("c", ["v5", "v6"]),
]

/** One planned hop, shaped as buildHopSchedule (U5) emits them. */
function hop(languageSlug: string, start: number, end: number): ShowcaseHop {
  return {
    languageSlug,
    languageName: languageSlug.toUpperCase(),
    hls: `https://stream/${languageSlug}.m3u8`,
    muxPlaybackId: `pb-${languageSlug}`,
    window: { startSeconds: start, endSeconds: end },
  }
}

/** English opener then two contiguous hops — the shape the centerpiece executes. */
const threeHopPlan = (): ShowcaseHop[] => [
  hop("english", 90, 100),
  hop("spanish", 100, 110),
  hop("french", 110, 120),
]

/** Drives to the centerpiece excerpt (first of chapter a, card lifted). */
function atCenterpiece(): ReelState {
  return run(started(curatedQueue(threeChapters())), {
    type: "cardTimerElapsed",
  })
}

/** The screen's role: hand the reducer a plan for the excerpt it is on. */
function enterHop(state: ReelState, plan: ShowcaseHop[]): ReelState {
  return reelReducer(state, {
    type: "hopPlanResolved",
    token: state.excerptToken,
    plan,
  })
}

// ── Mode start and queue entry ──────────────────────────────────────

describe("mode start", () => {
  it("starts in resolving with no queue", () => {
    expect(INITIAL_REEL_STATE.phase).toBe("resolving")
    expect(INITIAL_REEL_STATE.queue).toBeNull()
  })

  it("enters the chapter card when a curated queue is ready", () => {
    const state = started(curatedQueue(threeChapters()))
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("a")
  })

  it("enters the first excerpt directly when a fallback queue is ready", () => {
    const state = started(fallbackQueue([chapter("fb", ["v1", "v2"])]))
    expect(state.phase).toBe("excerpt")
    expect(currentExcerpt(state)?.coreId).toBe("v1")
  })

  it("goes to stills when the resolved queue has nothing playable", () => {
    expect(started(curatedQueue([])).phase).toBe("stills")
    expect(started(curatedQueue([chapter("a", [])])).phase).toBe("stills")
  })

  it("goes to stills when resolution fails outright", () => {
    const state = reelReducer(INITIAL_REEL_STATE, { type: "resolveFailed" })
    expect(state.phase).toBe("stills")
  })

  it("enters the first excerpt after the card timer elapses", () => {
    const state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    expect(state.phase).toBe("excerpt")
    expect(currentExcerpt(state)?.coreId).toBe("v1")
    expect(CHAPTER_CARD_DURATION_MS).toBeGreaterThan(0)
  })
})

// ── R16: a chapter with no playable items is skipped whole ──────────

describe("empty chapters (R16)", () => {
  it("never shows the card of a leading chapter that has no items", () => {
    const state = started(
      curatedQueue([chapter("empty", []), chapter("b", ["v1"])]),
    )
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("b")
  })

  it("skips an empty middle chapter in one transition", () => {
    const queue = curatedQueue([
      chapter("a", ["v1"]),
      chapter("empty", []),
      chapter("c", ["v2"]),
    ])
    const state = completeChapter(started(queue))
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("c")
  })

  it("loops past a trailing empty chapter back to the first playable one", () => {
    const queue = curatedQueue([chapter("a", ["v1"]), chapter("empty", [])])
    const state = completeChapter(started(queue))
    expect(currentChapter(state)?.id).toBe("a")
  })
})

// ── Chapter completion and interstitial cadence (R8/R9) ─────────────

describe("chapter completion", () => {
  it("advances through a chapter's excerpts before completing it", () => {
    const state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    const second = reelReducer(state, { type: "excerptEnded" })
    expect(second.phase).toBe("excerpt")
    expect(currentExcerpt(second)?.coreId).toBe("v2")
  })

  it("routes to the next chapter card when the cadence is not due", () => {
    const state = completeChapter(started(curatedQueue(threeChapters())))
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("b")
  })

  it("routes to the interstitial only once the cadence is due", () => {
    const chapters = [
      chapter("a", ["v1"]),
      chapter("b", ["v2"]),
      chapter("c", ["v3"]),
      chapter("d", ["v4"]),
    ]
    expect(INTERSTITIAL_EVERY_N_CHAPTERS).toBe(3)

    let state = started(curatedQueue(chapters))
    state = completeChapter(state)
    expect(state.phase).toBe("chapterCard")
    state = completeChapter(state)
    expect(state.phase).toBe("chapterCard")
    state = completeChapter(state)
    expect(state.phase).toBe("interstitial")
  })

  it("returns to the next chapter card when the interstitial timer elapses", () => {
    const chapters = [
      chapter("a", ["v1"]),
      chapter("b", ["v2"]),
      chapter("c", ["v3"]),
      chapter("d", ["v4"]),
    ]
    let state = started(curatedQueue(chapters))
    for (let i = 0; i < 3; i++) state = completeChapter(state)
    expect(state.phase).toBe("interstitial")

    state = reelReducer(state, { type: "interstitialTimerElapsed" })
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("d")
  })

  it("restarts the cadence after an interstitial", () => {
    const chapters = [
      chapter("a", ["v1"]),
      chapter("b", ["v2"]),
      chapter("c", ["v3"]),
      chapter("d", ["v4"]),
      chapter("e", ["v5"]),
      chapter("f", ["v6"]),
    ]
    let state = started(curatedQueue(chapters))
    for (let i = 0; i < 3; i++) state = completeChapter(state)
    state = reelReducer(state, { type: "interstitialTimerElapsed" })
    // d and e complete without an interstitial; only f's completion is due again.
    state = completeChapter(state)
    expect(state.phase).toBe("chapterCard")
    state = completeChapter(state)
    expect(state.phase).toBe("chapterCard")
    state = completeChapter(state)
    expect(state.phase).toBe("interstitial")
  })

  it("never enters an interstitial when no stat lines were authored", () => {
    const chapters = [
      chapter("a", ["v1"]),
      chapter("b", ["v2"]),
      chapter("c", ["v3"]),
      chapter("d", ["v4"]),
    ]
    let state = started(curatedQueue(chapters, []))
    for (let i = 0; i < 3; i++) state = completeChapter(state)
    expect(state.phase).toBe("chapterCard")
  })
})

// ── Fallback reels skip chapter cards and interstitials entirely ────

describe("fallback reels", () => {
  it("never enters chapterCard or interstitial across four full loops", () => {
    const queue = fallbackQueue([chapter("fb", ["v1", "v2", "v3"])])
    let state = answerRefresh(started(queue), queue)
    const phases: string[] = [state.phase]
    for (let i = 0; i < 12; i++) {
      state = answerRefresh(reelReducer(state, { type: "excerptEnded" }), queue)
      phases.push(state.phase)
    }
    expect(phases).not.toContain("chapterCard")
    expect(phases).not.toContain("interstitial")
    expect(new Set(phases)).toEqual(new Set(["excerpt"]))
  })

  it("skips the interstitial on kind alone, even if stat lines leak in", () => {
    // Guards the kind gate independently of the statLines gate: U2 forces
    // statLines to [] here, so only `kind` can carry the rule if that changes.
    const leaky: ShowcaseQueue = {
      kind: "fallback",
      chapters: [
        chapter("a", ["v1"]),
        chapter("b", ["v2"]),
        chapter("c", ["v3"]),
        chapter("d", ["v4"]),
      ],
      statLines: ["leaked"],
    }
    // c's completion is exactly where the cadence comes due.
    let state = started(leaky)
    for (let i = 0; i < 3; i++) state = completeChapter(state)
    expect(state.phase).toBe("excerpt")
    expect(currentChapter(state)?.id).toBe("d")
  })
})

// ── AE5: an item failure advances the reel ──────────────────────────

// Every other failure test elapses the card first, which encodes "the shell never
// fails during a card" — the exact assumption the resolve effect breaks, since the
// card's own token bump is what arms it.
describe("item failure DURING the chapter card (R16)", () => {
  it("accepts the failure the resolve dispatches before the card lifts", () => {
    const state = started(curatedQueue(threeChapters()))
    expect(state.phase).toBe("chapterCard")

    const failed = reelReducer(state, { type: "excerptFailed" })

    expect(failed.consecutiveFailures).toBe(1)
    expect(currentExcerpt(failed)?.coreId).toBe("v2")
  })

  it("holds the card while it retries behind it, rather than flashing past a dead item", () => {
    const failed = reelReducer(started(curatedQueue(threeChapters())), {
      type: "excerptFailed",
    })

    expect(failed.phase).toBe("chapterCard")
    expect(failed.chapterIndex).toBe(0)
    // Holding, not dropping: the guard that ignored card-phase failures outright left
    // the same phase and index, so only the advance behind the card tells them apart.
    expect(currentExcerpt(failed)?.coreId).toBe("v2")
  })

  it("re-arms the resolve by bumping the token, so the reel cannot wedge on the card", () => {
    const state = started(curatedQueue(threeChapters()))
    const failed = reelReducer(state, { type: "excerptFailed" })

    expect(failed.excerptToken).toBeGreaterThan(state.excerptToken)
  })

  it("reaches stills when every first-of-chapter item fails from its card", () => {
    let state = started(
      curatedQueue([
        chapter("a", ["v1"]),
        chapter("b", ["v2"]),
        chapter("c", ["v3"]),
      ]),
    )
    for (let i = 0; i < REEL_FAILURE_BREAKER_THRESHOLD; i++) {
      state = reelReducer(state, { type: "excerptFailed" })
    }

    expect(state.phase).toBe("stills")
  })

  it("leaves the card for the next chapter's own card, not a stale one", () => {
    // A one-excerpt chapter has nothing to retry behind the card, so the failure
    // must carry to the next chapter and that chapter's card.
    const failed = reelReducer(
      started(curatedQueue([chapter("a", ["v1"]), chapter("b", ["v2", "v3"])])),
      { type: "excerptFailed" },
    )

    expect(failed.phase).toBe("chapterCard")
    expect(failed.chapterIndex).toBe(1)
    expect(currentExcerpt(failed)?.coreId).toBe("v2")
  })

  it("still ignores a failure from a phase that has no excerpt in flight", () => {
    const stills = {
      ...started(curatedQueue(threeChapters())),
      phase: "stills" as const,
    }

    expect(reelReducer(stills, { type: "excerptFailed" })).toBe(stills)
  })
})

describe("item failure (AE5)", () => {
  it("advances to the next excerpt in one transition and counts the failure", () => {
    const state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    const failed = reelReducer(state, { type: "excerptFailed" })
    expect(failed.phase).toBe("excerpt")
    expect(currentExcerpt(failed)?.coreId).toBe("v2")
    expect(failed.consecutiveFailures).toBe(1)
  })

  it("carries a failure across a chapter boundary", () => {
    const queue = curatedQueue([chapter("a", ["v1"]), chapter("b", ["v2"])])
    let state = run(started(queue), { type: "cardTimerElapsed" })
    state = reelReducer(state, { type: "excerptFailed" })
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("b")
    expect(state.consecutiveFailures).toBe(1)
  })

  it("resets the failure counter once an excerpt PLAYS THROUGH", () => {
    let state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    state = reelReducer(state, { type: "excerptFailed" })
    expect(state.consecutiveFailures).toBe(1)

    state = reelReducer(state, { type: "excerptEnded" })
    expect(state.consecutiveFailures).toBe(0)
  })

  // The reason the reset lives on completion. On a degrading network an item paints a
  // frame and then freezes, so anything that cleared the breaker at first frame would
  // let three such items churn forever instead of reaching stills (AE7).
  it("does not clear the breaker for an item that starts and then fails", () => {
    let state = run(started(curatedQueue([chapter("a", ["v1", "v2", "v3"])])), {
      type: "cardTimerElapsed",
    })

    state = reelReducer(state, { type: "excerptFailed" })
    state = reelReducer(state, { type: "excerptFailed" })

    expect(state.consecutiveFailures).toBe(2)
  })
})

// ── AE7: the breaker and the stills terminal state ──────────────────

describe("failure breaker (AE7)", () => {
  // One long chapter so consecutive failures stay inside the excerpt phase; a card
  // between them is a legitimate pause, not a strobe, and is covered separately.
  const deadChapter = () =>
    curatedQueue([chapter("a", ["v1", "v2", "v3", "v4"])])

  /** Fails items until the breaker trips, as a dead network would. */
  function failUntilStills(queue: ShowcaseQueue): ReelState {
    let state = run(started(queue), { type: "cardTimerElapsed" })
    for (let i = 0; i < REEL_FAILURE_BREAKER_THRESHOLD; i++) {
      state = reelReducer(state, { type: "excerptFailed" })
    }
    return state
  }

  it("keeps skipping items until consecutive failures reach the threshold", () => {
    expect(REEL_FAILURE_BREAKER_THRESHOLD).toBeGreaterThan(1)
    let state = run(started(deadChapter()), { type: "cardTimerElapsed" })
    for (let i = 0; i < REEL_FAILURE_BREAKER_THRESHOLD - 1; i++) {
      state = reelReducer(state, { type: "excerptFailed" })
      expect(state.phase).toBe("excerpt")
    }
    state = reelReducer(state, { type: "excerptFailed" })
    expect(state.phase).toBe("stills")
  })

  it("still trips when the failures straddle a chapter card", () => {
    const queue = curatedQueue([
      chapter("a", ["v1"]),
      chapter("b", ["v2", "v3"]),
    ])
    let state = run(started(queue), { type: "cardTimerElapsed" })
    state = reelReducer(state, { type: "excerptFailed" })
    // a's only item died, so the reel is showing b's card — the counter must survive it.
    expect(state.phase).toBe("chapterCard")
    state = run(
      state,
      { type: "cardTimerElapsed" },
      { type: "excerptFailed" },
      { type: "excerptFailed" },
    )
    expect(state.phase).toBe("stills")
    expect(state.consecutiveFailures).toBe(REEL_FAILURE_BREAKER_THRESHOLD)
  })

  it("trips across a loop wrap — a short all-dead reel must still reach stills", () => {
    // Two one-item chapters wrap before three failures can land. The wrap used to
    // launder the counter, which made stills unreachable and looped a dead reel forever.
    expect(REEL_FAILURE_BREAKER_THRESHOLD).toBe(3)
    const queue = curatedQueue([chapter("a", ["v1"]), chapter("b", ["v2"])])
    let state = run(started(queue), { type: "cardTimerElapsed" })
    state = reelReducer(state, { type: "excerptFailed" })
    state = run(state, { type: "cardTimerElapsed" }, { type: "excerptFailed" })
    // The final chapter armed a refresh, so the boundary waits on it.
    expect(state.phase).toBe("resolving")
    state = reelReducer(state, { type: "queueRefreshFailed" })
    expect(state.consecutiveFailures).toBe(2)
    state = run(state, { type: "cardTimerElapsed" }, { type: "excerptFailed" })
    expect(state.phase).toBe("stills")
  })

  it("gives a fresh attempt from stills a clean slate — it is not the same run", () => {
    const queue = deadChapter()
    const state = reelReducer(failUntilStills(queue), {
      type: "resolved",
      queue,
    })
    expect(state.consecutiveFailures).toBe(0)
    expect(state.phase).toBe("chapterCard")
  })

  it("keeps the last-good queue in stills so posters can render", () => {
    const queue = deadChapter()
    const state = failUntilStills(queue)
    expect(state.phase).toBe("stills")
    expect(state.queue).toBe(queue)
    expect(stillsPosters(state)).toContain("https://img/v1.jpg")
  })

  it("rejoins the reel at a chapter card when a re-resolve succeeds", () => {
    const state = failUntilStills(deadChapter())
    expect(state.phase).toBe("stills")

    const fresh = curatedQueue([chapter("z", ["v9"])])
    const rejoined = reelReducer(state, { type: "resolved", queue: fresh })
    expect(rejoined.phase).toBe("chapterCard")
    expect(currentChapter(rejoined)?.id).toBe("z")
    // Otherwise the very first failure after rejoining re-trips the breaker.
    expect(rejoined.consecutiveFailures).toBe(0)
  })

  it("stays in stills without churning when a re-resolve fails", () => {
    const inStills = failUntilStills(deadChapter())
    expect(inStills.phase).toBe("stills")

    const after = run(
      inStills,
      { type: "resolveFailed" },
      { type: "resolveFailed" },
    )
    // Same reference: no re-render, so no fast-skip strobe behind the stills.
    expect(after).toBe(inStills)
    expect(after.phase).toBe("stills")
  })
})

// ── R17: the loop-boundary refresh ──────────────────────────────────

describe("loop boundary refresh", () => {
  it("requests a refresh when the final chapter is entered", () => {
    const queue = curatedQueue([chapter("a", ["v1"]), chapter("b", ["v2"])])
    let state = started(queue)
    expect(state.refresh.status).toBe("idle")
    state = completeChapter(state)
    expect(currentChapter(state)?.id).toBe("b")
    expect(state.refresh.status).toBe("pending")
  })

  it("adopts the refreshed queue at the boundary", () => {
    const queue = curatedQueue([chapter("a", ["v1"])])
    const fresh = curatedQueue([chapter("fresh", ["v9"])])
    let state = started(queue)
    state = reelReducer(state, { type: "queueRefreshed", queue: fresh })
    expect(state.refresh.status).toBe("ready")
    expect(currentChapter(state)?.id).toBe("a")

    state = completeChapter(state)
    expect(state.queue).toBe(fresh)
    expect(currentChapter(state)?.id).toBe("fresh")
    expect(state.phase).toBe("chapterCard")
  })

  it("preserves the last-good queue when the refresh fails", () => {
    const queue = curatedQueue([chapter("a", ["v1"])])
    let state = started(queue)
    state = reelReducer(state, { type: "queueRefreshFailed" })
    expect(state.refresh.status).toBe("failed")

    state = completeChapter(state)
    expect(state.queue).toBe(queue)
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("a")
  })

  it("waits in the loading state when the refresh has not landed in time", () => {
    const queue = curatedQueue([chapter("a", ["v1"])])
    let state = completeChapter(started(queue))
    expect(state.phase).toBe("resolving")
    expect(state.queue).toBe(queue)

    const fresh = curatedQueue([chapter("fresh", ["v9"])])
    state = reelReducer(state, { type: "queueRefreshed", queue: fresh })
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("fresh")
  })

  it("falls back to the last-good queue when a late refresh fails", () => {
    const queue = curatedQueue([chapter("a", ["v1"])])
    let state = completeChapter(started(queue))
    expect(state.phase).toBe("resolving")

    state = reelReducer(state, { type: "queueRefreshFailed" })
    // Never stills: a last-good queue is content, and stills is the floor.
    expect(state.phase).toBe("chapterCard")
    expect(state.queue).toBe(queue)
  })
})

// ── R12: the exit event is terminal from every state ────────────────

describe("exit", () => {
  const queue = curatedQueue([
    chapter("a", ["v1"]),
    chapter("b", ["v2"]),
    chapter("c", ["v3"]),
    chapter("d", ["v4"]),
  ])

  function statesByPhase(): Record<string, ReelState> {
    const resolving = INITIAL_REEL_STATE
    const chapterCard = started(queue)
    const excerpt = reelReducer(chapterCard, { type: "cardTimerElapsed" })
    let interstitial = started(queue)
    for (let i = 0; i < 3; i++) interstitial = completeChapter(interstitial)
    const stills = reelReducer(INITIAL_REEL_STATE, { type: "resolveFailed" })
    return { resolving, chapterCard, excerpt, interstitial, stills }
  }

  it("exits from every reel state", () => {
    for (const [phase, state] of Object.entries(statesByPhase())) {
      expect(state.phase).toBe(phase)
      expect(reelReducer(state, { type: "exit" }).phase).toBe("exited")
    }
  })

  it("ignores every event once exited", () => {
    const exited = reelReducer(started(queue), { type: "exit" })
    const after = run(
      exited,
      { type: "exit" },
      { type: "cardTimerElapsed" },
      { type: "excerptEnded" },
      { type: "excerptFailed" },
      { type: "resolved", queue },
    )
    expect(after).toBe(exited)
  })
})

// ── The excerpt token: the screen's resolve key ─────────────────────

describe("excerpt token", () => {
  it("advances when the target excerpt changes within a chapter", () => {
    const state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    const next = reelReducer(state, { type: "excerptEnded" })
    expect(next.excerptToken).toBeGreaterThan(state.excerptToken)
  })

  it("holds steady when the card timer only starts the same excerpt", () => {
    // The card is the prefetch window: its excerpt already resolved, and a bump
    // here would re-resolve it and re-rotate its language.
    const card = started(curatedQueue(threeChapters()))
    const excerpt = reelReducer(card, { type: "cardTimerElapsed" })
    expect(excerpt.excerptToken).toBe(card.excerptToken)
  })

  it("advances when a one-item reel loops onto the very same excerpt", () => {
    const queue = fallbackQueue([chapter("solo", ["v1"])])
    const first = answerRefresh(started(queue), queue)
    const looped = answerRefresh(
      reelReducer(first, { type: "excerptEnded" }),
      queue,
    )
    // Indices and the excerpt object are identical across this loop, so the token
    // is the only thing that can tell the screen to play it again.
    expect(looped.chapterIndex).toBe(first.chapterIndex)
    expect(looped.excerptIndex).toBe(first.excerptIndex)
    expect(currentExcerpt(looped)).toBe(currentExcerpt(first))
    expect(looped.excerptToken).toBeGreaterThan(first.excerptToken)
  })

  it("advances when a re-resolve rejoins the reel from stills", () => {
    let state = run(
      started(curatedQueue([chapter("a", ["v1", "v2", "v3", "v4"])])),
      { type: "cardTimerElapsed" },
    )
    for (let i = 0; i < REEL_FAILURE_BREAKER_THRESHOLD; i++) {
      state = reelReducer(state, { type: "excerptFailed" })
    }
    expect(state.phase).toBe("stills")

    const rejoined = reelReducer(state, {
      type: "resolved",
      queue: curatedQueue(threeChapters()),
    })
    expect(rejoined.excerptToken).toBeGreaterThan(state.excerptToken)
  })
})

// ── Selectors the screen and the prefetch read ──────────────────────

describe("selectors", () => {
  it("reports the excerpt that will play next within a chapter", () => {
    const state = run(started(curatedQueue(threeChapters())), {
      type: "cardTimerElapsed",
    })
    expect(nextExcerpt(state)?.coreId).toBe("v2")
  })

  it("reports the next chapter's first excerpt at a chapter boundary", () => {
    const queue = curatedQueue([chapter("a", ["v1"]), chapter("b", ["v2"])])
    const state = run(started(queue), { type: "cardTimerElapsed" })
    expect(nextExcerpt(state)?.coreId).toBe("v2")
  })

  it("wraps to the first excerpt of the queue at the loop boundary", () => {
    const queue = curatedQueue([chapter("a", ["v1"])])
    const state = run(started(queue), { type: "cardTimerElapsed" })
    expect(nextExcerpt(state)?.coreId).toBe("v1")
  })

  it("has no current or next excerpt before a queue resolves", () => {
    expect(currentExcerpt(INITIAL_REEL_STATE)).toBeNull()
    expect(nextExcerpt(INITIAL_REEL_STATE)).toBeNull()
    expect(stillsPosters(INITIAL_REEL_STATE)).toEqual([])
  })

  it("collects unique poster art across chapters for the stills slideshow", () => {
    const state = started(curatedQueue(threeChapters()))
    expect(stillsPosters(state)).toEqual([
      "https://img/v1.jpg",
      "https://img/v2.jpg",
      "https://img/v3.jpg",
      "https://img/v4.jpg",
      "https://img/v5.jpg",
      "https://img/v6.jpg",
    ])
  })
})

// ── KTD-5/KTD-6: the language centerpiece plays as a hop plan ────────

describe("hop mode — entering (KTD-5)", () => {
  it("enters hop mode at index 0 without bumping the token or changing phase", () => {
    const state = atCenterpiece()
    const hopped = enterHop(state, threeHopPlan())
    expect(hopped.hop).toEqual({ hops: threeHopPlan(), index: 0 })
    // The plan is the FIRST stream for this excerpt's token, so the swap is triggered
    // by the stream object changing — no token bump, no phase change.
    expect(hopped.excerptToken).toBe(state.excerptToken)
    expect(hopped.phase).toBe("excerpt")
  })

  it("accepts a plan while the chapter card is still up — the card is the buffer window", () => {
    const card = started(curatedQueue(threeChapters()))
    expect(card.phase).toBe("chapterCard")
    const hopped = enterHop(card, threeHopPlan())
    expect(hopped.hop?.index).toBe(0)
    expect(hopped.phase).toBe("chapterCard")
  })

  it("discards a plan built for a stale token — the reel advanced during the async build", () => {
    const state = atCenterpiece()
    const stale = reelReducer(state, {
      type: "hopPlanResolved",
      token: state.excerptToken - 1,
      plan: threeHopPlan(),
    })
    expect(stale).toBe(state)
  })

  it("ignores a plan arriving with no excerpt in flight (stills)", () => {
    const stills = { ...atCenterpiece(), phase: "stills" as const }
    expect(
      reelReducer(stills, {
        type: "hopPlanResolved",
        token: stills.excerptToken,
        plan: threeHopPlan(),
      }),
    ).toBe(stills)
  })
})

describe("hop mode — advancing on end (KTD-5)", () => {
  it("advances to the next hop on excerptEnded — new token, breaker untouched", () => {
    const state = enterHop(atCenterpiece(), threeHopPlan())
    const next = reelReducer(state, { type: "excerptEnded" })
    expect(next.hop?.index).toBe(1)
    expect(next.excerptToken).toBeGreaterThan(state.excerptToken)
    expect(next.consecutiveFailures).toBe(0)
    expect(next.phase).toBe("excerpt")
  })

  it("bumps the token on EVERY hop so the swap/watchdog/chrome re-arm per hop", () => {
    let state = enterHop(atCenterpiece(), threeHopPlan())
    const tokens = [state.excerptToken]
    state = reelReducer(state, { type: "excerptEnded" })
    tokens.push(state.excerptToken)
    // The last hop's end leaves hop mode, so stop before it.
    expect(new Set(tokens).size).toBe(tokens.length)
    expect(tokens[1]).toBeGreaterThan(tokens[0])
  })

  it("leaves hop mode and advances the excerpt when the last hop ends, clearing the breaker", () => {
    let state = enterHop(atCenterpiece(), threeHopPlan())
    // Carry a prior strike in: a completed centerpiece must clear it like any excerpt.
    state = { ...state, consecutiveFailures: 1 }
    state = reelReducer(state, { type: "excerptEnded" }) // 0 -> 1
    state = reelReducer(state, { type: "excerptEnded" }) // 1 -> 2
    state = reelReducer(state, { type: "excerptEnded" }) // last hop ends -> exit
    expect(state.hop).toBeNull()
    expect(state.consecutiveFailures).toBe(0)
    expect(currentExcerpt(state)?.coreId).toBe("v2")
  })
})

describe("hop mode — failure skips without a strike (KTD-6/AE6)", () => {
  it("skips to the next hop on excerptFailed WITHOUT tripping the breaker", () => {
    let state = enterHop(atCenterpiece(), threeHopPlan())
    state = reelReducer(state, { type: "excerptFailed" }) // 0 -> 1
    expect(state.hop?.index).toBe(1)
    expect(state.consecutiveFailures).toBe(0)
    state = reelReducer(state, { type: "excerptFailed" }) // 1 -> 2
    expect(state.hop?.index).toBe(2)
    expect(state.consecutiveFailures).toBe(0)
  })

  it("never trips the breaker even when a whole long plan fails hop by hop", () => {
    const long = [
      hop("a", 0, 10),
      hop("b", 10, 20),
      hop("c", 20, 30),
      hop("d", 30, 40),
      hop("e", 40, 50),
    ]
    let state = enterHop(atCenterpiece(), long)
    for (let i = 0; i < long.length - 1; i++) {
      state = reelReducer(state, { type: "excerptFailed" })
    }
    expect(state.consecutiveFailures).toBe(0)
    expect(state.hop?.index).toBe(long.length - 1)
  })

  it("charges ONE strike when the last hop fails with nothing left to play", () => {
    let state = enterHop(atCenterpiece(), threeHopPlan())
    state = reelReducer(state, { type: "excerptFailed" }) // 0 -> 1
    state = reelReducer(state, { type: "excerptFailed" }) // 1 -> 2
    expect(state.consecutiveFailures).toBe(0)
    state = reelReducer(state, { type: "excerptFailed" }) // last hop fails -> normal ladder
    expect(state.hop).toBeNull()
    expect(state.consecutiveFailures).toBe(1)
    expect(currentExcerpt(state)?.coreId).toBe("v2")
  })

  it("still reaches stills when the centerpiece is the reel's third dead excerpt", () => {
    // Two ordinary excerpts fail (2 strikes), then a fully-dead centerpiece is the
    // third — its hop failures count as one strike, which trips the breaker.
    let state = run(started(curatedQueue([chapter("a", ["v1", "v2", "v3"])])), {
      type: "cardTimerElapsed",
    })
    state = reelReducer(state, { type: "excerptFailed" }) // v1 dead: 1
    state = reelReducer(state, { type: "excerptFailed" }) // v2 dead: 2
    expect(state.consecutiveFailures).toBe(2)
    state = enterHop(state, threeHopPlan()) // v3 is the centerpiece
    state = reelReducer(state, { type: "excerptFailed" }) // hop 0 -> 1 (no strike)
    state = reelReducer(state, { type: "excerptFailed" }) // hop 1 -> 2 (no strike)
    expect(state.consecutiveFailures).toBe(2)
    state = reelReducer(state, { type: "excerptFailed" }) // last hop dead -> strike -> stills
    expect(state.phase).toBe("stills")
    expect(state.consecutiveFailures).toBe(REEL_FAILURE_BREAKER_THRESHOLD)
  })
})

describe("hop mode — cadence and ordinary excerpts (R9/R11)", () => {
  it("counts a hop-rich centerpiece as ONE chapter toward the interstitial cadence", () => {
    const chapters = [
      chapter("a", ["v1"]),
      chapter("b", ["v2"]),
      chapter("c", ["v3"]),
      chapter("d", ["v4"]),
    ]
    let state = started(curatedQueue(chapters))
    state = reelReducer(state, { type: "cardTimerElapsed" }) // excerpt a/v1
    state = enterHop(state, threeHopPlan())
    state = reelReducer(state, { type: "excerptEnded" }) // hop 0 -> 1
    state = reelReducer(state, { type: "excerptEnded" }) // hop 1 -> 2
    state = reelReducer(state, { type: "excerptEnded" }) // last hop -> chapter a done
    expect(state.phase).toBe("chapterCard")
    expect(currentChapter(state)?.id).toBe("b")
    state = completeChapter(state) // b done
    state = completeChapter(state) // c done -> third chapter -> interstitial
    expect(state.phase).toBe("interstitial")
  })

  it("keeps ordinary excerpts entirely out of hop mode", () => {
    const state = reelReducer(atCenterpiece(), { type: "excerptEnded" })
    expect(state.hop).toBeNull()
  })

  it("never carries a hop plan into a re-resolved queue (enterQueue clears it)", () => {
    // Force a lingering plan onto the stills floor: a fresh queue must never inherit it.
    const stillsWithHop: ReelState = {
      ...atCenterpiece(),
      phase: "stills",
      hop: { hops: threeHopPlan(), index: 1 },
    }
    const rejoined = reelReducer(stillsWithHop, {
      type: "resolved",
      queue: curatedQueue(threeChapters()),
    })
    expect(rejoined.hop).toBeNull()
    expect(rejoined.phase).toBe("chapterCard")
  })
})
