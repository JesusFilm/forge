import type { ReactNode } from "react"
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import type { DevotionalCard, DevotionalInputProps } from "./schema"
import type { DevotionalStyle } from "./styles"
import { Grain, HEAVY, blurRegionFor } from "./visual-primitives"
import { audioFade } from "./audio-volume"

function Background({
  card,
  style,
  props,
  px,
  durationInFrames,
  fromFrame,
  totalFrames,
  bgStartFrame,
  bgRate,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  props: DevotionalInputProps
  px: (n: number) => number
  durationInFrames: number
  fromFrame: number
  totalFrames: number
  bgStartFrame: number
  bgRate: number
}) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  // Landscape (16:9 desktop): the film is natively wide — play it fitted
  // full-frame instead of the portrait square crop.
  const isLandscape = width > height
  const isVideoCard = card.kind === "video" && Boolean(card.videoFile)
  const heavy = HEAVY.has(card.kind)

  // Ken-Burns: ONE continuous slow zoom across the WHOLE video (driven by the
  // absolute frame, not per-card) so consecutive background segments — which are
  // contiguous footage — dissolve seamlessly with no scale "pop" at the cut.
  const absFrame = fromFrame + frame
  const kb = interpolate(absFrame, [0, totalFrames], [1.04, 1.16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  // Gentle scale for the FITTED (contain) video-card layer — per-card is fine
  // (it's a single standalone beat).
  const kbFit = interpolate(frame, [0, durationInFrames], [1.0, 1.03], {
    extrapolateRight: "clamp",
  })

  const src = isVideoCard ? card.videoFile! : (card.bgFile ?? props.bgFile)
  // Cover (both orientations): centered lockup over CLEAR footage — no blur
  // band. A dark wash + inner vignette (below) keep the text readable, and the
  // footage's own blur eases from soft → sharp over the opening (per the design
  // spec: blur 12px → 0 over the first 60% of the card, easeOutCubic).
  const introCover = card.kind === "cover"
  // Blur behind the text only: a band for top/bottom-aligned cards, the whole
  // frame for centered text; the video card stays clear.
  const region = introCover ? "none" : blurRegionFor(card.kind, style)

  // Grade for the video card's clip: an explicit override wins; otherwise the
  // graded filters (gradeVideoCard) apply their base grade, and plain filters
  // leave the clip in natural color.
  const videoGrade =
    props.videoCardFilter ?? (style.gradeVideoCard ? style.mediaBase : "")
  // Peak volume for the clip's own audio: an explicit teaser level, else muted,
  // else near-full for the standalone full-devo video card.
  const clipAudioLevel =
    props.videoAudioLevel != null
      ? props.videoAudioLevel
      : props.muteVideoAudio
        ? 0
        : 0.95

  // Text-card / cover background video. All non-video cards share ONE continuous
  // clip (props.bgFile); trimBefore={bgStartFrame} makes each card a WINDOW into
  // it at the position where the previous card left off, so adjacent cards show
  // the SAME clip frame during their crossfade → the cut is seamless (no
  // repeated motion). The shared clip is cut long enough to cover the whole
  // background timeline, so no loop/freeze guard is needed.
  const bgTextVideo = (
    <OffthreadVideo
      src={staticFile(src ?? "")}
      trimBefore={Math.max(0, Math.round(bgStartFrame))}
      playbackRate={bgRate}
      // Text-card backgrounds are MUTED (music only) unless bgAudio is on
      // (teasers). Decoupled from videoAudioLevel so a full devo can set the
      // video-card level for balance without un-muting the reflection.
      muted={!props.bgAudio}
      volume={
        props.bgAudio
          ? (f) => {
              const fade = Math.round(0.5 * fps)
              return (
                (props.videoAudioLevel ?? 0.3) *
                0.5 *
                interpolate(
                  f,
                  [0, fade, durationInFrames - fade, durationInFrames],
                  [0, 1, 1, 0],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              )
            }
          : undefined
      }
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // Cover: sharp graded footage at a constant slight zoom (full-bleed,
        // no blur); other text cards dim + Ken-Burns behind the blur band.
        filter: introCover
          ? (props.mediaFilterOverride ?? style.mediaBase) || undefined
          : `${props.mediaFilterOverride ?? style.mediaBase} brightness(0.85)`.trim(),
        transform: introCover ? "scale(1.04)" : `scale(${kb})`,
      }}
    />
  )
  const bgTextLayer = bgTextVideo

  // The video card shows the horizontal clip FITTED (whole frame visible) with a
  // blurred, enlarged copy filling the wings — no dead letterbox bars. Text
  // cards show the footage lightly dimmed; the blur comes from the overlay so
  // only the text region is obscured.
  const media = !src ? null : isVideoCard ? (
    <>
      {/* Blurred wings fill. Natural color by default; an optional
          videoCardFilter cools/tints warm source footage to match the grade. */}
      <OffthreadVideo
        src={staticFile(src)}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: `${videoGrade} blur(${px(26)}px) brightness(0.5)`.trim(),
          transform: `scale(${kb * 1.08})`,
        }}
      />
      {/* Fitted sharp clip, in color, with its own audio faded in/out and kept
          quieter so it sits at the narration's level. Teasers mute it so the
          loud clip audio doesn't jump against the music bed. */}
      <OffthreadVideo
        src={staticFile(src)}
        {...(props.continuousClip
          ? { trimBefore: Math.max(0, Math.round(bgStartFrame)) }
          : {})}
        muted={clipAudioLevel <= 0}
        volume={(f) => {
          const clipEnd = Math.round((card.durationSec ?? 1) * fps)
          // Full devo: near-full, quick fades (clip plays alone, music ducked).
          // Teaser (videoAudioLevel set): quiet + slow fade in/out so it eases
          // gently under the music bed.
          const slow = props.videoAudioLevel != null
          const fin = Math.round((slow ? 2 : 0.6) * fps)
          const fout = Math.round((slow ? 2 : 1.3) * fps)
          const fade = audioFade(clipEnd, fin, fout)
          return (
            clipAudioLevel *
            interpolate(f, fade.inputRange, fade.outputRange, {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          )
        }}
        style={
          isLandscape
            ? {
                // 16:9 frame: the film is natively wide — fitted full-frame.
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                filter: videoGrade || undefined,
                transform: `scale(${kbFit})`,
              }
            : {
                // Portrait: squarish crop (owner) — fill a centered 1:1 window
                // (cover); bigger, more immersive, blurred wings above/below.
                position: "absolute",
                left: 0,
                right: 0,
                top: "21.9%", // (1920-1080)/2 / 1920 — centers the 1:1 crop
                width: "100%",
                height: "56.25%", // 1080/1920 → square in the 9:16 frame
                objectFit: "cover",
                filter: videoGrade || undefined,
                transform: `scale(${kbFit})`,
              }
        }
      />
    </>
  ) : (
    bgTextLayer
  )

  // "Don't blur so hard" cards: the grain cover, and the scripture card on the
  // teal-family filters, keep the footage more visible (softer blur + lighter
  // scrim) — so the verse reads over recognizable, continuing footage.
  const soft =
    (style.id === "grain" && card.kind === "cover") ||
    (["teal", "tealorange", "splittone"].includes(style.id) &&
      card.kind === "scripture")
  // The closing questions+prayer card was over-blurred (owner: too strong on the
  // last card) — use a medium blur + lighter scrim so the footage stays legible
  // behind the text without going murky.
  const medium = card.kind === "questions"
  const blurScale = props.blurScale ?? 1
  // Owner-picked levels: reflection + conclusion keep the footage nearly sharp.
  // Desktop (16:9) = "blur 10%" (px2.8); mobile (9:16) = "blur 15%" (px4.2) —
  // the taller frame shows more background, so it wants a touch more blur.
  // Legibility comes from the scrim + a soft, wide text shadow. Scripture (soft)
  // and questions (medium) keep heavier blur.
  const heavyBlurPx = isLandscape ? px(2.8) : px(4.2)
  const sharpCover = Boolean(props.coverBgSharp) && card.kind === "cover"
  const BLUR = sharpCover
    ? 0
    : (soft ? px(8) : medium ? px(15) : heavyBlurPx) * blurScale
  const wholeScrim = sharpCover
    ? "rgba(6,4,3,0.22)"
    : soft
      ? "rgba(6,4,3,0.3)"
      : medium
        ? "rgba(6,4,3,0.36)"
        : "rgba(6,4,3,0.46)"
  let blurOverlay: ReactNode = null
  if (region === "whole") {
    blurOverlay = (
      <AbsoluteFill
        style={{
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background: wholeScrim,
          pointerEvents: "none",
        }}
      />
    )
  } else if (isLandscape && props.wideText === "right" && region !== "none") {
    // Landscape right-panel variant: a vertical blur panel on the right —
    // the text column sits inside it; footage stays clear on the left.
    blurOverlay = (
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: "44%",
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background:
            "linear-gradient(90deg, transparent, rgba(6,4,2,0.7) 40%)",
          maskImage: "linear-gradient(90deg, transparent 0%, #000 26%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 26%)",
          pointerEvents: "none",
        }}
      />
    )
  } else if (region === "top" || region === "bottom") {
    const top = region === "top"
    blurOverlay = (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: top ? 0 : undefined,
          bottom: top ? undefined : 0,
          height: "62%",
          backdropFilter: `blur(${BLUR}px)`,
          WebkitBackdropFilter: `blur(${BLUR}px)`,
          background: top
            ? "linear-gradient(180deg, rgba(6,4,2,0.62), transparent)"
            : "linear-gradient(180deg, transparent, rgba(6,4,2,0.62))",
          maskImage: top
            ? "linear-gradient(180deg, #000 58%, transparent 100%)"
            : "linear-gradient(180deg, transparent 0%, #000 42%)",
          WebkitMaskImage: top
            ? "linear-gradient(180deg, #000 58%, transparent 100%)"
            : "linear-gradient(180deg, transparent 0%, #000 42%)",
          pointerEvents: "none",
        }}
      />
    )
  }

  // Archival film treatment: a highlight-bloom pass (a blurred, brightened copy
  // of the footage, screen-blended so bright areas glow — halation), plus extra
  // grain, a deeper vignette, and a thin film-frame edge. Everything reuses the
  // base grade so the glow matches the chosen look.
  const film = props.filmTreatment === true
  const baseGrade = isVideoCard
    ? videoGrade
    : (props.mediaFilterOverride ?? style.mediaBase)
  const bloom =
    film && src ? (
      <AbsoluteFill
        style={{ mixBlendMode: "screen", opacity: 0.34, pointerEvents: "none" }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: isVideoCard ? "contain" : "cover",
            filter:
              `${baseGrade} blur(${px(15)}px) brightness(1.7) saturate(1.05)`.trim(),
            transform: `scale(${isVideoCard ? kbFit : kb})`,
          }}
        />
      </AbsoluteFill>
    ) : null

  // True teal-orange split-tone: teal lifted into the shadows (screen adds most
  // where the image is dark) and warm orange pressed into the highlights
  // (multiply tints most where the image is bright). Unlike a hue-rotate this
  // manufactures teal-orange on ANY footage. The orange matches the brand accent.
  const splitTone =
    (props.splitTone ?? style.splitTone) === true && Boolean(src)
  const splitToneLayers = splitTone ? (
    <>
      <AbsoluteFill
        style={{
          background: "rgb(10,54,64)",
          mixBlendMode: "screen",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background: "rgb(240,176,116)",
          mixBlendMode: "multiply",
          opacity: 0.55,
          pointerEvents: "none",
        }}
      />
    </>
  ) : null

  // Cover treatment (Claude Design spec): a flat rgba(0,0,0,0.28) scrim over the
  // whole frame plus a soft inner vignette darkening the edges/corners.
  const coverScrim = introCover ? (
    <>
      <AbsoluteFill
        style={{
          background: sharpCover ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.28)",
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 ${px(108.3)}px ${px(21.7)}px rgba(0,0,0,0.45)`,
          pointerEvents: "none",
        }}
      />
    </>
  ) : null

  return (
    <AbsoluteFill style={{ backgroundColor: style.mediaBg }}>
      {src ? media : <AbsoluteFill style={{ background: style.textBg }} />}
      {splitToneLayers}
      {bloom}
      {blurOverlay}
      {coverScrim}
      <Grain
        opacity={
          (heavy ? style.grainText : style.grainMedia) + (film ? 0.16 : 0)
        }
      />
      {/* The cover paints its own vignette (above); skip the style vignette. */}
      <AbsoluteFill
        style={{
          boxShadow: introCover
            ? undefined
            : film
              ? "inset 0 0 130px 46px rgba(0,0,0,0.66)"
              : heavy
                ? style.vignetteText
                : style.vignetteMedia,
        }}
      />
      {film ? (
        <AbsoluteFill
          style={{
            boxShadow: `inset 0 0 0 ${px(1.5)}px rgba(255,255,255,0.07), inset 0 0 0 ${px(5)}px rgba(0,0,0,0.5)`,
            pointerEvents: "none",
          }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

/** Fades a card in over its first `xfade` frames — with overlapping sequences
 * this dissolves the previous card into the next (a slow crossfade). */
function CardFade({ xfade, children }: { xfade: number; children: ReactNode }) {
  const f = useCurrentFrame()
  const opacity = interpolate(f, [0, xfade], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

export { Background, CardFade }
