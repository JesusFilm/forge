import {
  AUDIO_FADE_OUT_ARM_SECONDS,
  fadeOutVolumeAt,
  shouldArmFadeOut,
} from "./audioFade"
import type { ShowcaseDubInput } from "./languageRotation"
import { sameHopStream } from "./hopHandoff"
import {
  buildHopSchedule,
  HOP_TIMING_UNUSABLE,
  hopToStream,
  MAX_HOP_SEGMENT_SECONDS,
  type ShowcaseHop,
} from "./hopSchedule"
import type { VttCue } from "../parseVtt"
import { deriveSentenceTiming, type SentenceTiming } from "./sentenceTiming"
import type { ExcerptWindow } from "./types"

// ── Fixtures ────────────────────────────────────────────────────────
// One dub, shaped as showcaseVideoQuery returns them. A playable dub is
// `published === true` AND a non-empty hls (languageRotation's contract).

function dub(
  languageSlug: string | null,
  overrides: Partial<ShowcaseDubInput> = {},
): ShowcaseDubInput {
  return {
    published: true,
    hls: `https://stream/${languageSlug ?? "none"}.m3u8`,
    duration: 600,
    language: languageSlug
      ? { slug: languageSlug, name: { en: languageSlug.toUpperCase() } }
      : null,
    muxVideo: { playbackId: `pb-${languageSlug ?? "none"}` },
    ...overrides,
  }
}

// A deterministic PRNG so a seed fixes an entire hop order (no Math.random in the
// module OR the suite — the repo bans nondeterminism in these modules).
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const zeroRng = () => 0
const slugs = (hops: ShowcaseHop[] | null) =>
  (hops ?? []).map((h) => h.languageSlug)

// A rich centerpiece: English plus N other languages, each its own slug.
const OTHERS = [
  "spanish",
  "french",
  "german",
  "portuguese",
  "arabic",
  "hindi",
  "mandarin",
  "swahili",
  "russian",
  "japanese",
  "korean",
]
function centerpiece(
  otherCount: number,
  dubOverrides: Partial<ShowcaseDubInput> = {},
) {
  return [
    dub("english", dubOverrides),
    ...OTHERS.slice(0, otherCount).map((s) => dub(s, dubOverrides)),
  ]
}

// ── R8: opener is English, else the default-resolved dub ────────────

describe("buildHopSchedule — opener (R8)", () => {
  it("always opens on the exact english slug when a playable english dub exists", () => {
    // Deliberately place english LAST — the opener rule is slug identity, not order.
    const dubs = [dub("spanish"), dub("french"), dub("english")]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(hops?.[0]?.languageSlug).toBe("english")
  })

  it("opens on the default-resolved dub when no english dub is playable", () => {
    // No bcp47 rides playableDubs, so resolveDefaultSlug degrades to the first
    // playable dub — deterministic and Hermes-safe (device locale can't match).
    const dubs = [dub("spanish"), dub("french"), dub("german")]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(hops?.[0]?.languageSlug).toBe("spanish")
    expect(slugs(hops)).not.toContain("english")
  })

  it("does not treat english-north-american-indigenous as english", () => {
    // bcp47 en-nai would collide under prefix matching; identity is the exact slug.
    const dubs = [
      dub("english-north-american-indigenous"),
      dub("spanish"),
      dub("french"),
    ]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(hops?.[0]?.languageSlug).toBe("english-north-american-indigenous")
  })

  it("gives the opener a full segment even when the source must be truncated", () => {
    // 34s → credits-free end 29s; the opener must not be the shortened slice.
    const hops = buildHopSchedule({
      dubs: centerpiece(8, { duration: 34 }),
      rng: zeroRng,
    })
    expect(hops?.[0]?.window).toEqual({ startSeconds: 0, endSeconds: 10 })
  })
})

// ── R8/AE4: hop count and uniqueness ────────────────────────────────

