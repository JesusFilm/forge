import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion"

import { BLOCK_FADE_SEC, quoteIntroTimeline, TYPE_CPS } from "./quote-timing"

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

export type QuoteIntroProps = {
  quoteA: string
  quoteAStrong?: string
  quoteB: string
  quoteBStrong?: string
  questions: ReadonlyArray<string>
  watchLabel: string
  /** Teaser only: replaces the invitation with a line pointing at the full
   *  devotional, under a small gold label. */
  cta?: string
  ctaLabel?: string
  /** Staged sound files: one key click per typed character, and the whoosh
   *  that rides each block's arrival (owner's InShot transition). */
  keySfx?: string
  transitionSfx?: string
  px: (n: number) => number
  fps: number
  /** Card length in seconds — the beats are laid out against it. */
  durationSec: number
  serif: string
  sans: string
}

/** Splits a line so the phrase carrying the weight can be set apart. `visible`
 *  lets a half-typed line keep its gold: the index is taken from the whole
 *  line, so the accent arrives with the characters rather than after them. */
function withStrong(
  line: string,
  strong: string | undefined,
  strongStyle: React.CSSProperties,
  visible = line.length,
) {
  const shown = line.slice(0, visible)
  if (!strong) return shown
  const at = line.toLowerCase().indexOf(strong.toLowerCase())
  if (at < 0 || at >= shown.length) return shown
  return (
    <>
      {shown.slice(0, at)}
      <span style={strongStyle}>{shown.slice(at, at + strong.length)}</span>
      {shown.slice(at + strong.length)}
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
  cta,
  ctaLabel,
  keySfx,
  transitionSfx,
  px,
  fps,
  durationSec,
  serif,
  sans,
}: QuoteIntroProps) {
  const frame = useCurrentFrame()
  const t = frame / fps
  // Every beat is derived from how long the words take to READ (quote-timing),
  // so a longer line buys itself more time instead of being clipped. The card's
  // own length comes from the same model, so these land inside it.
  const plan = quoteIntroTimeline({
    quoteA,
    quoteB,
    questions,
    ...(cta ? { cta } : {}),
  })
  const qOut = plan.quoteOutAt
  const listOut = plan.questionsOutAt
  const watchIn = plan.watchAt

  // Owner: the halves are PUSHED in from their own side, not revealed edge to
  // edge — a wipe also cut the descenders off the first line ("g" lost its
  // tail), which a plain slide cannot do.
  const push = (from: number, dir: "left" | "right", travelUnits = 54) => {
    // Owner: the second half is sharper than the first and travels further.
    const p = interpolate(t, [from, from + 0.34], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    })
    const travel = px(travelUnits) * (1 - p)
    return {
      opacity: p,
      transform: `translateX(${((dir === "left" ? -1 : 1) * travel).toFixed(1)}px)`,
    }
  }
  /** Characters of `text` visible at time t, typed at TYPE_CPS. */
  const typed = (text: string, from: number) =>
    Math.max(0, Math.min(text.length, Math.floor((t - from) * TYPE_CPS)))
  const quoteOpacity = interpolate(t, [qOut, qOut + BLOCK_FADE_SEC], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const listOpacity = interpolate(
    t,
    [listOut, listOut + BLOCK_FADE_SEC],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  )
  const watchOpacity = interpolate(
    t,
    [watchIn, watchIn + 0.35, durationSec - 0.35, durationSec],
    [0, 1, 1, 0.6],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )
  // Owner: the quotation is set in the label face, and ONLY the phrase that
  // carries the weight is the serif — so the gold words read as a quotation
  // inside a plain sentence, not as one block of display type.
  const strongStyle: React.CSSProperties = {
    fontFamily: serif,
    fontWeight: 600,
    fontStyle: "italic",
    color: GOLD,
  }

  // One click per typed character, and a whoosh under each arrival. Both are
  // staged next to the clip, so they are absent in a preview that has no sfx.
  const keyClicks = keySfx
    ? Array.from({ length: quoteA.trim().length }, (_, i) =>
        Math.round((plan.quoteAt[0] + i / TYPE_CPS) * fps),
      )
    : []
  const whooshes = transitionSfx
    ? [plan.quoteAt[1], ...plan.questionsAt].map((at) => Math.round(at * fps))
    : []

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {keyClicks.map((from, i) => (
        <Sequence
          key={`k${i}`}
          from={from}
          durationInFrames={Math.round(0.2 * fps)}
        >
          <Audio src={staticFile(keySfx!)} volume={0.32} />
        </Sequence>
      ))}
      {whooshes.map((from, i) => (
        <Sequence
          key={`w${i}`}
          from={from}
          durationInFrames={Math.round(0.8 * fps)}
        >
          <Audio src={staticFile(transitionSfx!)} volume={0.38} />
        </Sequence>
      ))}
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
            fontFamily: sans,
            fontWeight: 400,
            fontSize: px(29),
            lineHeight: 1.34,
            color: "#fff",
            textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
            maxWidth: "88%",
            // Typed, not pushed — it appears character by character.
            opacity: t >= plan.quoteAt[0] ? 1 : 0,
          }}
        >
          {withStrong(
            quoteA,
            quoteAStrong,
            strongStyle,
            typed(quoteA, plan.quoteAt[0]),
          )}
          {typed(quoteA, plan.quoteAt[0]) < quoteA.length &&
          t > plan.quoteAt[0] ? (
            // The carriage: a block caret that sits at the end of what has
            // been typed and leaves with the last character.
            <span
              style={{
                display: "inline-block",
                width: px(14),
                height: px(24),
                marginLeft: px(3),
                transform: `translateY(${px(3)}px)`,
                background: "rgba(255,255,255,0.8)",
              }}
            />
          ) : null}
        </div>
        <div
          style={{
            fontFamily: sans,
            fontWeight: 400,
            fontSize: px(29),
            lineHeight: 1.34,
            color: "#fff",
            textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
            maxWidth: "88%",
            // Set apart from the first half: further in, a little lower.
            marginLeft: px(26),
            marginTop: px(14),
            // Owner: sharper than the first half, and a longer way in.
            ...push(plan.quoteAt[1], "right", 120),
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
          const at = plan.questionsAt[i] ?? 0
          // A touch of overshoot on the way in (owner: a little bouncing).
          const p = interpolate(t, [at, at + 0.4], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.34, 1.56, 0.64, 1),
          })
          const fade = interpolate(t, [at, at + 0.22], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
          // Owner: not a stack of three identical rows — the middle one sits
          // further in and a little higher, the last one drops lower.
          const nudge = [
            { x: 0, y: 0 },
            { x: px(34), y: -px(10) },
            { x: px(10), y: px(16) },
          ][i] ?? { x: 0, y: 0 }
          // Each line breathes on its own clock, so the block never reads as
          // one rigid slab pasted over moving film.
          const driftY = Math.sin((t + i * 1.7) * 0.85) * px(7)
          const driftX = Math.cos((t + i * 2.3) * 0.65) * px(5)
          return (
            <div
              key={q}
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: px(14),
                maxWidth: "88%",
                marginTop: i === 0 ? 0 : px(38),
                marginLeft: nudge.x,
                opacity: fade,
                transform: `translate(${(driftX + (1 - p) * -px(46)).toFixed(2)}px, ${(driftY + nudge.y).toFixed(2)}px)`,
              }}
            >
              {/* A hairline marks each question, the way the step row's rails
                  do — it gives the three lines a left edge to hang from. */}
              <span
                style={{
                  width: px(2),
                  borderRadius: px(2),
                  background: GOLD,
                  opacity: 0.75,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontFamily: sans,
                  fontWeight: 500,
                  fontSize: px(26),
                  lineHeight: 1.3,
                  color: "#fff",
                  textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
                }}
              >
                {q}
              </div>
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
        {cta ? (
          // Teaser close: the line that sends the viewer to the full piece,
          // with the destination named underneath in the label face.
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: px(16),
              padding: `0 ${px(34)}px`,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontFamily: sans,
                fontWeight: 500,
                fontSize: px(27),
                lineHeight: 1.3,
                color: "#fff",
                textShadow: `0 ${px(2)}px ${px(20)}px rgba(0,0,0,0.55)`,
                maxWidth: px(300),
              }}
            >
              {cta}
            </div>
            <div
              style={{
                fontFamily: sans,
                fontWeight: 600,
                fontSize: px(15),
                letterSpacing: px(3),
                color: GOLD,
                textShadow: `0 0 ${px(10)}px rgba(242,196,107,0.5)`,
              }}
            >
              {(ctaLabel ?? "Watch on YouTube").toUpperCase()}
            </div>
          </div>
        ) : (
          <div
            style={{
              fontFamily: sans,
              fontWeight: 600,
              fontSize: px(19),
              letterSpacing: px(3.4),
              // Gold, like the live step in the stepper (owner).
              color: GOLD,
              textShadow: `0 0 ${px(10)}px rgba(242,196,107,0.55), 0 0 ${px(26)}px rgba(242,196,107,0.3)`,
            }}
          >
            {watchLabel.toUpperCase()}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
