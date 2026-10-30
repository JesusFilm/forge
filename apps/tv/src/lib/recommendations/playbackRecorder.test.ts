import {
  createPlaybackRecorder,
  type PlaybackFact,
  type PlaybackObservation,
} from "./playbackRecorder"

function fixture() {
  let now = 0
  let id = 0
  const batches: PlaybackFact[][] = []
  const recorder = createPlaybackRecorder({
    generation: 1,
    now: () => now,
    timestamp: () => new Date(now).toISOString(),
    id: () => `event-${++id}`,
    emit: (events) => batches.push(events),
  })
  return {
    recorder,
    batches,
    sample(
      at: number,
      position: number,
      state: PlaybackObservation["state"] = "playing",
      generation = 1,
      seeking = false,
    ) {
      now = at
      recorder.observe({
        sourceGeneration: generation,
        state,
        positionSeconds: position,
        durationSeconds: 100,
        seeking,
      })
    },
    facts: () => batches.flat(),
  }
}

it("uses the strict attempt payload, not a position proxy", () => {
  const f = fixture()
  expect(f.facts()[0]).toMatchObject({
    kind: "playback_attempt",
    payload: { initiation: "manual" },
  })
})
it("counts monotonic playing intervals and sends progress every ten seconds", () => {
  const f = fixture()
  for (let second = 0; second <= 10; second++) f.sample(second * 1000, second)
  expect(
    f.facts().find((e) => e.kind === "playback_active_visible_playing")?.payload
      .activeMilliseconds,
  ).toBe(10000)
  expect(f.facts().filter((e) => e.kind === "playback_progress")).toHaveLength(
    1,
  )
})
it("does not manufacture watch time by resuming or seeking forward", () => {
  const f = fixture()
  f.sample(0, 42)
  f.sample(1000, 43)
  f.sample(2000, 90)
  f.sample(3000, 91)
  f.recorder.stop("route_exit")
  const active = f
    .facts()
    .filter((e) => e.kind === "playback_active_visible_playing")
  expect(
    active.reduce(
      (total, e) => total + Number(e.payload.activeMilliseconds),
      0,
    ),
  ).toBe(2000)
  expect(f.facts().find((e) => e.kind === "playback_seek")?.payload).toEqual({
    fromSeconds: 43,
    toSeconds: 90,
  })
})
it("excludes paused, buffering, seek and background intervals", () => {
  const f = fixture()
  f.sample(0, 0)
  f.sample(1000, 1)
  f.sample(2000, 1, "paused")
  f.sample(3000, 1, "buffering")
  f.sample(4000, 1, "playing", 1, true)
  f.recorder.visibility(false)
  f.sample(5000, 2)
  f.sample(6000, 3)
  f.recorder.visibility(true)
  f.sample(7000, 4)
  f.sample(8000, 5)
  f.recorder.stop("route_exit")
  expect(
    f
      .facts()
      .filter((e) => e.kind === "playback_active_visible_playing")
      .reduce((sum, e) => sum + Number(e.payload.activeMilliseconds), 0),
  ).toBe(2000)
})
it("drops stale-source callbacks and long missing-observation gaps", () => {
  const f = fixture()
  f.sample(0, 0)
  f.sample(1000, 1, "playing", 0)
  f.sample(2000, 2)
  f.sample(3000, 3)
  f.recorder.stop("route_exit")
  expect(
    f.facts().find((e) => e.kind === "playback_active_visible_playing")?.payload
      .activeMilliseconds,
  ).toBe(1000)
})
it.each(["ended", "error"] as const)(
  "flushes %s once and never records after termination",
  (state) => {
    const f = fixture()
    f.sample(0, 0)
    f.sample(1000, 1)
    f.sample(2000, 2, state)
    f.sample(3000, 3)
    f.recorder.stop("route_exit")
    expect(f.facts().filter((e) => e.kind === "playback_end")).toHaveLength(1)
    expect(
      f.facts().find((e) => e.kind === "playback_end")?.payload.completed,
    ).toBe(state === "ended")
  },
)
it("does not flood progress while paused", () => {
  const f = fixture()
  for (let tick = 0; tick < 20; tick++) f.sample(tick * 250, 0, "paused")
  expect(f.facts().filter((e) => e.kind === "playback_progress")).toHaveLength(
    1,
  )
})
it("flushes source changes without ending the episode and ignores the old generation", () => {
  const f = fixture()
  f.sample(0, 0)
  f.sample(1000, 1)
  f.recorder.changeSource(2)
  f.sample(2000, 2, "playing", 1)
  f.sample(3000, 1, "playing", 2)
  f.sample(4000, 2, "playing", 2)
  f.recorder.stop("route_exit")
  expect(
    f
      .facts()
      .filter((e) => e.kind === "playback_active_visible_playing")
      .map((e) => e.payload.activeMilliseconds),
  ).toEqual([1000, 1000])
  expect(f.facts().filter((e) => e.kind === "playback_attempt")).toHaveLength(1)
  expect(f.facts().filter((e) => e.kind === "playback_end")).toHaveLength(1)
})
it("stamps active intervals at their real end, not at a later pause or seek", () => {
  const f = fixture()
  f.sample(0, 0)
  f.sample(1000, 1)
  f.sample(2000, 1, "paused")
  const fact = f
    .facts()
    .find((e) => e.kind === "playback_active_visible_playing")
  expect(fact?.occurredAt).toBe(new Date(1000).toISOString())
})