describe("buildHopSchedule — count and uniqueness (R8/AE4)", () => {
  it("caps a dub-rich centerpiece at 9 hops, english first, all slugs unique", () => {
    const hops = buildHopSchedule({ dubs: centerpiece(11), rng: mulberry32(7) })
    expect(hops).not.toBeNull()
    expect(hops!.length).toBe(9)
    expect(hops![0]?.languageSlug).toBe("english")
    expect(new Set(slugs(hops)).size).toBe(hops!.length)
  })

  it("hops through exactly what exists below the recommended 6 (AE4)", () => {
    // 4 playable dubs (english + 3) → exactly 4 hops, no repeats, ends normally.
    const hops = buildHopSchedule({ dubs: centerpiece(3), rng: mulberry32(1) })
    expect(hops!.length).toBe(4)
    expect(new Set(slugs(hops)).size).toBe(4)
  })

  it("emits one hop per language for a 6-language centerpiece", () => {
    const hops = buildHopSchedule({ dubs: centerpiece(5), rng: mulberry32(2) })
    expect(hops!.length).toBe(6)
  })

  it("dedupes repeated language slugs into one hop", () => {
    const dubs = [
      dub("english"),
      dub("english"),
      dub("spanish"),
      dub("spanish"),
      dub("french"),
    ]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(slugs(hops)!.sort()).toEqual(["english", "french", "spanish"])
  })

  it("excludes slug-less dubs from the hop rotation", () => {
    const dubs = [dub("english"), dub(null), dub("spanish")]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(slugs(hops)).toEqual(["english", "spanish"])
    // The slug-less dub's stream must never surface.
    expect((hops ?? []).some((h) => h.hls.includes("none"))).toBe(false)
  })

  it("keeps two distinct slugs sharing a bcp47 prefix as two hops", () => {
    // ko/ko-kmr collide on bcp47; identity is the slug, so korean and kurmanji both play.
    const dubs = [
      dub("korean", {
        language: { slug: "korean", bcp47: "ko", name: { en: "Korean" } },
      }),
      dub("kurmanji", {
        language: { slug: "kurmanji", bcp47: "ko", name: { en: "Kurmanji" } },
      }),
    ]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(slugs(hops)!.sort()).toEqual(["korean", "kurmanji"])
  })

  it("carries each hop's dub identity through to the output", () => {
    const hops = buildHopSchedule({
      dubs: [dub("english"), dub("spanish")],
      rng: zeroRng,
    })
    expect(hops?.[0]).toMatchObject({
      languageSlug: "english",
      languageName: "ENGLISH",
      hls: "https://stream/english.m3u8",
      muxPlaybackId: "pb-english",
    })
  })
})

// ── R9 / R6-exception: timing and the credits tail ──────────────────

