import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion"

/**
 * The social opening the owner's colleague cut by hand, rebuilt in the series'
 * own type: one line of the reflection written across the film, then the three
 * questions this series asks of every passage, then "Let's watch" and the film.
 *
 * Each beat moves from its own direction (owner): the first half of the
 * quotation wipes in from the left, the second from the right and set a little
 * lower and further in, so the sentence reads as two thoughts rather than one
 * block; the questions drop in from above, quickly, one after another, and
 * drift on their own while they hold — the picture moves, and text that sits
 * perfectly still on top of moving film looks pasted on.
 */

const GOLD = "#f2c46b"
const ease = Easing.bezier(0.22, 1, 0.36, 1)

export type QuoteIntroProps = {
  quoteA: string
  quoteAStrong?: string
  quoteB: string
  quoteBStrong?: string
  questions: ReadonlyArray<string>
  watchLabel: string
  px: (n: number) => number
  fps: number
  /** Card length in seconds — the beats are laid out against it. */
  durationSec: number
  serif: string
  sans: string
}

/** Splits a line so the phrase carrying the weight can be set apart. */
function withStrong(
  line: string,
  strong: string | undefined,
  strongStyle: React.CSSProperties,
) {
  if (!strong) return line
  const at = line.toLowerCase().indexOf(strong.toLowerCase())
  if (at < 0) return line
  return (
    <>
      {line.slice(0, at)}
      <span style={strongStyle}>{line.slice(at, at + strong.length)}</span>
      {line.slice(at + strong.length)}
    </>
  )
}

export function QuoteIntro({
  quoteA,
  quoteAStrong,
  quoteB,
  quoteBStrong,
  questions,
  watchLabel,
  px,
  fps,
  durationSec,
  serif,
  sans,
}: QuoteIntroProps) {
  const frame = useCurrentFrame()
  const t = frame / fps
  // The beats, as shares of the card: quotation, questions, the invitation.
  const qOut = durationSec - 6.6
  const listIn = durationSec - 6.2
  const listOut = durationSec - 2.1
  const watchIn = durationSec - 1.8

  // Wipe: the line is revealed edge to edge, and slides a few px with it.
  const wipe = (from: number, dir: "left" | "right") => {
    const p = interpolate(t, [from, from + 0.42], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: ease,
    })
    const hidden = (1 - p) * 100
    return {
      clipPath:
        dir === "left"
          ? `inset(0 ${hidden.toFixed(1)}% 0 0)`
          : `inset(0 0 0 ${hidden.toFixed(1)}%)`,
      transform: `translateX(${((dir === "left" ? -1 : 1) * (1 - p) * 18).toFixed(1)}px)`,
    }
  }
  const quoteOpacity = interpolate(t, [qOut, qOut + 0.5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const listOpacity = interpolate(t, [listOut, listOut + 0.45], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const watchOpacity = interpolate(
    t,
    [watchIn, watchIn + 0.35, durationSec - 0.35, durationSec],
    [0, 1, 1, 0.6],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  const strongStyle: React.CSSProperties = { fontWeight: 700, color: GOLD }

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* The quotation: two halves, each arriving from its own side. */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: `0 ${px(34)}px`,
          opacity: quoteOpacity,
        }}
      >
        <div
          style={{
            fontFamily: serif,
            fontWeight: 400,
            fontSize: px(31),
            lineHeight: 1.22,
            color: "#fff",
            textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
            maxWidth: "88%",
            ...wipe(0.25, "left"),
          }}
        >
          {withStrong(quoteA, quoteAStrong, strongStyle)}
        </div>
        <div
          style={{
            fontFamily: serif,
            fontWeight: 400,
            fontSize: px(31),
            lineHeight: 1.22,
            color: "#fff",
            textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
            maxWidth: "88%",
            // Set apart from the first half: further in, a little lower.
            marginLeft: px(26),
            marginTop: px(14),
            ...wipe(1.5, "right"),
          }}
        >
          {withStrong(quoteB, quoteBStrong, strongStyle)}
        </div>
      </AbsoluteFill>

      {/* The three questions, dropping in one after another and drifting. */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: `0 ${px(34)}px`,
          opacity: listOpacity,
        }}
      >
        {questions.map((q, i) => {
          const at = listIn + i * 0.45
          const p = interpolate(t, [at, at + 0.26], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          })
          // Each line breathes on its own clock, so the block never reads as
          // one rigid slab pasted over moving film.
          const driftY = Math.sin((t + i * 1.7) * 0.9) * px(3.2)
          const driftX = Math.cos((t + i * 2.3) * 0.7) * px(2.2)
          return (
            <div
              key={q}
              style={{
                fontFamily: serif,
                fontWeight: 500,
                fontSize: px(28),
                lineHeight: 1.2,
                color: "#fff",
                textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
                maxWidth: "86%",
                marginTop: i === 0 ? 0 : px(26),
                opacity: p,
                transform: `translate(${driftX.toFixed(2)}px, ${(driftY - (1 - p) * px(26)).toFixed(2)}px)`,
              }}
            >
              {q}
            </div>
          )
        })}
      </AbsoluteFill>

      {/* The invitation, in the same face as WATCH / REFLECT / PRAY. */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          opacity: watchOpacity,
        }}
      >
        <div
          style={{
            fontFamily: sans,
            fontWeight: 600,
            fontSize: px(19),
            letterSpacing: px(3.4),
            color: "#fff",
            textShadow: `0 0 ${px(10)}px rgba(242,196,107,0.55), 0 0 ${px(26)}px rgba(242,196,107,0.3)`,
          }}
        >
          {watchLabel.toUpperCase()}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
