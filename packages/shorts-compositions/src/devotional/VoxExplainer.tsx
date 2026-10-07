import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion"

import { SHORT_FONT_FAMILIES } from "../fonts"

/**
 * A short Vox-style explainer on a beat grid (owner, 2026-10-07, from her
 * motion-design prompt, adapted to 25 s): a silent hook question, three
 * pieces of evidence, a takeaway. Every scene starts on a 120 BPM beat; the
 * narration clips are placed on the grid (`clips[].startSec`); motion steps
 * at 12 fps for a tactile stop-motion feel while the film itself plays
 * smoothly; scenes change through a zoom blur; the film sits behind as two
 * parallax layers; the palette is strictly gold, ink, paper and white.
 *
 * Coordinates are Figma units of a 900 x 1600 frame, converted by `f`.
 */

const GOLD = "#f2c46b"
const INK = "#191512"
const PAPER = "#f3eee3"
const WHITE = "#ffffff"
const SANS = `'${SHORT_FONT_FAMILIES.inter}', -apple-system, system-ui, sans-serif`
const SERIF = `'${SHORT_FONT_FAMILIES.ptSerif}', Georgia, serif`
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1)
const SLAP = Easing.bezier(0.18, 1.4, 0.4, 1)

export type ExplainerWord = { word: string; startSec: number; endSec: number }
export type ExplainerClip = {
  audioFile: string
  startSec: number
  words: ExplainerWord[]
}
export type ExplainerScene =
  | { kind: "question"; startSec: number; endSec: number; text: string }
  | { kind: "kicker"; startSec: number; endSec: number; text: string }
  | {
      kind: "verse"
      startSec: number
      endSec: number
      verse: string
      highlight: string
      reference: string
      tag?: string
      label?: string
    }
  | {
      kind: "points"
      startSec: number
      endSec: number
      /** Each point lands when its `on` word is said; `struck` points get a
       *  stroke through them as they land ("MEDICAL?"). */
      points: { text: string; on: string; struck?: boolean; big?: boolean }[]
      label?: string
    }
  | {
      kind: "takeaway"
      startSec: number
      endSec: number
      text: string
      on: string
    }

export type ExplainerSpec = {
  bpm: number
  motionFps: number
  clips: ExplainerClip[]
  scenes: ExplainerScene[]
  musicVolume?: number
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "")

/** Stop-motion time: motion steps at `fps`, so keyframes read as frames. */
const stepped = (t: number, fps: number) => Math.floor(t * fps) / fps

function wordAt(
  words: ReadonlyArray<ExplainerWord>,
  on: string,
  from: number,
  fallback: number,
): number {
  const w = words.find(
    (x) => x.startSec >= from - 0.05 && bare(x.word) === bare(on),
  )
  return w ? w.startSec : fallback
}

/** Zoom-blur in and out at a scene's edges (0.25 s each). */
function sceneMotion(t: number, s: { startSec: number; endSec: number }) {
  const inP = interpolate(t, [s.startSec, s.startSec + 0.25], [0, 1], {
    ...clamp,
    easing: OUT,
  })
  const outP = interpolate(t, [s.endSec - 0.25, s.endSec], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  })
  return {
    opacity: inP * (1 - outP),
    scale: 0.9 + 0.1 * inP + 0.18 * outP,
    blur: (1 - inP) * 10 + outP * 14,
  }
}