describe("buildHopSchedule — timing (R9)", () => {
  it("clamps the plan to the shortest scheduled dub, not the opener alone", () => {
    // Same footage drifts per dub: a 94s sibling must bound a 100s opener's plan,
    // or its hop would seek past its own credits-free end (94 - 5 = 89).
    const dubs = [
      dub("english", { duration: 100 }),
      dub("spanish", { duration: 94 }),
      dub("french", { duration: 100 }),
    ]
    for (let seed = 0; seed < 8; seed++) {
      const hops = buildHopSchedule({ dubs, rng: mulberry32(seed) })
      expect(hops).not.toBeNull()
      const last = hops![hops!.length - 1]
      expect(last.window.endSeconds).toBeLessThanOrEqual(94 - 5)
    }
  })

  it("ignores unknown sibling durations when clamping (opener-length assumed)", () => {
    const dubs = [
      dub("english", { duration: 600 }),
      dub("spanish", { duration: null }),
      dub("french", { duration: 600 }),
    ]
    const hops = buildHopSchedule({ dubs, rng: zeroRng })
    expect(hops).not.toBeNull()
    expect(slugs(hops).length).toBe(3)
  })

  it("runs ~60-90s of ~10s segments for a long dub-rich centerpiece", () => {
    const hops = buildHopSchedule({
      dubs: centerpiece(11, { duration: 600 }),
      rng: mulberry32(3),
    })
    const total = hops!.reduce(
      (s, h) => s + (h.window.endSeconds - h.window.startSeconds),
      0,
    )
    expect(total).toBeGreaterThanOrEqual(60)
    expect(total).toBeLessThanOrEqual(90)
    for (const h of hops!) {
      expect(h.window.endSeconds - h.window.startSeconds).toBe(10)
    }
  })

  it("offsets the plan ~15% into the source, mirroring the long-form convention", () => {
    // 600s, 4 hops → 15% = 90s in, then four contiguous 10s slices.
    const hops = buildHopSchedule({
      dubs: centerpiece(3, { duration: 600 }),
      rng: zeroRng,
    })
    expect(hops?.[0]?.window.startSeconds).toBe(90)
    expect(hops?.[hops.length - 1]?.window.endSeconds).toBe(130)
  })

  it("plays hops back-to-back on a continuous media position", () => {
    const hops = buildHopSchedule({
      dubs: centerpiece(6, { duration: 600 }),
      rng: mulberry32(9),
    })!
    for (let i = 1; i < hops.length; i++) {
      expect(hops[i].window.startSeconds).toBe(hops[i - 1].window.endSeconds)
    }
  })

  it("keeps the whole plan at least five seconds clear of the end", () => {
    // 100s → credits-free end is 95s; the last hop must not reach past it.
    const hops = buildHopSchedule({
      dubs: centerpiece(11, { duration: 100 }),
      rng: mulberry32(4),
    })!
    expect(hops[hops.length - 1].window.endSeconds).toBeLessThanOrEqual(95)
  })

  it("truncates a short source into fewer/shorter slices, still continuous and clear of the tail", () => {
    // 34s → credits-free end 29s: two full 10s slices then a 9s final slice.
    const hops = buildHopSchedule({
      dubs: centerpiece(8, { duration: 34 }),
      rng: mulberry32(5),
    })!
    expect(
      hops.map((h) => [h.window.startSeconds, h.window.endSeconds]),
    ).toEqual([
      [0, 10],
      [10, 20],
      [20, 29],
    ])
    expect(hops[hops.length - 1].window.endSeconds).toBeLessThanOrEqual(29)
  })

  it("drops a truncated final slice shorter than the readable floor", () => {
    // 23s → credits-free end 18s: one full 10s slice, an 8s slice — floor is 4s, so it stays.
    expect(
      buildHopSchedule({
        dubs: centerpiece(8, { duration: 23 }),
        rng: zeroRng,
      })!.length,
    ).toBe(2)
    // 18s → credits-free end 13s: one 10s slice, a 3s remainder below the 4s floor -> dropped,
    // leaving a lone hop, which is unschedulable (no switch to show).
    expect(
      buildHopSchedule({
        dubs: centerpiece(8, { duration: 18 }),
        rng: zeroRng,
      }),
    ).toBeNull()
  })
})

// ── AE3/AE4: degradation and the unschedulable result ───────────────

describe("buildHopSchedule — unschedulable (null) results", () => {
  it("is unschedulable when the video has no playable dubs at all", () => {
    expect(buildHopSchedule({ dubs: [], rng: zeroRng })).toBeNull()
    expect(buildHopSchedule({ dubs: null, rng: zeroRng })).toBeNull()
    expect(
      buildHopSchedule({
        dubs: [dub("english", { published: false })],
        rng: zeroRng,
      }),
    ).toBeNull()
  })

  it("is unschedulable for a single-language centerpiece — no switch to show", () => {
    expect(
      buildHopSchedule({ dubs: [dub("english")], rng: zeroRng }),
    ).toBeNull()
    expect(
      buildHopSchedule({
        dubs: [dub("english"), dub("english")],
        rng: zeroRng,
      }),
    ).toBeNull()
  })

  it("is unschedulable when only slug-less dubs are playable", () => {
    expect(
      buildHopSchedule({ dubs: [dub(null), dub(null)], rng: zeroRng }),
    ).toBeNull()
  })

  it("is unschedulable-extended when the opener dub has unknown duration", () => {
    // The opener's duration is the authoritative planning duration; unknown -> the caller
    // falls back to ordinary excerpt behaviour. Other dubs having a duration cannot rescue it.
    const dubs = [
      dub("english", { duration: null }),
      dub("spanish"),
      dub("french"),
    ]
    expect(buildHopSchedule({ dubs, rng: zeroRng })).toBeNull()
  })

  it("is unschedulable when the source is too short for even one meaningful hop", () => {
    // 12s → credits-free end 7s: below one full slice AND a lone remainder -> null.
    expect(
      buildHopSchedule({
        dubs: centerpiece(8, { duration: 12 }),
        rng: zeroRng,
      }),
    ).toBeNull()
  })
})

