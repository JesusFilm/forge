import { Easing, interpolate, interpolateColors } from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"
import { TEASER_FONT_FAMILIES } from "./teaser-fonts"

/**
 * Kinetic captions for the spoken opening (owner, 2026-09-30): the whole
 * spoken line on screen, words of different sizes, set in an arrangement
 * rather than a centred subtitle. The line's hero phrase is set large, its
 * accent words in italic, and the connective words small; each word arrives
 * with the voice (blur in, a small rise).
 *
 * Three arrangements, for the owner to choose from:
 *   stack     a left-aligned poster block in the frame's open side
 *   staircase each phrase one step further right and down
 *   split     lead-in small at the top left, the hero large on the right,
 *             the rest small beneath it
 */

export type KineticLayout = "stack" | "staircase" | "split"

const SERIF = `'${TEASER_FONT_FAMILIES.literata}', Georgia, serif`
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`

const FUNCTION = new Set(
  [
    "a an the and or but of to in on at by for with from his her their its it is was were he she they we you i my your our all this that",
    // Russian (Bartimaeus RU, 2026-10-06): prepositions, conjunctions and
    // pronouns that must not end a run on their own.
    "а и в во на у с со к ко о об от до из за по для не ни но что как это он она они мы ты вы его её их мне тебе себе",
  ]
    .join(" ")
    .split(" "),
)

// Letters of ANY script: `[^a-z]` emptied every Cyrillic word, so no hero or
// accent was ever found and the Russian opening fell apart.
const clean = (w: string) =>
  w
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}']/gu, "")

type Token = { word: string; role: "hero" | "accent" | "plain"; at: number }

/** Mark each word hero / accent / plain from the given phrases. */
export function kineticTokens(
  line: string,
  hero: string,
  accents: ReadonlyArray<string> = [],
  starts: ReadonlyArray<number> = [],
): Token[] {
  const words = line.split(/\s+/).filter(Boolean)
  const heroWords = hero.split(/\s+/).map(clean).filter(Boolean)
  const roles: Token["role"][] = words.map(() => "plain")
  // The hero phrase, matched as a run of words.
  for (
    let i = 0;
    heroWords.length && i + heroWords.length <= words.length;
    i++
  ) {
    if (heroWords.every((h, k) => clean(words[i + k]) === h)) {
      for (let k = 0; k < heroWords.length; k++) roles[i + k] = "hero"
      break
    }
  }
  const acc = new Set(accents.map(clean))
  words.forEach((w, i) => {
    if (roles[i] === "plain" && acc.has(clean(w))) roles[i] = "accent"
  })
  return words.map((word, i) => ({
    word,
    role: roles[i],
    at: starts[i] ?? i * 0.28,
  }))
}

/** Phrases: the hero run on its own; other words in runs of at most three,
 *  a run closing after a content word so no line ends on "the". */
export function kineticPhrases(tokens: ReadonlyArray<Token>): Token[][] {
  const out: Token[][] = []
  let run: Token[] = []
  const flush = () => {
    if (run.length) out.push(run)
    run = []
  }
  tokens.forEach((t, i) => {
    if (t.role === "hero") {
      if (run.length && run[0].role !== "hero") flush()
      run.push(t)
      if (tokens[i + 1]?.role !== "hero") flush()
      return
    }
    run.push(t)
    const content = !FUNCTION.has(clean(t.word))
    if ((content && run.length >= 2) || run.length >= 3 || t.role === "accent")
      flush()
  })
  flush()
  return out
}

const capsCache = new Map<string, number>()

/** Width of `text` set as the hero (Literata 500, caps, tracked, with the
 *  gap each word leaves after it). Falls back to an estimate outside a DOM. */
function measureCaps(
  text: string,
  size: number,
  tracking: number,
  gap: number,
): number {
  const key = `${text}|${size}|${tracking}`
  const hit = capsCache.get(key)
  if (hit != null) return hit
  const words = text.split(/\s+/).filter(Boolean)
  const estimate = () =>
    text.length * (size * 0.8 + tracking) + gap * words.length
  if (typeof document === "undefined" || !document.body) return estimate()
  const probe = document.createElement("span")
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;left:-99999px;top:0"
  probe.style.fontFamily = SERIF
  probe.style.fontSize = `${size}px`
  probe.style.fontWeight = "500"
  probe.style.letterSpacing = `${tracking}px`
  probe.style.textTransform = "uppercase"
  document.body.appendChild(probe)
  let w = 0
  for (const word of words) {
    probe.textContent = word
      .replace(/^[«“"„‘']+/, "")
      .replace(/[.,;:!?»”"’']+$/, "")
    w += probe.getBoundingClientRect().width + gap
  }
  probe.remove()
  // Only a measurement made with the real face is kept (see measureText).
  if (document.fonts.check(`500 ${size}px ${SERIF}`)) capsCache.set(key, w)
  return w
}

function Word({
  t,
  time,
  size,
  font,
  weight,
  italic,
  caps,
  tracking,
  color,
  flash,
}: {
  t: Token
  time: number
  size: number
  font: string
  weight: number
  italic?: boolean
  caps?: boolean
  tracking?: number
  color: string
  /** The word lights in this colour as it is said, then cools to `color`
   *  (owner, 2026-10-08: orange, as the film short's question mark). */
  flash?: string
}) {
  const p = interpolate(time, [t.at - 0.05, t.at + 0.45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: font,
        fontSize: size,
        fontWeight: weight,
        fontStyle: italic ? "italic" : "normal",
        textTransform: caps ? "uppercase" : "none",
        letterSpacing: tracking ?? 0,
        color: flash
          ? interpolateColors(time, [t.at + 0.25, t.at + 0.95], [flash, color])
          : color,
        opacity: p,
        transform: `translateY(${((1 - p) * size * 0.18).toFixed(2)}px)`,
        filter:
          p < 0.99
            ? `blur(${((1 - p) * size * 0.08).toFixed(2)}px)`
            : undefined,
        textShadow: "0 2px 18px rgba(0,0,0,0.55)",
        marginRight: size * 0.26,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {/* Quote marks stay off the poster words: «МАРФА read as a stray
          bracket on the Russian Martha opening (2026-10-08). */}
      {t.word.replace(/^[«“"„‘']+/, "").replace(/[.,;:!?»”"’']+$/, "")}
    </span>
  )
}

export function KineticCaption({
  line,
  hero,
  accents = [],
  starts = [],
  time,
  layout,
  px,
  side = "left",
  portrait = false,
  maxWidth,
  sizes = {},
  accentColor,
  bottom = "27%",
  backdrop = false,
  rightInset,
  flash,
}: {
  line: string
  hero: string
  accents?: ReadonlyArray<string>
  /** Seconds (relative to `time`'s origin) at which each word is spoken. */
  starts?: ReadonlyArray<number>
  time: number
  layout: KineticLayout
  px: (n: number) => number
  /** Which side of the frame is open, for the text to sit on. */
  side?: "left" | "right"
  /** 9:16 (the vertical teaser): the block sits in the lower half, above the
   *  app's own UI, and never wider than `maxWidth`. */
  portrait?: boolean
  maxWidth?: number
  /** Per-role size multipliers (the vertical teaser sets the type larger and
   *  lets it overlap the picture: owner, 2026-09-30). */
  sizes?: { hero?: number; accent?: number; plain?: number }
  /** Accent word colour. Default gold (the teaser); the history short sets
   *  it white (owner, 2026-10-02: the teaser's style "without the yellow"). */
  accentColor?: string
  /** Portrait: the block's bottom edge. The teaser's 27%; the history short
   *  sits higher, out of the bottom UI zone. */
  bottom?: string
  /** A soft dark pool behind the block itself, sized to it, so the darkening
   *  is where the words are (owner, 2026-10-02) rather than a fixed band. */
  backdrop?: boolean
  /** Portrait, right side: the block's right edge, clear of the platform's
   *  action rail (likes, comments, share) rather than at the frame edge. */
  rightInset?: number
  /** Each word lights in this colour as it is said (see Word). */
  flash?: string
}) {
  const kHero = sizes.hero ?? 1
  const kAccent = sizes.accent ?? 1
  const kPlain = sizes.plain ?? 1
  const tokens = kineticTokens(line, hero, accents, starts)
  const phrases = kineticPhrases(tokens)
  const ink = "#f4efe8"
  const gold = accentColor ?? "#f2c46b"
  // A long hero ("THE BEST ROBE") shrinks to fit the frame's width.
  const heroText = tokens
    .filter((x) => x.role === "hero")
    .map((x) => x.word)
    .join(" ")
  // Measured with the loaded face: a per-character guess (0.66 em) let
  // "ONE WORD" run off the frame at the teaser's larger size.
  const heroSize = px(46) * kHero
  const heroW = heroText
    ? measureCaps(heroText, heroSize, px(1.2), px(46) * kHero * 0.26)
    : 0
  const heroFit = maxWidth && heroW > 0 ? Math.min(1, maxWidth / heroW) : 1
  const style = (t: Token, scale = 1) =>
    t.role === "hero"
      ? {
          size: heroSize * scale * heroFit,
          font: SERIF,
          weight: 500,
          caps: true,
          tracking: px(1.2),
          color: "#ffffff",
        }
      : t.role === "accent"
        ? {
            size: px(24) * kAccent * scale,
            font: SERIF,
            weight: 400,
            italic: true,
            color: gold,
          }
        : {
            size: px(10.5) * kPlain * scale,
            font: SANS,
            weight: 600,
            caps: true,
            tracking: px(2.2),
            color: ink,
          }

  const inset = portrait ? px(28) : px(46)
  const edge =
    side === "left" ? { left: inset } : { right: rightInset ?? inset }
  if (layout === "stack") {
    return (
      <div
        style={{
          position: "absolute",
          ...edge,
          ...(portrait
            ? { bottom, maxWidth }
            : { top: "50%", transform: "translateY(-50%)" }),
          display: "flex",
          flexDirection: "column",
          alignItems: side === "left" ? "flex-start" : "flex-end",
          gap: px(7),
          // Its own stacking context, so the backdrop (z -1) sits behind
          // the words but never behind the film.
          isolation: "isolate",
        }}
      >
        {backdrop ? (
          <div
            style={{
              position: "absolute",
              inset: `${-px(34)}px ${-px(40)}px`,
              zIndex: -1,
              borderRadius: px(60),
              background:
                "radial-gradient(closest-side, rgba(0,0,0,0.62), rgba(0,0,0,0.38) 55%, rgba(0,0,0,0) 100%)",
              filter: `blur(${px(14)}px)`,
            }}
          />
        ) : null}
        {phrases.map((ph, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline" }}>
            {ph.map((t, k) => (
              <Word
                key={k}
                t={t}
                time={time}
                {...style(t)}
                {...(flash ? { flash } : {})}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (layout === "staircase") {
    return (
      <div
        style={{
          position: "absolute",
          ...(side === "left" ? { left: px(40) } : { right: px(40) }),
          top: "22%",
          display: "flex",
          flexDirection: "column",
          alignItems: side === "left" ? "flex-start" : "flex-end",
          gap: px(9),
        }}
      >
        {phrases.map((ph, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              // Steps away from the open edge, toward the picture's centre.
              ...(side === "left"
                ? { marginLeft: px(34) * i }
                : { marginRight: px(34) * i }),
            }}
          >
            {ph.map((t, k) => (
              <Word key={k} t={t} time={time} {...style(t, 1.05)} />
            ))}
          </div>
        ))}
      </div>
    )
  }
  // split: what comes before the hero small at the top left, the hero large
  // across the right, what follows small beneath it, right-aligned.
  const hi = phrases.findIndex((ph) => ph[0]?.role === "hero")
  const before = hi > 0 ? phrases.slice(0, hi).flat() : []
  const heroRun = hi >= 0 ? phrases[hi] : []
  const after = hi >= 0 ? phrases.slice(hi + 1).flat() : phrases.flat()
  const heroChars = heroRun.map((t) => t.word).join(" ").length
  const heroScale = Math.min(1.7, 13 / Math.max(1, heroChars))
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: px(46),
          top: px(40),
          display: "flex",
          flexWrap: "wrap",
          maxWidth: "46%",
          rowGap: px(6),
        }}
      >
        {before.map((t, k) => (
          <Word key={k} t={t} time={time} {...style(t, 1.1)} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          right: px(40),
          bottom: px(58),
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: px(8),
        }}
      >
        <div style={{ display: "flex" }}>
          {heroRun.map((t, k) => (
            <Word
              key={k}
              t={t}
              time={time}
              // As large as the frame allows: a one-word hero fills the
              // right half, a three-word one steps down to fit it.
              {...style(t, heroScale)}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {after.map((t, k) => (
            <Word key={k} t={t} time={time} {...style(t, 1.1)} />
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * The quiet close for the vertical teaser (`introCtaStyle: "calm"`): the call
 * to action as one centred sentence in the serif, no caps hero and no word
 * arrivals. It fades up as a whole with a short rise, under a gold hairline,
 * so the ending settles instead of shouting.
 */
export function CalmCallToAction({
  line,
  time,
  px,
  maxWidth,
}: {
  line: string
  /** Seconds since the line began. */
  time: number
  px: (n: number) => number
  maxWidth: number
}) {
  const p = interpolate(time, [0, 1.3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  })
  const rule = interpolate(time, [0.3, 1.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  })
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "30%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: px(14),
      }}
    >
      <div
        style={{
          width: px(34) * rule,
          height: Math.max(2, px(1)),
          background: "#f2c46b",
          opacity: 0.85,
        }}
      />
      <div
        style={{
          maxWidth,
          textAlign: "center",
          textWrap: "balance",
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: px(30),
          lineHeight: 1.25,
          color: "#f4efe8",
          opacity: p,
          transform: `translateY(${((1 - p) * px(6)).toFixed(2)}px)`,
          textShadow: "0 2px 18px rgba(0,0,0,0.55)",
        }}
      >
        {line}
      </div>
    </div>
  )
}