function SceneBox({
  t,
  s,
  children,
}: {
  t: number
  s: { startSec: number; endSec: number }
  children: React.ReactNode
}) {
  if (t < s.startSec - 0.02 || t > s.endSec + 0.02) return null
  const m = sceneMotion(t, s)
  return (
    <AbsoluteFill
      style={{
        opacity: m.opacity,
        transform: `scale(${m.scale.toFixed(4)})`,
        filter: m.blur > 0.2 ? `blur(${m.blur.toFixed(2)}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

function GoldBar({
  f,
  tq,
  at,
  text,
  top,
  size,
}: {
  f: (n: number) => number
  tq: number
  at: number
  text: string
  top: number
  size: number
}) {
  if (tq < at) return null
  const p = interpolate(tq, [at, at + 0.34], [0, 1], { ...clamp, easing: SLAP })
  return (
    <div
      style={{
        position: "absolute",
        top: f(top),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: GOLD,
          color: INK,
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: f(size),
          lineHeight: 1.05,
          letterSpacing: f(1),
          textTransform: "uppercase",
          padding: `${f(10)}px ${f(24)}px`,
          transform: `scale(${(1.15 - 0.15 * p).toFixed(4)}) rotate(-2deg)`,
          opacity: Math.min(1, p * 3),
          boxShadow: `0 ${f(8)}px ${f(20)}px rgba(0,0,0,0.45)`,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** The question, typed a letter per stop-motion step. */
function Question({
  f,
  tq,
  s,
}: {
  f: (n: number) => number
  tq: number
  s: { startSec: number; text: string }
}) {
  const shown = Math.max(0, Math.floor((tq - s.startSec - 0.15) * 24))
  return (
    <div
      style={{
        position: "absolute",
        top: f(620),
        left: f(120),
        right: f(120),
        textAlign: "center",
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: f(78),
        lineHeight: 1.1,
        color: WHITE,
        textTransform: "uppercase",
        textShadow: `0 ${f(3)}px ${f(20)}px rgba(0,0,0,0.6)`,
      }}
    >
      {[...s.text].map((ch, i) => (
        <span
          key={i}
          style={{
            opacity: i < shown ? 1 : 0,
            color: /[?]/.test(ch) ? GOLD : undefined,
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  )
}

function Verse({
  f,
  tq,
  words,
  s,
}: {
  f: (n: number) => number
  tq: number
  words: ReadonlyArray<ExplainerWord>
  s: Extract<ExplainerScene, { kind: "verse" }>
}) {
  const markAt = wordAt(words, s.highlight, s.startSec, s.startSec + 1.5)
  const mark = interpolate(tq, [markAt, markAt + 0.35], [0, 1], {
    ...clamp,
    easing: OUT,
  })
  const text = s.verse.trim()
  const at = text
    .toLowerCase()
    .search(new RegExp(`\\b${s.highlight.toLowerCase()}\\b`))
  const slap = interpolate(tq, [s.startSec, s.startSec + 0.34], [0, 1], {
    ...clamp,
    easing: SLAP,
  })
  return (
    <>
      {s.tag ? (
        <div
          style={{
            position: "absolute",
            top: f(400),
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: f(64),
            color: GOLD,
            letterSpacing: f(2),
            opacity: Math.min(1, slap * 2),
          }}
        >
          {s.tag}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: f(520),
          left: f(100),
          width: f(700),
          background: PAPER,
          padding: `${f(32)}px ${f(36)}px`,
          transform: `rotate(${(-1.8 + (1 - slap) * 3).toFixed(3)}deg) scale(${(1.08 - 0.08 * slap).toFixed(4)})`,
          boxShadow: `0 ${f(14)}px ${f(30)}px rgba(0,0,0,0.5)`,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(22),
            letterSpacing: f(4),
            textTransform: "uppercase",
            color: "rgba(25,21,18,0.6)",
            marginBottom: f(12),
          }}
        >
          {s.reference}
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontSize: f(48),
            lineHeight: 1.4,
            color: INK,
          }}
        >
          {at >= 0 ? (
            <>
              {text.slice(0, at)}
              <span
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    inset: "0.12em -0.08em 0.02em",
                    background: GOLD,
                    transform: `scaleX(${mark.toFixed(4)}) skewX(-8deg)`,
                    transformOrigin: "0 50%",
                  }}
                />
                <span style={{ position: "relative" }}>
                  {text.slice(at, at + s.highlight.length)}
                </span>
              </span>
              {text.slice(at + s.highlight.length)}
            </>
          ) : (
            text
          )}
        </div>
      </div>
    </>
  )
}

function Points({
  f,
  tq,
  words,
  s,
}: {
  f: (n: number) => number
  tq: number
  words: ReadonlyArray<ExplainerWord>
  s: Extract<ExplainerScene, { kind: "points" }>
}) {
  let from = s.startSec
  const timed = s.points.map((p) => {
    const at = wordAt(words, p.on, from, from + 1)
    from = at
    return { ...p, at }
  })
  return (
    <div
      style={{
        position: "absolute",
        top: f(450),
        left: f(110),
        right: f(110),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: f(16),
      }}
    >
      {timed.map((p, i) => {
        if (tq < p.at)
          return <div key={i} style={{ height: f(p.big ? 104 : 64) }} />
        const k = interpolate(tq, [p.at, p.at + 0.3], [0, 1], {
          ...clamp,
          easing: SLAP,
        })
        const strike = p.struck
          ? interpolate(tq, [p.at + 0.25, p.at + 0.55], [0, 1], {
              ...clamp,
              easing: OUT,
            })
          : 0
        return (
          <div
            key={i}
            style={{
              position: "relative",
              fontFamily: SANS,
              fontWeight: 800,
              fontSize: f(p.big ? 96 : 58),
              lineHeight: 1.05,
              textTransform: "uppercase",
              color: p.big ? INK : p.struck ? "rgba(255,255,255,0.6)" : WHITE,
              background: p.big ? GOLD : undefined,
              padding: p.big ? `${f(6)}px ${f(22)}px` : undefined,
              transform: `scale(${(1.18 - 0.18 * k).toFixed(4)}) rotate(${p.big ? -2 : 0}deg)`,
              opacity: Math.min(1, k * 3),
              textShadow: p.big
                ? undefined
                : `0 ${f(3)}px ${f(18)}px rgba(0,0,0,0.6)`,
            }}
          >
            {p.text}
            {strike > 0 ? (
              <span
                style={{
                  position: "absolute",
                  left: "-4%",
                  top: "48%",
                  height: f(9),
                  width: `${(108 * strike).toFixed(1)}%`,
                  background: GOLD,
                  transform: "rotate(-4deg)",
                  borderRadius: f(5),
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** "01  THE VERSE": which piece of evidence this is, small, gold numeral. */
function SegmentLabel({
  f,
  tq,
  at,
  text,
}: {
  f: (n: number) => number
  tq: number
  at: number
  text: string
}) {
  const [num, ...rest] = text.split(" ")
  const k = interpolate(tq, [at, at + 0.3], [0, 1], { ...clamp, easing: OUT })
  return (
    <div
      style={{
        position: "absolute",
        top: f(360),
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "baseline",
        gap: f(14),
        opacity: k,
        transform: `translateY(${((1 - k) * f(10)).toFixed(2)}px)`,
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: f(44),
          color: GOLD,
        }}
      >
        {num}
      </span>
      <span
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: f(24),
          letterSpacing: f(4),
          color: WHITE,
          textTransform: "uppercase",
        }}
      >
        {rest.join(" ")}
      </span>
    </div>
  )
}

/** The film behind everything as two parallax layers: a soft wide plate
 *  drifting slowly and a sharper plate drifting faster, muted to let the
 *  type lead. */
function ParallaxFilm({
  bgFile,
  startFrame,
  t,
  motionFps,
}: {
  bgFile: string
  startFrame: number
  t: number
  motionFps: number
}) {
  const tq = stepped(t, motionFps)
  const far = Math.sin(tq * 0.35) * 18
  const near = Math.sin(tq * 0.35) * 46
  const common = { width: "100%", height: "100%", objectFit: "cover" as const }
  return (
    <>
      <AbsoluteFill
        style={{
          transform: `scale(1.25) translateX(${far.toFixed(1)}px)`,
          filter: "blur(14px) grayscale(0.85) brightness(0.55)",
        }}
      >
        <OffthreadVideo
          src={staticFile(bgFile)}
          muted
          trimBefore={startFrame}
          style={common}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(1.12) translateX(${near.toFixed(1)}px)`,
          filter: "grayscale(0.85) contrast(1.08) brightness(0.62)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 55% at 50% 45%, #000 55%, transparent 100%)",
          maskImage:
            "radial-gradient(ellipse 70% 55% at 50% 45%, #000 55%, transparent 100%)",
        }}
      >
        <OffthreadVideo
          src={staticFile(bgFile)}
          muted
          trimBefore={startFrame}
          style={common}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "rgba(25,21,18,0.35)" }} />
    </>
  )
}

