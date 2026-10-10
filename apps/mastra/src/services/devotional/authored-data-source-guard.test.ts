import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const runtimeFiles = [
  "reflection-corpus.ts",
  "web-bible.ts",
  "jesus-film-catalog.ts",
  "jesus-film-passages.ts",
  "hook-picker.ts",
  "passage-scripture.ts",
  "reflection-modernizer.ts",
  "reflection-highlighter.ts",
  "spurgeon-ranker.ts",
  "devotional-copy.ts",
  "devotional-writer.ts",
  "safety-gate.ts",
  "voice-rotation.ts",
  "elevenlabs-voiceover.ts",
  "elevenlabs-music.ts",
  "devotional-audio.ts",
  "local-video-matcher.ts",
]

describe("devotional authored-data source guard", () => {
  it("keeps corpora, catalog values, prompts, profiles, and connectors out of runtime modules", () => {
    const source = runtimeFiles
      .map((file) =>
        readFileSync(path.resolve("src/services/devotional", file), "utf8"),
      )
      .join("\n")

    for (const forbidden of [
      "DEVOTIONAL_CORPUS_DIR",
      "readFileSync",
      "repoRoot",
      "HKFOb9iktHA85uKXydRT",
      "xLeLcqgjUx3wQJFSESKj",
      "WonySogMOJVSOnlOGFQh",
      'title: "The Beginning"',
      'title: "Christmas Day"',
      "Calm worshipful ambient",
      "You write copy for a short vertical devotional video",
      "Today's devotional: {{hook}}",
    ]) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })

  it("keeps render labels and palettes out of composition code", () => {
    const source = readFileSync(
      path.resolve(
        "../../packages/shorts-compositions/src/devotional/styles.ts",
      ),
      "utf8",
    )
    expect(source).not.toContain("#14110c")
    expect(source).not.toContain('label: "Grain"')
    expect(source).not.toContain("radial-gradient")
  })
})
