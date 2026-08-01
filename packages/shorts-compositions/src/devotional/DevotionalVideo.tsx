import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

import { loadApercu } from "./apercu"
import { Background, CardFade } from "./background"
import { CardBody } from "./card-body"
import { MuteButton } from "./card-chrome"
import type { DevotionalCard, DevotionalInputProps } from "./schema"
import { resolveDevotionalStyle, type DevotionalStyle } from "./styles"
import {
  CARD_TAIL_FRAMES,
  INTRO_HOLD_FRAMES,
  OUTRO_HOLD_FRAMES,
  computeCardFrames,
  framesFromDurations,
  hasPerCardAudio,
} from "./timing"
import {
  QuestionsProgressRing,
  REF,
  TEXT_SHADOW,
  VideoSubtitles,
} from "./visual-primitives"

export function DevotionalVideo(props: DevotionalInputProps) {
  loadApercu()
  const { durationInFrames, fps, width, height } = useVideoConfig()
  const frame = useCurrentFrame()
  const style = resolveDevotionalStyle(
    props.style,
    props.layout,
    props.renderConfig,
  )
  // Scale by the SHORT side: portrait (1080×1920) and landscape (1920×1080)
  // get identical absolute type/spacing sizes, so one design serves both.
  const px = (n: number) => (n * Math.min(width, height)) / REF
  const isLandscape = width > height
  // Landscape: the TEXT lives in a centered column a bit wider than the
  // portrait measure (fewer, longer lines — the frame is half as tall);
  // backgrounds stay full-bleed.
  const wideText = isLandscape ? (props.wideText ?? "bottom") : undefined
  // "right": a narrower column pinned to the right panel; "bottom": centered.
  const columnWidth =
    wideText === "right" ? Math.min(width, px(240)) : Math.min(width, px(505))
  const columnInset = isLandscape ? Math.max(0, (width - columnWidth) / 2) : 0
  const columnLeft =
    wideText === "right" ? width - columnWidth - px(24) : columnInset
  const columnRight = wideText === "right" ? px(24) : columnInset
  // Owner rule (landscape): edge-anchored text sits exactly 48px from the top
  // and bottom frame edges. The column wrapper spans the full height and each
  // card's own padding (padBottom / columnHeader) supplies the 48px — no extra
  // wrapper inset that would push blocks off the edge.
  const showMuteButton = props.showMuteButton !== false

  const perCardAudio = hasPerCardAudio(props.cards)
  const outroFrames =
    props.outroHoldSec != null
      ? Math.round(props.outroHoldSec * fps)
      : OUTRO_HOLD_FRAMES
  // Opening pause before the narration (drives both the cover's on-screen
  // length and the first card's audio delay). Overridable per render.
  const introFrames =
    props.introHoldSec != null
      ? Math.round(props.introHoldSec * fps)
      : INTRO_HOLD_FRAMES
  const frames = perCardAudio
    ? framesFromDurations(
        props.cards,
        fps,
        CARD_TAIL_FRAMES,
        outroFrames,
        introFrames,
      )
    : computeCardFrames(props.cards, durationInFrames, Math.round(2.5 * fps))

  // Soft fade from black at the open and to black at the close. noEndFade holds
  // the last frame clean instead (cover-only samples, or any clip that will be
  // seam-spliced into a following shot rather than ending on black).
  const fadeIn = Math.round(0.6 * fps)
  const fadeOut = Math.round(0.9 * fps)
  const endLevel = props.noEndFade ? 0 : 1
  const blackout = interpolate(
    frame,
    [0, fadeIn, durationInFrames - fadeOut, durationInFrames],
    [1, 0, 0, endLevel],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )

  // Slow crossfade between cards: each card (except the last) lingers XFADE
  // frames into the next card's start, and the next card fades in over the
  // overlap — so one card dissolves into the next instead of hard-cutting.
  // Teasers raise this (props.xfadeSec) so the opening dissolves slowly and the
  // verse blur ramps in gently.
  const XFADE =
    props.xfadeSec != null
      ? Math.round(props.xfadeSec * fps)
      : Math.round(0.85 * fps)
  // Both dissolves touching the video card are slower — scripture melts INTO the
  // clip, and the clip melts OUT into the reflection (no abrupt cut either end).
  const VIDEO_XFADE = Math.round(1.3 * fps)
  const boundaryXfade = (i: number) =>
    props.cards[i]?.kind === "video" || props.cards[i + 1]?.kind === "video"
      ? VIDEO_XFADE
      : XFADE
  const lastIndex = props.cards.length - 1

  // Duck the music to silence across the video card (it plays the film's own
  // sound). Short fades at the edges so the drop isn't abrupt. When the clip is
  // muted (teasers), don't duck — let the music bed play straight through.
  // Don't duck the music when the clip is muted OR quiet (teasers) — the bed
  // plays straight through and the soft clip audio just sits under it.
  // Duck the music to silence across the video card so it doesn't overlap the
  // clip's own audio. Skip ducking only when the clip is muted, or in teasers
  // (bgAudio) where the bed plays straight through. A quiet video-card level
  // (videoAudioLevel) no longer disables the duck.
  const videoIdx =
    props.muteVideoAudio || props.bgAudio
      ? -1
      : props.cards.findIndex((c) => c.kind === "video")
  const videoWindow =
    videoIdx >= 0
      ? {
          start: frames[videoIdx].from,
          // Keep the music muted through the trailing crossfade too — the clip's
          // own audio plays until the video card fully dissolves into the next.
          end:
            frames[videoIdx].from +
            frames[videoIdx].durationInFrames +
            (videoIdx < lastIndex ? XFADE : 0),
        }
      : null
  const duckFade = Math.round(0.4 * fps)

  // Seamless background: every non-video card is a WINDOW into ONE shared,
  // continuous clip (props.bgFile). Each card's window starts where the previous
  // non-video card's window ended (the running offset advances by the card's OWN
  // frame count, INCLUDING its crossfade tail) so that during a crossfade both
  // the outgoing and incoming cards show the EXACT SAME clip frame — the cut is
  // invisible (no repeated motion, no scale pop). The video card plays its own
  // curated clip and does not consume the background timeline.
  const bgRate = props.bgPlaybackRate ?? 1
  let bgAcc = 0
  const bgStartFrames = props.cards.map((c, i) => {
    if (c.kind === "video") return 0
    const start = bgAcc
    // Advance by the card's frames scaled by the playback rate — the clip
    // advances `bgRate` film-frames per composition frame, so the window
    // offsets stay aligned to the (slightly slowed) shared take.
    bgAcc += frames[i].durationInFrames * bgRate
    return start
  })

  return (
    <AbsoluteFill style={{ backgroundColor: "#0c0805" }}>
      {props.cards.map((card, i) => {
        // Delay the FIRST card's narration by the intro hold so the video
        // opens on a calm, silent beat before the voice begins.
        const audioDelay = perCardAudio && i === 0 ? introFrames : 0
        const seqDuration =
          frames[i].durationInFrames + (i < lastIndex ? boundaryXfade(i) : 0)
        return (
          <Sequence
            key={i}
            from={frames[i].from}
            durationInFrames={seqDuration}
          >
            <CardFade xfade={i === 0 ? 1 : boundaryXfade(i - 1)}>
              <Background
                card={card}
                style={style}
                props={props}
                px={px}
                durationInFrames={seqDuration}
                fromFrame={frames[i].from}
                totalFrames={durationInFrames}
                bgStartFrame={bgStartFrames[i]}
                bgRate={bgRate}
              />
              {/* Landscape: text in a centered portrait-width column; the
                  background above stays full-bleed. */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: columnLeft,
                  right: columnRight,
                  // Slight shadow on all card text (inherited) for legibility
                  // over the lightly-blurred footage.
                  textShadow: TEXT_SHADOW,
                }}
              >
                <CardLayer
                  card={card}
                  style={style}
                  px={px}
                  fps={fps}
                  headerDate={props.headerDate}
                  durationInFrames={frames[i].durationInFrames}
                  showMuteButton={showMuteButton}
                  anim={props.textAnim}
                  staticCover={props.staticCover === true}
                  wideText={wideText}
                  attribution={props.attribution}
                />
              </div>
              {/* Progress ring as a FULL-FRAME overlay (outside the text column)
                  so it can sit in the true bottom-right corner on desktop. */}
              {card.kind === "questions" ? (
                <QuestionsProgressRing
                  px={px}
                  fps={fps}
                  durationInFrames={frames[i].durationInFrames}
                  isLandscape={isLandscape}
                />
              ) : null}
            </CardFade>
            {card.audioFile ? (
              <Sequence from={audioDelay}>
                <Audio src={staticFile(card.audioFile)} />
              </Sequence>
            ) : null}
          </Sequence>
        )
      })}
      {/* Soft instrumental bed under everything: loops to fill the runtime.
          Starts from the VERY FIRST frame (short ~0.4s ramp so it's present
          under the opening, not a slow swell) and fades down under the close. */}
      {props.musicFile ? (
        <Audio
          src={staticFile(props.musicFile)}
          loop
          volume={(f) => {
            const base = interpolate(
              f,
              [
                0,
                Math.round(0.4 * fps),
                durationInFrames - Math.round(2.5 * fps),
                durationInFrames,
              ],
              [
                props.musicVolume * 0.7,
                props.musicVolume,
                props.musicVolume,
                0,
              ],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
            if (!videoWindow) return base
            // 1 everywhere except 0 across the video card (short edge fades).
            const duck = interpolate(
              f,
              [
                videoWindow.start - duckFade,
                videoWindow.start,
                videoWindow.end,
                videoWindow.end + duckFade,
              ],
              [1, 0, 0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            )
            return base * duck
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          opacity: blackout,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  )
}

function CardLayer({
  card,
  style,
  px,
  fps,
  headerDate,
  durationInFrames,
  showMuteButton,
  anim,
  staticCover,
  wideText,
  attribution,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  px: (n: number) => number
  fps: number
  headerDate: string
  durationInFrames: number
  showMuteButton: boolean
  anim: "block" | "letters"
  staticCover: boolean
  wideText?: "bottom" | "right"
  attribution?: string
}) {
  const frame = useCurrentFrame()
  // Owner rules: NO logo anywhere; the date appears ONLY on the cover (above
  // the title) — so non-cover cards render no header at all.
  return (
    <AbsoluteFill>
      <CardBody
        card={card}
        style={style}
        px={px}
        wideText={wideText}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        headerDate={headerDate}
        anim={anim}
        staticCover={staticCover}
        attribution={attribution}
      />
      {card.kind === "video" && card.subtitles?.length ? (
        <VideoSubtitles
          cues={card.subtitles}
          style={style}
          px={px}
          frame={frame}
          fps={fps}
        />
      ) : null}
      {showMuteButton ? <MuteButton px={px} style={style} /> : null}
    </AbsoluteFill>
  )
}
