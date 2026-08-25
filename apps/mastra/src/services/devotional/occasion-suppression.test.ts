import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { buildNarrationSegments } from "./devotional-audio"
import type { GeneratedDevotional } from "./generate-devotional"

/**
 * A fixed-date occasion ("Today is also World Humanitarian Day") reaches the
 * screen by THREE separate routes: the narration builds it, the manifest puts
 * it on the cover card, and the review print builds its own copy. Suppressing
 * it took three attempts because each fix covered one route and the next
 * render still showed — or said — the holiday.
 *
 * The behavioural test pins what a viewer gets; the structural test makes a
 * fourth route impossible to add silently.
 */
const DEVO: GeneratedDevotional = {
  date: "2026-08-19", // World Humanitarian Day
  clip: { index: 33, id: "1_jf6133-0-0", title: "Jesus and Zaccheus" },
  passage: { reference: "Luke 19:1-10", osisRef: "Luke.19.1-Luke.19.10" },
  title: "Jesus stopped for the man everyone despised.",
  scripture: {
    reference: "Luke 19:10",
    text: "For the Son of Man came to seek and to save that which was lost.",
    translation: "WEB",
    needsCanonicalSource: false,
  },
  reflection: {
    text: "Grace moved first.",
    source: "J.C. Ryle",
    attribution: "Adapted from a trusted classic",
    flavor: "commentary",
  },
  reflectionHighlights: [],
  conclusion: "Grace finds you first.",
  question: "Where do you need to remember that?",
  prayer: "Ask him to show you.",
  mood: "hope",
  voice: "male-d",
  sequence: 0,
}

describe("occasion suppression", () => {
  it("speaks the occasion by default — the daily site edition wants it", () => {
    const cover = buildNarrationSegments(DEVO).find((s) => s.id === "cover")
    expect(cover?.text).toMatch(/World Humanitarian Day/)
  })

  it("leaves it unspoken when suppressed", () => {
    const cover = buildNarrationSegments(DEVO, undefined, {
      suppressOccasion: true,
    }).find((s) => s.id === "cover")
    expect(cover?.text).not.toMatch(/World Humanitarian Day/)
    // The hook and the settle line must survive — only the holiday goes.
    expect(cover?.text).toContain(DEVO.title)
    expect(cover?.text).toMatch(/Let's /)
  })

  it("changes nothing on a date with no occasion", () => {
    const plain = { ...DEVO, date: "2026-08-18" }
    expect(buildNarrationSegments(plain)[0].text).toBe(
      buildNarrationSegments(plain, undefined, { suppressOccasion: true })[0]
        .text,
    )
  })
})

describe("every route that reads the occasion honours the switch", () => {
  it("no call site builds narration segments without passing the option", async () => {
    // Three call sites existed; two were missed, and each miss shipped a video
    // that still named the holiday. A new one must not be able to hide.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const files = (await readdir(here)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )
    const offenders: string[] = []
    for (const f of files) {
      const src = await readFile(path.join(here, f), "utf8")
      // A call with a closing paren right after the locale argument passes no
      // options object. The declaration itself is skipped.
      for (const m of src.matchAll(/buildNarrationSegments\(([^)]*)\)/g)) {
        const args = m[1]
        if (args.includes("d: GeneratedDevotional")) continue // declaration
        if (!args.includes("suppressOccasion")) offenders.push(`${f}: ${m[0]}`)
      }
    }
    expect(
      offenders,
      "These build narration without threading suppressOccasion, so a social " +
        "cut will still name today's holiday:",
    ).toEqual([])
  })
})