// ── Determinism under injected randomness ───────────────────────────

describe("buildHopSchedule — deterministic under seeded rng", () => {
  it("produces the identical plan for the same dubs and seed", () => {
    const dubs = centerpiece(8)
    const a = buildHopSchedule({ dubs, rng: mulberry32(42) })
    const b = buildHopSchedule({ dubs, rng: mulberry32(42) })
    expect(a).toEqual(b)
  })

  it("varies the hop order across seeds (english still first)", () => {
    const dubs = centerpiece(8)
    const orders = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const hops = buildHopSchedule({ dubs, rng: mulberry32(seed) })!
      expect(hops[0].languageSlug).toBe("english")
      orders.add(slugs(hops).join(","))
    }
    expect(orders.size).toBeGreaterThan(1)
  })

  it("never throws or emits an out-of-range plan for a degenerate rng", () => {
    // A misbehaving rng at the [0,1) boundary must not index past the array.
    for (const rng of [() => 0, () => 0.999999, () => 1, () => -0.1]) {
      const hops = buildHopSchedule({ dubs: centerpiece(8), rng })!
      expect(hops.length).toBeGreaterThanOrEqual(2)
      expect(hops.length).toBeLessThanOrEqual(9)
      expect(new Set(slugs(hops)).size).toBe(hops.length)
    }
  })
})

// ── R10/KTD-5: each hop seam is drift-safe against the crossfade arming ──

describe("buildHopSchedule — seam arming is drift-safe (KTD-5)", () => {
  // The player masks every hop seam with the SAME token-keyed audio crossfade the
  // ordinary window end uses. That fade arms AUDIO_FADE_OUT_ARM_SECONDS before the
  // window end and must never be stepped over by Android's over-1s drifting timeUpdate
  // clock (repo law: docs/solutions/integration-issues/expo-video-timeupdate-clock-
  // drift-audio-fade-hardcut.md). A hop window is only ~10s, so this pins that its
  // narrower span still arms — swept with fractional, over-1s periods, NOT a t+=1 grid.
  it("arms the fade in every hop's window at every phase offset, never early, always reaching the end", () => {
    const hops = buildHopSchedule({
      dubs: centerpiece(6, { duration: 600 }),
      rng: mulberry32(11),
    })!
    for (const h of hops) {
      const w = h.window
      for (const period of [1.01, 1.05, 1.2]) {
        for (let phase = 0; phase < period; phase += 0.05) {
          let firstArmRemaining: number | null = null
          let reachedEnd = false
          // The player seeks to windowStart, so the hop's clock runs from there.
          for (
            let t = w.startSeconds + phase;
            t <= w.endSeconds + period;
            t += period
          ) {
            if (
              firstArmRemaining == null &&
              shouldArmFadeOut({ currentTime: t, window: w })
            ) {
              firstArmRemaining = w.endSeconds - t
            }
            if (t >= w.endSeconds) {
              reachedEnd = true
              break
            }
          }
          // A sample always lands in the arming window (its width >= the drift period).
          expect(firstArmRemaining).not.toBeNull()
          // Audible content still remains at the arm — the fade is not a hard cut.
          expect(firstArmRemaining!).toBeGreaterThan(0)
          expect(
            fadeOutVolumeAt({ remainingSeconds: firstArmRemaining! }),
          ).toBeGreaterThan(0)
          // Never fires earlier than the margin allows.
          expect(firstArmRemaining!).toBeLessThanOrEqual(
            AUDIO_FADE_OUT_ARM_SECONDS,
          )
          // The hop-end threshold is always crossed, so onEnded fires for every hop.
          expect(reachedEnd).toBe(true)
        }
      }
    }
  })

  it("still arms inside a truncated final slice at the readable floor", () => {
    // duration 49 -> credits-free 44 -> [10,10,10,10,4]: the 4s floor slice is the
    // tightest window the planner can emit; a MIN_FINAL_SLICE/arming retune that
    // breaks the drift margin must fail here, not on device.
    const hops = buildHopSchedule({
      dubs: centerpiece(8, { duration: 49 }),
      rng: mulberry32(7),
    })!
    const last = hops[hops.length - 1]!
    expect(last.window.endSeconds - last.window.startSeconds).toBe(4)
    for (const period of [1.01, 1.05, 1.2]) {
      for (let phase = 0; phase < period; phase += 0.05) {
        let firstArmRemaining: number | null = null
        for (
          let t = last.window.startSeconds + phase;
          t <= last.window.endSeconds + period;
          t += period
        ) {
          if (
            firstArmRemaining == null &&
            shouldArmFadeOut({ currentTime: t, window: last.window })
          ) {
            firstArmRemaining = last.window.endSeconds - t
          }
          if (t >= last.window.endSeconds) break
        }
        expect(firstArmRemaining).not.toBeNull()
        expect(firstArmRemaining!).toBeGreaterThan(0)
        expect(
          fadeOutVolumeAt({ remainingSeconds: firstArmRemaining! }),
        ).toBeGreaterThan(0)
      }
    }
  })
})

