import { readFile } from "node:fs/promises"
import path from "node:path"

import type { GeneratedDevotional } from "./generate-devotional"
import type { VideoSource } from "./video-sources"

/** The cue texts of a source's checked-in caption file, in order. */
export async function readSubtitles(
  source: VideoSource,
  lang: "en" | "ru" | "es" = "en",
): Promise<string[]> {
  if (source.captions.kind !== "file") return []
  const file =
    lang === "en" ? source.captions.path : source.captions.byLang?.[lang]
  if (!file) return []
  const vtt = await readFile(path.join(import.meta.dirname, file), "utf8")
  return vtt
    .split(/\n\s*\n/)
    .map((b) => b.split("\n"))
    .filter((l) => l.some((x) => x.includes("-->")))
    .map((l) =>
      l
        .slice(l.findIndex((x) => x.includes("-->")) + 1)
        .join(" ")
        .trim(),
    )
}

/**
 * The owner's script sheet (the Vineyard layout, 2026-09): opening, the film
 * with the full passage its subtitles carry, the steps, every reflection
 * paragraph tagged with its kind, voice and on-screen credit, the ending, and
 * the list of credits. Plain text, for reading and marking up.
 */

const RULE = "-".repeat(60)

/** Hard-wrap width; 0 leaves lines whole (for a word processor, which wraps
 *  them itself). Set per call of formatDevotionalScript. */
let WRAP = 80

function wrap(text: string, width = 80, indent = ""): string {
  if (WRAP === 0) return indent + text.split(/\s+/).filter(Boolean).join(" ")
  width = Math.min(width, WRAP)
  const out: string[] = []
  let line = ""
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > width - indent.length) {
      out.push(indent + line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  if (line) out.push(indent + line)
  return out.join("\n")
}

const section = (n: number, title: string) => [RULE, `${n}. ${title}`, RULE, ""]

const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`

export function formatDevotionalScript(input: {
  devo: GeneratedDevotional
  source: VideoSource
  /** The film's subtitles, cue by cue: the narration as spoken, which is
   *  not the BSB (LUMO reads the NIV). */
  subtitles: string[]
  classicCredit: string
  reflectLeadIn: string
  prayLeadIn: string
  /** 0 for no hard wrapping (the .rtf copy). */
  wrapWidth?: number
  /** The montage opening speaks no welcome (only its lines, then
   *  "Let's watch."). */
  montage?: boolean
  /** A localized cut: its spoken "Let's watch" and the translation the film
   *  reads (defaults: English, NIV). */
  watchLine?: string
  askLabel?: string
  prayLabel?: string
  filmTranslation?: string
}): string {
  WRAP = input.wrapWidth ?? 80
  const { devo: d, source: s } = input
  const paragraphs = d.reflection.paragraphs ?? []
  const voiceTag = (v?: string) => (v === d.voice ? "voice A" : "voice B")
  const kind = (r?: string) =>
    r === "history"
      ? "HISTORY"
      : r === "language"
        ? "LANGUAGE"
        : r === "classic"
          ? "COMMENTARY"
          : "REFLECTION"
  const marks = paragraphs.filter((p) => p.mark)
  const winEnd = s.window.startSec + s.window.lengthSec
  return [
    `${s.title.toUpperCase()}  |  Daily Bible Pause  |  clip-first`,
    `${d.passage.reference}  |  Scripture: ${d.scripture.translation === "BSB" ? "Berean Standard Bible" : d.scripture.translation}`,
    `Reflection adapted from ${input.classicCredit}, with the notes credited below`,
    "",
    `Film: LUMO, Arclight id ${s.mediaComponentId}. The scene runs ${mmss(s.window.startSec)} - ${mmss(winEnd)}.`,
    `Title: ${d.title}`,
    "",
    ...section(1, "OPENING"),
    ...(input.montage
      ? ["[spoken over the film's shots, one line per shot]", ""]
      : ["[spoken only]  Welcome to Daily Bible Pause.", ""]),
    ...(d.openingLines?.length
      ? d.openingLines.flatMap((l) => [l, ""])
      : ["(no opening lines yet)", ""]),
    `[spoken only, as WATCH appears across the frame]  ${input.watchLine ?? "Let's watch."}`,
    "",
    ...section(
      2,
      `VIDEO CLIP  (LUMO ${mmss(s.window.startSec)} - ${mmss(winEnd)}, film sound, subtitles carry the text)`,
    ),
    `SUBTITLES  (${d.passage.reference}, as the film's narrator reads it: ${input.filmTranslation ?? "NIV"})`,
    "",
    // One numbered block per cue, exactly as it will be on screen.
    // One numbered block per cue, exactly as it will be on screen, with air
    // between them (owner, 2026-09-29: a wall of text is hard to read).
    ...input.subtitles.flatMap((c, i) => {
      const n = String(i + 1).padStart(2, " ")
      return [wrap(c, 76, "      ").replace(/^ {6}/, `  ${n}  `), ""]
    }),
    "",
    ...section(3, "STEP  WATCH -> REFLECT"),
    `Voice:  ${input.reflectLeadIn}`,
    "",
    ...section(4, "REFLECTION"),
    "  voice A = female (the reflection's own voice)",
    "  voice B = male (history and language)",
    "A `mark:` tag means the source strip appears on THAT paragraph.",
    "",
    ...paragraphs.flatMap((p) => [
      `[${kind(p.role)} · ${voiceTag(p.voice)}${p.mark ? ` · mark: ${p.mark.label.toUpperCase()} / ${p.mark.source}` : ""}]`,
      wrap(p.text),
      "",
      "",
    ]),
    "TAKEAWAY",
    d.conclusion,
    "",
    `SCRIPTURE  (${d.scripture.reference}, ${d.scripture.translation === "BSB" ? "BSB" : d.scripture.translation})`,
    wrap(`“${d.scripture.text.replace(/[’”]\s*$/, "")}”`),
    "",
    ...section(5, "STEP  REFLECT -> PRAY"),
    `Voice:  ${input.prayLeadIn}`,
    "",
    ...section(6, "QUESTION AND PRAYER"),
    (input.askLabel ?? "First, ask yourself").toUpperCase(),
    wrap(d.question),
    "",
    (input.prayLabel ?? "Talk to God about it").toUpperCase(),
    wrap(d.prayer),
    "",
    ...section(
      7,
      `ON-SCREEN SOURCE MARKS  (${marks.length} for the whole video)`,
    ),
    ...marks.flatMap((p, i) => [
      `${i + 1}. ${p.mark!.label.toUpperCase()}   (${p.mark!.portrait === "ryle" ? "portrait" : p.mark!.portrait === "scroll" ? "scroll" : "open book"})`,
      `   ${p.mark!.source}`,
      `   (on "${p.text.split(/(?<=[.!?])\s/)[0]}")`,
      "",
    ]),
  ].join("\n")
}