export function VoxExplainer({
  f,
  t,
  spec,
  bgFile,
  bgStartOffsetSec,
  musicFile,
}: {
  f: (n: number) => number
  t: number
  spec: ExplainerSpec
  bgFile?: string
  bgStartOffsetSec?: number
  musicFile?: string
}) {
  const { fps, durationInFrames } = useVideoConfig()
  const tq = stepped(t, spec.motionFps)
  const words = spec.clips.flatMap((c) =>
    c.words.map((w) => ({
      word: w.word,
      startSec: c.startSec + w.startSec,
      endSec: c.startSec + w.endSec,
    })),
  )
  // A soft pulse on every beat, the grid made visible without a click track.
  const beat = 60 / spec.bpm
  const sinceBeat = t % beat
  const pulse = interpolate(sinceBeat, [0, 0.12], [1, 0], clamp)
  // Captions: the current word, Vox style, white on ink.
  const cur = words.find((w, i) => {
    const next = words[i + 1]
    const until = next
      ? Math.min(next.startSec, Math.max(w.endSec + 0.35, w.startSec + 0.25))
      : w.endSec + 0.6
    return t >= w.startSec && t < until
  })
  return (
    <AbsoluteFill style={{ background: INK }}>
      {bgFile ? (
        <ParallaxFilm
          bgFile={bgFile}
          startFrame={Math.round((bgStartOffsetSec ?? 0) * fps)}
          t={t}
          motionFps={spec.motionFps}
        />
      ) : null}
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 ${f(160)}px rgba(242,196,107,${(0.05 * pulse).toFixed(3)})`,
          pointerEvents: "none",
        }}
      />
      {spec.clips.map((c, i) => (
        <Sequence key={i} from={Math.round(c.startSec * fps)}>
          <Audio src={staticFile(c.audioFile)} />
        </Sequence>
      ))}
      {musicFile ? (
        <Audio
          src={staticFile(musicFile)}
          loop
          volume={(fr) =>
            (spec.musicVolume ?? 0.2) *
            interpolate(
              fr,
              [
                0,
                Math.round(0.25 * fps),
                durationInFrames - Math.round(1 * fps),
                durationInFrames,
              ],
              [0, 1, 1, 0],
              clamp,
            )
          }
        />
      ) : null}
      {/* The tag: this is one piece of a longer video. */}
      <div
        style={{
          position: "absolute",
          top: f(250),
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: GOLD,
            color: INK,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(20),
            letterSpacing: f(3),
            textTransform: "uppercase",
            padding: `${f(6)}px ${f(12)}px`,
          }}
        >
          From the Full Devotional
        </div>
      </div>
      {spec.scenes.map((s, i) => (
        <SceneBox key={i} t={t} s={s}>
          {s.kind === "question" ? (
            <Question f={f} tq={tq} s={s} />
          ) : s.kind === "kicker" ? (
            <GoldBar
              f={f}
              tq={tq}
              at={s.startSec}
              text={s.text}
              top={640}
              size={110}
            />
          ) : s.kind === "verse" ? (
            <>
              {s.label ? (
                <SegmentLabel f={f} tq={tq} at={s.startSec} text={s.label} />
              ) : null}
              <Verse f={f} tq={tq} words={words} s={s} />
            </>
          ) : s.kind === "points" ? (
            <>
              {s.label ? (
                <SegmentLabel f={f} tq={tq} at={s.startSec} text={s.label} />
              ) : null}
              <Points f={f} tq={tq} words={words} s={s} />
            </>
          ) : (
            <GoldBar
              f={f}
              tq={tq}
              at={wordAt(words, s.on, s.startSec, s.startSec + 0.3)}
              text={s.text}
              top={660}
              size={118}
            />
          )}
        </SceneBox>
      ))}
      {cur ? (
        <div
          style={{
            position: "absolute",
            top: f(1110),
            left: "50%",
            transform: "translateX(-50%)",
            background: INK,
            color: WHITE,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: f(46),
            lineHeight: `${f(70)}px`,
            padding: `0 ${f(14)}px`,
            whiteSpace: "nowrap",
          }}
        >
          {cur.word.replace(/[,;:.!?”"]+$/, "")}
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
