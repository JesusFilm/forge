import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  audioReuseKey,
  loadCachedAudio,
  loadReusableAudio,
  saveCachedAudio,
} from "./devotional-cache"
import { DEVOTIONAL_VOICES } from "./elevenlabs-voiceover"

/**
 * Per-segment narration reuse is the highest-consequence cache in the
 * pipeline: a wrong hit means the viewer HEARS one sentence while READING
 * another, and nothing in the output reveals it. It shipped with no tests.
 *
 * The reuse key deliberately excludes the segment INDEX (inserting a sentence
 * renumbers every `reflection-N` after it, which would needlessly invalidate
 * identical words) but keeps the ROLE, because role changes delivery — the
 * first reflection card carries a spoken connector and the last is paced
 * slower, so the same words in a different role are genuinely different audio.
 * Both halves of that decision are pinned below.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "devo-cache-test-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

const MALE_D = DEVOTIONAL_VOICES["male-d"]
const RUSSIAN = DEVOTIONAL_VOICES.russian

function segment(id: string, text: string, voiceId: string = MALE_D) {
  return {
    id,
    text,
    audio: {
      format: "mp3" as const,
      bytes: new Uint8Array([1, 2, 3]),
      voiceId,
      model: "eleven_multilingual_v2",
      characterCount: text.length,
    },
  }
}

function produced(
  segments: ReturnType<typeof segment>[],
  skipped: string[] = [],
) {
  return {
    voice: "male-d" as const,
    segments,
    music: null,
    skipped,
    reused: [],
    failures: skipped.map((id) => ({
      id,
      reason: "upstream_failed",
      retryable: true,
    })),
  }
}

describe("audioReuseKey", () => {
  it("ignores the segment index — identical words keep their key when renumbered", () => {
    // The whole point: inserting a sentence early must not invalidate the
    // narration of every later sentence.
    expect(audioReuseKey("reflection-mid", "He stopped.", "male-d")).toBe(
      audioReuseKey("reflection-mid", "He stopped.", "male-d"),
    )
  })

  it("separates identical words in DIFFERENT roles", () => {
    // `reflection-first` carries a spoken connector and `reflection-last` is
    // paced slower, so reusing one as the other would play the wrong take.
    expect(audioReuseKey("reflection-first", "He stopped.", "male-d")).not.toBe(
      audioReuseKey("reflection-last", "He stopped.", "male-d"),
    )
  })

  it("separates identical words in different voices", () => {
    expect(audioReuseKey("reflection-mid", "He stopped.", "male-d")).not.toBe(
      audioReuseKey("reflection-mid", "He stopped.", "russian"),
    )
  })

  it("separates DIFFERENT words in the same role", () => {
    expect(audioReuseKey("reflection-mid", "He stopped.", "male-d")).not.toBe(
      audioReuseKey("reflection-mid", "He waited.", "male-d"),
    )
  })

  it("treats surrounding whitespace as insignificant", () => {
    expect(audioReuseKey("cover", "  He stopped. ", "male-d")).toBe(
      audioReuseKey("cover", "He stopped.", "male-d"),
    )
  })
})

describe("loadReusableAudio", () => {
  it("returns an empty map when nothing is cached", async () => {
    expect((await loadReusableAudio(dir, "male-d")).size).toBe(0)
  })

  it("keys reflection segments by first / mid / last role", async () => {
    await saveCachedAudio(
      dir,
      produced([
        segment("cover", "Cover line."),
        segment("reflection-1", "First sentence."),
        segment("reflection-2", "Middle sentence."),
        segment("reflection-3", "Last sentence."),
      ]),
    )
    const reusable = await loadReusableAudio(dir, "male-d")
    expect(
      reusable.has(audioReuseKey("reflection-first", "First sentence.", "male-d")),
    ).toBe(true)
    expect(
      reusable.has(audioReuseKey("reflection-mid", "Middle sentence.", "male-d")),
    ).toBe(true)
    expect(
      reusable.has(audioReuseKey("reflection-last", "Last sentence.", "male-d")),
    ).toBe(true)
    // Non-reflection segments keep their own id as the role.
    expect(reusable.has(audioReuseKey("cover", "Cover line.", "male-d"))).toBe(
      true,
    )
  })

  it("does NOT offer a first-role take under the last role, even for identical words", async () => {
    // The duplicate-sentence trap: the same words open and close the reflection.
    // A key that ignored role would collapse them and play the connector-bearing
    // opening take as the slowed closing line.
    await saveCachedAudio(
      dir,
      produced([
        segment("reflection-1", "Grace finds you."),
        segment("reflection-2", "Something else."),
        segment("reflection-3", "Grace finds you."),
      ]),
    )
    const reusable = await loadReusableAudio(dir, "male-d")
    const first = reusable.get(
      audioReuseKey("reflection-first", "Grace finds you.", "male-d"),
    )
    const last = reusable.get(
      audioReuseKey("reflection-last", "Grace finds you.", "male-d"),
    )
    expect(first?.id).toBe("reflection-1")
    expect(last?.id).toBe("reflection-3")
  })

  it("DROPS segments synthesized by a different voice", async () => {
    // The wrong-voice trap. The key's voice component is the voice we ASKED
    // for; the bytes on disk belong to whoever ran last. Without comparing the
    // stored voiceId, a `--voice=` audition silently replays the old voice.
    await saveCachedAudio(
      dir,
      produced([
        segment("cover", "Cover line.", RUSSIAN),
        segment("reflection-1", "First sentence.", RUSSIAN),
      ]),
    )
    const reusable = await loadReusableAudio(dir, "male-d")
    expect(reusable.size).toBe(0)
  })

  it("keeps only the segments matching the requested voice in a mixed cache", async () => {
    await saveCachedAudio(
      dir,
      produced([
        segment("cover", "Cover line.", MALE_D),
        segment("reflection-1", "Stale take.", RUSSIAN),
      ]),
    )
    const reusable = await loadReusableAudio(dir, "male-d")
    expect([...reusable.values()].map((s) => s.id)).toEqual(["cover"])
  })

  it("derives roles over the USABLE set, so a dropped segment cannot shift them", async () => {
    // reflection-1 belongs to another voice, so on this run reflection-2 is the
    // FIRST usable reflection and must be keyed as such.
    await saveCachedAudio(
      dir,
      produced([
        segment("reflection-1", "Other voice.", RUSSIAN),
        segment("reflection-2", "Now the opener.", MALE_D),
        segment("reflection-3", "Now the closer.", MALE_D),
      ]),
    )
    const reusable = await loadReusableAudio(dir, "male-d")
    expect(
      reusable.get(
        audioReuseKey("reflection-first", "Now the opener.", "male-d"),
      )?.id,
    ).toBe("reflection-2")
    expect(
      reusable.get(
        audioReuseKey("reflection-last", "Now the closer.", "male-d"),
      )?.id,
    ).toBe("reflection-3")
  })
})

describe("saveCachedAudio / loadCachedAudio round-trip", () => {
  it("persists `skipped` so an incomplete cache cannot read back as complete", async () => {
    // This was hardcoded to [] on load, which made ANY cached audio look
    // complete — so an incomplete run that reached the cache passed the
    // completeness guard on every later render, permanently.
    await saveCachedAudio(
      dir,
      produced([segment("cover", "Cover line.")], ["conclusion", "questions"]),
    )
    const loaded = await loadCachedAudio(dir, "male-d")
    expect(loaded?.skipped).toEqual(["conclusion", "questions"])
  })

  it("reports no skips for a cache written before the field existed", async () => {
    // Backward compatibility: absent means "none reported", which is the honest
    // reading — we cannot know retroactively.
    await saveCachedAudio(dir, produced([segment("cover", "Cover line.")]))
    const indexPath = path.join(dir, "audio", "index.json")
    const index = JSON.parse(await readFile(indexPath, "utf8"))
    delete index.skipped
    await writeFile(indexPath, JSON.stringify(index))
    const loaded = await loadCachedAudio(dir, "male-d")
    expect(loaded?.skipped).toEqual([])
  })

  it("preserves each segment's own voiceId rather than stamping the requested voice", async () => {
    await saveCachedAudio(
      dir,
      produced([segment("cover", "Cover line.", RUSSIAN)]),
    )
    const loaded = await loadCachedAudio(dir, "male-d")
    expect(loaded?.segments[0].audio.voiceId).toBe(RUSSIAN)
  })
})
