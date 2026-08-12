import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * Deterministic Russian stress dictionary — the AUTHORITATIVE stress layer.
 *
 * Backed by a compact finite-state automaton of 2,039,133 accented Russian words
 * (public-domain data from github.com/zdarsch/russian-stress-marker, bundled at
 * data/ru-stress.fsa). For a word with ONE stress pattern it returns that pattern
 * with certainty — it gets cases even a 5-model LLM ensemble misses (на́брано).
 * A HOMOGRAPH (сто́ит vs стои́т, за́мок vs замо́к) returns MULTIPLE forms, and an
 * unknown word returns none — both signal "ask the context-aware consensus".
 *
 * FSA format (per the source's content.js): a Uint32Array of edges; each edge
 * packs label = edge>>>24, next-node = (edge&0xffffff)>>>2, bit1 = word-final,
 * bit2 = last-edge-of-node. Stress in the source is marked with "'" (primary)
 * or "`" (secondary) right after the vowel; we emit combining acute U+0301 for
 * primary stress and drop secondary.
 */

const ACUTE = "́" // U+0301 combining acute

const fsa = (() => {
  const buf = readFileSync(
    fileURLToPath(new URL("./data/ru-stress.fsa", import.meta.url)),
  )
  return new Uint32Array(
    buf.buffer,
    buf.byteOffset,
    Math.floor(buf.byteLength / 4),
  )
})()

// Cyrillic charcode → internal byte (W), stress-label → base byte (E), and
// stress-label → output string with an apostrophe/grave mark (A).
const W = new Map<number, number>()
W.set(1025, 168)
W.set(1105, 184)
for (let i = 1040; i < 1104; i++) W.set(i, i - 848)

const E = new Map<number, number>()
for (let i = 0; i < 256; i++) E.set(i, i)
for (const [k, v] of [
  [129, 224], [131, 229], [140, 232], [144, 224], [154, 229], [156, 238],
  [157, 232], [158, 238], [159, 243], [161, 243], [165, 251], [178, 251],
  [179, 253], [184, 229], [186, 254], [188, 253], [189, 254], [190, 255],
  [191, 255],
] as const)
  E.set(k, v)

const A = new Map<number, string>()
A.set(184, String.fromCharCode(1105)) // ё
for (let i = 224; i < 256; i++) A.set(i, String.fromCharCode(i + 848))
for (const [k, v] of [
  [129, "а`"], [131, "е`"], [140, "и`"], [144, "а'"], [154, "е'"], [156, "о`"],
  [157, "и'"], [158, "о'"], [159, "у'"], [161, "у`"], [165, "ы`"], [178, "ы'"],
  [179, "э'"], [186, "ю'"], [188, "э`"], [189, "ю`"], [190, "я`"], [191, "я'"],
] as const)
  A.set(k, v as string)

function nodeEdges(j: number): number[] {
  const result: number[] = []
  while (j < fsa.length) {
    result.push(fsa[j])
    if (fsa[j] & 2) break
    j++
  }
  return result
}

/** Raw accented forms (marks as "'" / "`") for a lowercase word. */
function lookupRaw(word: string): string[] {
  const reps: string[] = []
  const candidate: string[] = []
  const dfs = (j: number, i: number): void => {
    for (const edge of nodeEdges(j)) {
      const label = edge >>> 24
      const k = (edge & 0xffffff) >>> 2
      const ch = word[i]
      if (ch === undefined) continue
      if (E.get(label) === W.get(ch.charCodeAt(0))) {
        candidate[i] = A.get(label) ?? ch
        if (i === word.length - 1 && edge & 1) {
          reps.push(candidate.slice(0, i + 1).join(""))
        } else if (k < fsa.length) {
          dfs(k, i + 1)
        }
      }
    }
  }
  dfs(0, 0)
  return reps
}

/** Convert a raw form ("на'брано") to combining-acute ("на́брано"); drop secondary. */
function toAcute(raw: string): string {
  return raw.replace(/'/g, ACUTE).replace(/`/g, "")
}

const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()

/**
 * The unambiguous stressed form of `word`, or null when the dictionary is not
 * authoritative — a homograph (>1 pattern) or an unknown word. Preserves the
 * original word's leading capitalization.
 */
export function stressWord(word: string): string | null {
  const lower = word.toLowerCase()
  const forms = Array.from(new Set(lookupRaw(lower).map(toAcute)))
  if (forms.length !== 1) return null
  let out = forms[0]
  if (word.length > 0 && isUpper(word[0])) {
    out = out[0].toUpperCase() + out.slice(1)
  }
  return out
}

/** True when the dictionary knows a word (single or multiple patterns). */
export function isKnown(word: string): boolean {
  return lookupRaw(word.toLowerCase()).length > 0
}
