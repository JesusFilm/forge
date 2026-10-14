import { Easing, interpolate, interpolateColors } from "remotion"

import type { DevotionalCard } from "./schema"
import type { CardFrames } from "./timing"

/**
 * The verse an original-language note is about, at the top of the 16:9 frame
 * with the one word it turns on lit in gold (owner's Figma "Reflection card ·
 * Greek", 2026-09-30): the listener sees where the word sits while the voice
 * explains it. Drawn once across all the consecutive cards that carry the
 * same verse, so it does not blink with each sentence.
 *
 * Figma numbers on a 1920x1080 frame: italic serif 56px, 1.25 line height,
 * 753px measure, top 284; the word bold italic #F2C46B.
 */
const EASE = Easing.bezier(0.4, 0, 0.2, 1)
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const GOLD = "#F2C46B"
const REST = "rgba(255,255,255,0.92)"

/** The callout must end above the reflection's own subtitles (1080 frame:
 *  a two-line caption starts near y 700; measured on the Widow RU draft). A long verse first widens, then shrinks, instead
 *  of running into them (owner, 2026-10-14, Luke 18:7 RU over the captions). */
const TOP = 284
const BOTTOM = 620
const WIDTHS = [753, 960, 1180, 1400]
const SIZES = [56, 52, 48, 44, 40]
const LINE = 1.25
/** A lit phrase is set on one line (it is an inline block with its rule);
 *  longer than this it would force its own line, so it is not lit. */
const MAX_LIT_CHARS = 24

function fit(text: string): { width: number; size: number } {
  // Estimated, not measured: the DOM probe sets the upright face, and the
  // light italic Cyrillic runs ~0.66 em a character (6 lines where the probe
  // counted 4, Widow RU 2026-10-14). +10% for the slack of a greedy wrap.
  const em = /[А-Яа-яЁё]/.test(text) ? 0.66 : 0.56
  for (const size of SIZES)
    for (const width of WIDTHS) {
      const lines = Math.ceil((text.length * em * size * 1.1) / width)
      if (lines * size * LINE <= BOTTOM - TOP) return { width, size }
    }
  return { width: WIDTHS[WIDTHS.length - 1]!, size: SIZES[SIZES.length - 1]! }
}

/** A verse lifted out of a speech keeps its closing quote mark; drop an
 *  unmatched one so the callout does not end on a stray mark. */
function standalone(v: string) {
  const opens = (v.match(/[‘“]/g) ?? []).length
  const closes = (v.match(/[’”]/g) ?? []).length
  let out = v.trim()
  for (let k = closes - opens; k > 0; k--)
    out = out.replace(/[’”](?=[^’”]*$)/, "")
  // A verse that already opens and closes on its own quotes ("“Martha,
  // Martha,” the Lord replied, “you are…”") would come out doubled inside
  // the callout's own pair.
  if (/^[“‘]/.test(out) && /[”’]$/.test(out)) out = out.slice(1, -1)
  return out
}

export function VerseCalloutOverlay({
  cards,
  frames,
  frame,
  fps,
  px,
  serif,
}: {
  cards: ReadonlyArray<DevotionalCard>
  frames: ReadonlyArray<CardFrames>
  frame: number
  fps: number
  px: (n: number) => number
  serif: string
}) {
  const u = (n: number) => px((n * 390) / 1080)
  for (let j = 0; j < cards.length; j++) {
    const c = cards[j].verseCallout
    if (!c || cards[j - 1]?.verseCallout?.text === c.text) continue
    let k = j
    while (cards[k + 1]?.verseCallout?.text === c.text) k++
    const start = frames[j].from
    const end = frames[k].from + frames[k].durationInFrames
    if (frame < start || frame >= end) continue
    const t = (frame - start) / fps
    const dur = (end - start) / fps
    const fade = (a: number, b: number) =>
      interpolate(t, [a, b], [0, 1], { ...clamp, easing: EASE })
    const opacity = fade(0.1, 0.9) * (1 - fade(dur - 0.7, dur - 0.1))
    const lit = fade(0.9, 1.6)
    // Once lit, the word breathes: a soft gold glow that swells and fades on
    // a slow ~1.8s cycle, visible but never blinking (owner, 2026-10-08).
    const breath = 0.5 - 0.5 * Math.cos(((t - 1.6) / 1.8) * 2 * Math.PI)
    const glow = lit * (t > 1.6 ? 0.35 + 0.65 * breath : 0.35 * lit)
    const text = standalone(c.text)
    const lit_ = c.highlight && c.highlight.length <= MAX_LIT_CHARS
    const at = lit_
      ? text.toLowerCase().search(
          // Letter boundaries of any script: `\b` and `[a-z]` are ASCII-only
          // and silently lost the Russian «спасла» (2026-10-06).
          new RegExp(
            `(?<!\\p{L})${c.highlight.toLowerCase().replace(/[^\p{L}' ]/gu, "")}(?!\\p{L})`,
            "u",
          ),
        )
      : -1
    const word =
      at >= 0 && c.highlight ? text.slice(at, at + c.highlight.length) : ""
    // Russian takes guillemets, English curly quotes.
    const cyrillic = /[А-Яа-яЁё]/.test(text)
    const [open, close] = cyrillic ? ["«", "»"] : ["“", "”"]
    const box = fit(`${open}${text}${close}`)
    return (
      <div
        style={{
          position: "absolute",
          top: u(TOP),
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          opacity,
          transform: `translateY(${(u(10) * (1 - fade(0.1, 0.9))).toFixed(2)}px)`,
        }}
      >
        <p
          style={{
            margin: 0,
            width: u(box.width),
            textAlign: "center",
            fontFamily: serif,
            fontStyle: "italic",
            // Lighter than the Figma frame's regular (owner, 2026-09-30:
            // too bold on the picture), the word a step above it.
            fontWeight: 300,
            fontSize: u(box.size),
            lineHeight: LINE,
            color: REST,
            textShadow: "0 2px 18px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.6)",
          }}
        >
          {open}
          {at >= 0 ? (
            <>
              {text.slice(0, at)}
              {/* The word turns white and a gold rule is drawn under it,
                  left to right, as the voice reaches it; then the rule
                  breathes a soft glow (owner's Figma variant B, 2026-10-08:
                  5px at 56px type, square ends, tilted 0.8°). */}
              <span
                style={{
                  position: "relative",
                  display: "inline-block",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                  color: interpolateColors(lit, [0, 1], [REST, "#ffffff"]),
                }}
              >
                {word}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: -u(4),
                    top: "100%",
                    marginTop: -u(4),
                    height: u(5),
                    background: GOLD,
                    transformOrigin: "left center",
                    transform: `rotate(-0.8deg) scaleX(${lit.toFixed(4)})`,
                    boxShadow: `0 0 ${u(6 + 12 * glow).toFixed(1)}px rgba(242,196,107,${(0.2 + 0.45 * glow).toFixed(3)})`,
                  }}
                />
              </span>
              {text.slice(at + word.length)}
            </>
          ) : (
            text
          )}
          {close}
        </p>
      </div>
    )
  }
  return null
}