// ── Invariants across a sweep of counts, durations, and seeds ───────

describe("buildHopSchedule — invariants over a sweep", () => {
  it("never emits overlaps, gaps, repeats, or a window past the credits-free end", () => {
    for (const otherCount of [1, 2, 3, 5, 7, 11]) {
      for (const duration of [30, 45, 60, 100, 200, 600, 3600, 7200]) {
        for (const seed of [1, 2, 3]) {
          const dubs = centerpiece(otherCount, { duration })
          const hops = buildHopSchedule({ dubs, rng: mulberry32(seed) })
          if (hops == null) continue

          expect(hops.length).toBeGreaterThanOrEqual(2)
          expect(hops.length).toBeLessThanOrEqual(9)
          expect(hops[0].languageSlug).toBe("english")
          expect(new Set(slugs(hops)).size).toBe(hops.length)

          expect(hops[0].window.startSeconds).toBeGreaterThanOrEqual(0)
          for (let i = 0; i < hops.length; i++) {
            const w = hops[i].window
            expect(w.endSeconds).toBeGreaterThan(w.startSeconds)
            if (i > 0)
              expect(w.startSeconds).toBe(hops[i - 1].window.endSeconds)
          }
          expect(hops[hops.length - 1].window.endSeconds).toBeLessThanOrEqual(
            duration - 5,
          )
        }
      }
    }
  })
})

// ── hopToStream (KTD-5's projection contract) ──────────────────────

describe("hopToStream", () => {
  const hop: ShowcaseHop = {
    languageSlug: "french",
    languageName: "French",
    hls: "https://stream/french.m3u8",
    muxPlaybackId: "pb-french",
    window: { startSeconds: 40, endSeconds: 50 },
  }

  it("maps every hop field onto the stream contract and always claims a language", () => {
    expect(hopToStream(hop)).toEqual({
      hls: "https://stream/french.m3u8",
      languageSlug: "french",
      languageName: "French",
      muxPlaybackId: "pb-french",
      window: { startSeconds: 40, endSeconds: 50 },
      claimsLanguage: true,
    })
  })

  it("projects one hop into two objects the flip matcher treats as the same stream", () => {
    // The shell projects each hop TWICE (current stream + earlier as preload);
    // sameHopStream identity across those projections is what arms the flip.
    expect(sameHopStream(hopToStream(hop), hopToStream(hop))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════
//  U2: sentence-aware plan path (KTD-1/4/6/10)
// ════════════════════════════════════════════════════════════════════

// A SentenceTiming supplied directly as PLANNER input: `spans` are the spoken stretches
// (KTD-4 density) and `boundaries` the sentence-end switch points (KTD-3). Decoupled from
// U1's derivation so these tests pin the planner, not the parser. `gap` is Infinity here
// because the planner only reads cueEnd/switchTime for segment ends.
function timing(
  boundaries: Array<[cueEnd: number, switchTime: number]>,
  spans: Array<[start: number, end: number]>,
): SentenceTiming {
  return {
    boundaries: boundaries.map(([cueEnd, switchTime]) => ({
      cueEnd,
      switchTime,
      gap: Infinity,
    })),
    dialogueSpans: spans.map(([start, end]) => ({ start, end })),
  }
}

function asPlan(
  result: ShowcaseHop[] | null | typeof HOP_TIMING_UNUSABLE,
): ShowcaseHop[] {
  if (result === null || result === HOP_TIMING_UNUSABLE) {
    throw new Error(`expected a hop plan, got ${String(result)}`)
  }
  return result
}

const segLen = (w: ExcerptWindow) => w.endSeconds - w.startSeconds

// ── KTD-1: sentence timing is strictly optional ─────────────────────

describe("buildHopSchedule — sentenceTiming is strictly optional (KTD-1)", () => {
  it("returns the fixed 10s grid, unchanged, when no sentenceTiming is supplied", () => {
    // Re-pins the pre-change offset behaviour: the no-timing overload is byte-identical.
    const hops = buildHopSchedule({
      dubs: centerpiece(3, { duration: 600 }),
      rng: zeroRng,
    })
    expect(hops?.[0]?.window).toEqual({ startSeconds: 90, endSeconds: 100 })
    expect((hops ?? []).map((h) => segLen(h.window))).toEqual([10, 10, 10, 10])
  })
})

// ── AE2: segments end at the padded sentence pause, not the 10s grid ──

describe("buildHopSchedule — sentence-aligned segments (AE2)", () => {
  it("ends a segment at the padded sentence pause instead of the 10s grid", () => {
    // Single dominant span → seed at 90. A sentence completes 13.4s in (cueEnd 103.4),
    // switch padded to 104.4: the first segment runs 14.4s, not 10s.
    const t = timing(
      [
        [103.4, 104.4],
        [118, 119],
        [132, 133],
        [146, 147],
      ],
      [[90, 210]],
    )
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(3, { duration: 600 }),
        rng: zeroRng,
        sentenceTiming: t,
      }),
    )
    expect(plan[0].languageSlug).toBe("english") // R8 opener preserved
    expect(plan[0].window).toEqual({ startSeconds: 90, endSeconds: 104.4 })
    expect(segLen(plan[0].window)).toBeCloseTo(14.4, 5)
    expect(plan[1].window.startSeconds).toBe(104.4) // R4 contiguity
  })
})

// ── AE4: a mid-plan ceiling cut lands on a cue edge, then plan continues ──

describe("buildHopSchedule — ceiling cut then continue (AE4)", () => {
  it("ceiling-cuts a mid-plan segment at the nearest cue edge and keeps going", () => {
    // seg1 aligns at 104.4; seg2 finds no boundary inside its 30s ceiling, so it cuts at
    // the nearest cue edge (132) — not the raw 134.4 ceiling — and seg3 catches 150.
    const t = timing(
      [
        [103.4, 104.4],
        [149, 150],
      ],
      [
        [90, 116],
        [118, 132],
        [136, 148],
      ],
    )
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(2, { duration: 600 }),
        rng: zeroRng,
        sentenceTiming: t,
      }),
    )
    expect(plan).toHaveLength(3)
    expect(plan[0].window.endSeconds).toBeCloseTo(104.4, 5) // sentence-aligned
    expect(plan[1].window.endSeconds).toBe(132) // ceiling cut at a cue edge
    expect(plan[2].window.endSeconds).toBeCloseTo(150, 5) // next real boundary
    expect(segLen(plan[1].window)).toBeGreaterThanOrEqual(10)
    expect(segLen(plan[1].window)).toBeLessThanOrEqual(30)
  })
})

// ── R3: ceiling cut with no boundary AND no cue edge in range ───────

describe("buildHopSchedule — ceiling cut with no cue edge (R3 null-edge fallback)", () => {
  it("cuts a boundary-and-edge-less mid-plan segment at exactly the 30s ceiling", () => {
    // One long merged span with no interior edge, and the next boundary far past the
    // ceiling: seg2 finds neither a boundary nor a cue edge in [minEnd, ceilingEnd], so it
    // stretches to MAX_HOP_SEGMENT_SECONDS — isolating the `?? ceilingEnd` fallback value
    // from both the edge-found cut (AE4) and the 10s floor.
    const t = timing(
      [
        [103.4, 104.4],
        [240, 241],
      ],
      [[90, 250]],
    )
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(3, { duration: 600 }),
        rng: zeroRng,
        sentenceTiming: t,
      }),
    )
    expect(plan[0].window.endSeconds).toBeCloseTo(104.4, 5) // sentence-aligned
    expect(plan[1].window.endSeconds).toBe(
      plan[1].window.startSeconds + MAX_HOP_SEGMENT_SECONDS,
    )
  })
})

// ── AE6: an unalignable first segment falls the whole chapter back ──

describe("buildHopSchedule — whole-chapter fallback (AE6/KTD-6)", () => {
  it("returns the unusable sentinel when the first segment cannot reach a sentence", () => {
    // The only boundary sits far past the first segment's 30s ceiling: the opener would
    // ceiling-cut, so the chapter falls back rather than playing ceiling-cut segments.
    const t = timing([[200, 201]], [[90, 300]])
    const result = buildHopSchedule({
      dubs: centerpiece(3, { duration: 600 }),
      rng: zeroRng,
      sentenceTiming: t,
    })
    expect(result).toBe(HOP_TIMING_UNUSABLE)
  })

  it("returns the unusable sentinel when the track has no boundaries at all", () => {
    const result = buildHopSchedule({
      dubs: centerpiece(3, { duration: 600 }),
      rng: zeroRng,
      sentenceTiming: {
        boundaries: [],
        dialogueSpans: [{ start: 90, end: 300 }],
      },
    })
    expect(result).toBe(HOP_TIMING_UNUSABLE)
  })
})

// ── R1/R4/R8: invariants over a sweep of counts and seeds ───────────

describe("buildHopSchedule — sentence-plan invariants over a sweep", () => {
  // Boundaries every ~12s across a long span → sentence-aligned ~12s segments.
  const boundaries: Array<[number, number]> = []
  for (let cueEnd = 100; cueEnd <= 400; cueEnd += 12) {
    boundaries.push([cueEnd, cueEnd + 1])
  }
  const t = timing(boundaries, [[90, 420]])

  it("stays english-first, contiguous, >=10s, and clear of the credits tail", () => {
    for (const other of [2, 4, 6, 8]) {
      for (const seed of [1, 2, 3]) {
        const result = buildHopSchedule({
          dubs: centerpiece(other, { duration: 600 }),
          rng: mulberry32(seed),
          sentenceTiming: t,
        })
        if (result === HOP_TIMING_UNUSABLE) continue
        const plan = asPlan(result)
        expect(plan.length).toBeGreaterThanOrEqual(2)
        expect(plan.length).toBeLessThanOrEqual(9)
        expect(plan[0].languageSlug).toBe("english")
        for (let i = 0; i < plan.length; i++) {
          expect(segLen(plan[i].window)).toBeGreaterThanOrEqual(10)
          if (i > 0) {
            expect(plan[i].window.startSeconds).toBe(
              plan[i - 1].window.endSeconds,
            )
          }
        }
        expect(plan[plan.length - 1].window.endSeconds).toBeLessThanOrEqual(595)
      }
    }
  })
})

// ── R5/KTD-4: the window seeds over the densest dialogue ────────────

describe("buildHopSchedule — window seeding (R5/KTD-4)", () => {
  it("seeds the window over the densest dialogue stretch, not the earliest chatter", () => {
    // Sparse chatter early, a dense 80s cluster at 180. The window opens on the cluster.
    const sparse: Array<[number, number]> = [
      [30, 33],
      [70, 73],
      [110, 113],
    ]
    const dense: Array<[number, number]> = [[180, 260]]
    const boundaries: Array<[number, number]> = []
    for (let c = 190; c <= 250; c += 12) boundaries.push([c, c + 1])
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(2, { duration: 600 }),
        rng: zeroRng,
        sentenceTiming: timing(boundaries, [...sparse, ...dense]),
      }),
    )
    expect(plan[0].window.startSeconds).toBe(180)
  })
})

// ── R8: short sources fit fewer segments, or fall back ──────────────

describe("buildHopSchedule — short sources (R8)", () => {
  it("fits fewer sentence-aligned segments when the source is short", () => {
    // 80s dub → credits-free 75s. Boundaries ~15s apart → only a handful of hops fit.
    const t = timing(
      [
        [25, 26],
        [42, 43],
        [60, 61],
        [90, 91],
      ],
      [[10, 75]],
    )
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(8, { duration: 80 }),
        rng: zeroRng,
        sentenceTiming: t,
      }),
    )
    expect(plan.length).toBeGreaterThanOrEqual(2)
    expect(plan.length).toBeLessThan(9)
    expect(plan[plan.length - 1].window.endSeconds).toBeLessThanOrEqual(75)
  })

  it("returns the unusable sentinel when fewer than two segments fit", () => {
    // 27s dub → credits-free 22s. One aligned segment reaches ~13s; no room for a second.
    const result = buildHopSchedule({
      dubs: centerpiece(8, { duration: 27 }),
      rng: zeroRng,
      sentenceTiming: timing([[12, 13]], [[1, 22]]),
    })
    expect(result).toBe(HOP_TIMING_UNUSABLE)
  })
})

// ── KTD-10: fractional sentence seams stay drift-safe ───────────────

describe("buildHopSchedule — sentence seams are drift-safe (KTD-10)", () => {
  it("keeps every fractional segment >=10s and arming the fade at every phase offset", () => {
    // Switch times at x.3 / x.7 — the plan must not round a segment under 10s, and each
    // seam must still arm before its end under Android's over-1s drifting clock.
    const t = timing(
      [
        [102.3, 103.3],
        [116.7, 117.7],
        [131.3, 132.3],
        [147.7, 148.7],
      ],
      [[90, 210]],
    )
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(4, { duration: 600 }),
        rng: mulberry32(3),
        sentenceTiming: t,
      }),
    )
    for (const h of plan) {
      const w = h.window
      expect(segLen(w)).toBeGreaterThanOrEqual(10)
      for (const period of [1.01, 1.05, 1.2]) {
        for (let phase = 0; phase < period; phase += 0.05) {
          let firstArmRemaining: number | null = null
          for (
            let time = w.startSeconds + phase;
            time <= w.endSeconds + period;
            time += period
          ) {
            if (
              firstArmRemaining == null &&
              shouldArmFadeOut({ currentTime: time, window: w })
            ) {
              firstArmRemaining = w.endSeconds - time
            }
            if (time >= w.endSeconds) break
          }
          expect(firstArmRemaining).not.toBeNull()
          expect(firstArmRemaining!).toBeGreaterThan(0)
          expect(firstArmRemaining!).toBeLessThanOrEqual(
            AUDIO_FADE_OUT_ARM_SECONDS,
          )
          expect(
            fadeOutVolumeAt({ remainingSeconds: firstArmRemaining! }),
          ).toBeGreaterThan(0)
        }
      }
    }
  })
})

// ── AE1: real reference track, derived then planned (U1→U2 seam) ────

describe("buildHopSchedule — real reference track integration (AE1)", () => {
  // First six cues of the production Birth of Jesus English track, carrying both real
  // silences (00:11.63→00:18.55 and 00:32.28→00:44.98).
  const cue = (start: number, end: number, text: string): VttCue => ({
    start,
    end,
    text,
  })
  const REAL_CUES: VttCue[] = [
    cue(
      1.23,
      6.63,
      "an orderly account of the things that have taken place among us,",
    ),
    cue(
      6.69,
      11.63,
      "so that you may know the absolute truth about everything.",
    ),
    cue(18.55, 24.44, "when Herod the Great was king of Judea,"),
    cue(24.49, 32.28, "And the virgin's name was Mary."),
    cue(44.98, 49.97, "Fear not Mary, for you have found favor with God."),
    cue(50.04, 56.66, 'you will call His name "Jesus."'),
  ]

  it("seeds over real dialogue and never emits a wholly-silent segment", () => {
    const t = deriveSentenceTiming(REAL_CUES)
    const plan = asPlan(
      buildHopSchedule({
        dubs: centerpiece(5, { duration: 62 }),
        rng: mulberry32(2),
        sentenceTiming: t,
      }),
    )
    const speechIn = (w: ExcerptWindow) =>
      t.dialogueSpans.reduce(
        (sum, s) =>
          sum +
          Math.max(
            0,
            Math.min(s.end, w.endSeconds) - Math.max(s.start, w.startSeconds),
          ),
        0,
      )
    // The whole point of the chapter: every segment carries audible speech.
    for (const h of plan) expect(speechIn(h.window)).toBeGreaterThan(0)
    // The opener lands on a real dialogue-span start, not mid-silence.
    expect(
      t.dialogueSpans.some((s) => s.start === plan[0].window.startSeconds),
    ).toBe(true)
  })
})
