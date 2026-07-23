import { AbsoluteFill, interpolate, useVideoConfig } from "remotion"

import type { DevotionalCard } from "./schema"
import type { DevotionalStyle } from "./styles"
import {
  BrandMark,
  LetterReveal,
  SANS,
  SERIF,
  reveal,
  textAnchorFor,
  usesPanelFrost,
} from "./visual-primitives"
import { CoverIntro, Eyebrow, FrostPanel, withHighlight } from "./card-chrome"

function CardBody({
  card,
  style,
  px,
  frame,
  fps,
  durationInFrames,
  headerDate,
  anim,
  staticCover,
  wideText,
  attribution,
}: {
  card: DevotionalCard
  style: DevotionalStyle
  px: (n: number) => number
  frame: number
  fps: number
  durationInFrames: number
  headerDate: string
  anim: "block" | "letters"
  staticCover: boolean
  wideText?: "bottom" | "right"
  attribution?: string
}) {
  const { width: vw, height: vh } = useVideoConfig()
  const isLandscape = vw > vh
  const pad = `${px(44)}px ${px(34)}px`
  // Breathing room above the bottom edge for bottom-anchored text. Owner rule:
  // bottom text can sit LOWER — landscape 48px (px(17.35)), portrait ~78px
  // (px(28)) from the frame edge (was px(84) ≈ 232px, too high off the bottom).
  const padBottom = isLandscape ? px(17.35) : px(28)
  const letters = anim === "letters"

  if (card.kind === "cover") {
    // Unified cover for BOTH orientations, reproduced from the Claude Design
    // spec: the red Jesus Film symbol, headline, and date stacked and centered
    // on the sharp footage (Background paints the dark wash + vignette). The
    // rotation styles still GRADE the footage; only the cover LAYOUT is unified.
    // NOTE: this reintroduces the logo — but ONLY on the cover card.
    const title = withHighlight(card.title ?? "", card.highlight, style)
    return (
      <CoverIntro
        px={px}
        frame={frame}
        fps={fps}
        durationInFrames={durationInFrames}
        title={title}
        date={headerDate}
        staticCover={staticCover}
        isLandscape={isLandscape}
        attribution={attribution}
      />
    )
  }

  if (card.kind === "scripture") {
    const verse = (
      <div
        style={{
          fontFamily: SANS,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: px(32),
          lineHeight: 1.36,
          color: style.heading,
        }}
      >
        {letters ? (
          <LetterReveal
            text={card.verse ?? ""}
            highlight={card.highlight}
            style={style}
            frame={frame}
            fps={fps}
            delaySec={0.4}
          />
        ) : (
          withHighlight(card.verse ?? "", card.highlight, style)
        )}
      </div>
    )
    const citation = card.citation ? (
      <div
        style={{
          marginTop: px(22),
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: px(12),
          letterSpacing: px(2.4),
          color: style.eyebrow,
          ...reveal(frame, fps, 0.8, 1, "fade"),
        }}
      >
        {card.citation.toUpperCase()}
      </div>
    ) : null

    if (style.scripture === "quoteCenter") {
      return (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            padding: `${px(40)}px ${px(34)}px`,
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: px(90),
              lineHeight: 0.6,
              color: style.rule,
              marginBottom: px(10),
              ...reveal(frame, fps, 0.35, 1, "zoom"),
            }}
          >
            &ldquo;
          </div>
          <div style={{ ...reveal(frame, fps, 0.6, 1, "up") }}>{verse}</div>
          {citation}
        </AbsoluteFill>
      )
    }
    // grain: left rule; sepia: bottom accent bar
    const bottom = style.scripture === "frostedBottom"
    return (
      <AbsoluteFill
        style={{
          justifyContent: bottom ? "flex-end" : "center",
          padding: bottom
            ? `${px(48)}px ${px(28)}px ${padBottom}px`
            : `0 ${px(30)}px`,
        }}
      >
        {bottom ? (
          <div
            style={{
              width: px(48),
              height: px(4),
              background: style.rule,
              marginBottom: px(22),
              ...reveal(frame, fps, 0.5, 1, "growLine"),
            }}
          />
        ) : null}
        <div style={{ display: "flex", gap: px(18), alignItems: "stretch" }}>
          {!bottom ? (
            <div
              style={{
                width: px(6),
                flex: "0 0 auto",
                background: style.rule,
                ...reveal(frame, fps, 0.5, 1, "growV"),
              }}
            />
          ) : null}
          <div style={{ ...reveal(frame, fps, 0.35, 1, "up") }}>{verse}</div>
        </div>
        {citation}
      </AbsoluteFill>
    )
  }

  if (card.kind === "reflection-full") {
    // Show the paragraphs ONE AFTER ANOTHER — each fades in, holds, fades out
    // as the next arrives (the closing line stays up to the end). Windows are
    // proportional to each chunk's length across the card's narration, so the
    // text on screen tracks the voice. Only one chunk is ever visible, so the
    // card never overflows regardless of frame height.
    const chunks = [
      ...(card.paragraphs ?? []).map((text) => ({ text, closing: false })),
      ...(card.closing ? [{ text: card.closing, closing: true }] : []),
    ]
    const totalChars = chunks.reduce((s, c) => s + c.text.length, 0) || 1
    const fadeF = Math.round(0.6 * fps)
    let acc = 0
    const windows = chunks.map((c) => {
      const start = (acc / totalChars) * durationInFrames
      acc += c.text.length
      const end = (acc / totalChars) * durationInFrames
      return { start, end }
    })
    const anchor = textAnchorFor(card.kind, style)
    const panel = usesPanelFrost(card.kind, style)
    return (
      <AbsoluteFill>
        {chunks.map((c, i) => {
          const w = windows[i]
          const isLast = i === chunks.length - 1
          // Cap the fade so a short chunk's window keeps its four keyframes
          // strictly increasing (interpolate requires monotonic input).
          const win = Math.max(1, w.end - w.start)
          const ff = Math.min(fadeF, win * 0.4)
          // In letters mode the per-character reveal supplies the entrance, so
          // the container appears instantly (letters carry the fade-in) and only
          // fades OUT as the next chunk arrives.
          const opacity = letters
            ? interpolate(
                frame,
                [w.start, w.start + 1, w.end - ff, w.end],
                [0, 1, 1, isLast ? 1 : 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            : interpolate(
                frame,
                [w.start, w.start + ff, w.end - ff, w.end],
                [0, 1, 1, isLast ? 1 : 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
          const lift = interpolate(
            frame,
            [w.start, w.start + ff],
            [px(18), 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
          const content = (
            <>
              <Eyebrow px={px} color={style.eyebrow}>
                Reflect
              </Eyebrow>
              <p
                style={{
                  margin: 0,
                  fontFamily: SANS,
                  fontStyle: c.closing ? "italic" : "normal",
                  fontWeight: c.closing ? 500 : 400,
                  fontSize: px(c.closing ? 34 : 26),
                  lineHeight: c.closing ? 1.2 : 1.5,
                  color: c.closing ? style.closing : style.body,
                }}
              >
                {letters ? (
                  <LetterReveal
                    text={c.text}
                    style={style}
                    frame={frame}
                    fps={fps}
                    delaySec={w.start / fps + 0.15}
                  />
                ) : (
                  c.text
                )}
              </p>
            </>
          )
          // Panel-frost: text in a frosted rectangle — centered, or anchored to
          // the bottom when the layout is bottom-aligned.
          if (panel) {
            return (
              <AbsoluteFill
                key={i}
                style={{
                  justifyContent: style.textBottom ? "flex-end" : "center",
                  padding: pad,
                  paddingBottom: style.textBottom ? padBottom : undefined,
                  opacity,
                  transform: `translateY(${lift}px)`,
                }}
              >
                <FrostPanel px={px}>{content}</FrostPanel>
              </AbsoluteFill>
            )
          }
          // Otherwise each paragraph anchors to its band (top grain, bottom sepia).
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: px(34),
                right: px(34),
                ...(anchor === "bottom"
                  ? { bottom: padBottom }
                  : { top: px(120) }),
                opacity,
                transform: `translateY(${lift}px)`,
              }}
            >
              {content}
            </div>
          )
        })}
      </AbsoluteFill>
    )
  }

  if (card.kind === "reflection-focus") {
    const frosted = usesPanelFrost(card.kind, style)
    // When the card has its own title (e.g. "Keep Walking"), show it as a
    // heading above the text; otherwise fall back to the "Reflect" eyebrow.
    const heading = card.title ? (
      <div style={reveal(frame, fps, 0.15, 1, "down")}>
        {card.sectionLabel ? (
          <Eyebrow px={px} color={style.eyebrow} size={11} mb={12}>
            {card.sectionLabel}
          </Eyebrow>
        ) : null}
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: px(24),
            letterSpacing: px(-0.2),
            color: style.heading,
            marginBottom: px(14),
          }}
        >
          {card.title}
        </div>
      </div>
    ) : card.sectionLabel === "" ? null : (
      // sectionLabel "" suppresses the label (used on 2nd+ reflection cards so
      // "Reflect" shows once); undefined falls back to "Reflect" (back-compat).
      <Eyebrow px={px} color={style.eyebrow}>
        <span style={reveal(frame, fps, 0.15, 1, "down")}>
          {card.sectionLabel || "Reflect"}
        </span>
      </Eyebrow>
    )
    const inner = (
      <>
        {heading}
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontWeight: 400,
            // Owner-picked sizes: right panel 55px, bottom band 60px (desktop
            // 16:9); portrait keeps the original 69px (px scales by short side).
            fontSize:
              wideText === "right"
                ? px(20)
                : wideText === "bottom"
                  ? px(22)
                  : px(25),
            lineHeight: 1.46,
            color: style.body,
            ...(letters ? {} : reveal(frame, fps, 0.35, 1, "up")),
          }}
        >
          {letters ? (
            <LetterReveal
              text={card.text ?? ""}
              highlight={card.highlight}
              style={style}
              frame={frame}
              fps={fps}
              delaySec={0.5}
            />
          ) : (
            withHighlight(card.text ?? "", card.highlight, style)
          )}
        </p>
      </>
    )
    // Landscape: the text sits ON the blur — bottom band → flex-end, right
    // panel → vertically centered (owner rule: never mid-frame off the blur).
    // Portrait: bottom → flex-end; paneled non-bottom → centered; plain
    // non-bottom → TOP (regular reflections never center without a panel).
    const topAnchored = !wideText && !style.textBottom && !frosted
    const justify = wideText
      ? wideText === "bottom"
        ? "flex-end"
        : "center"
      : style.textBottom
        ? "flex-end"
        : topAnchored
          ? "flex-start"
          : "center"
    return (
      <AbsoluteFill
        style={{
          justifyContent: justify,
          padding: pad,
          paddingTop: topAnchored ? px(120) : undefined,
          // Owner rule (bottom band): 48px from the last line to the frame
          // edge at 1080p — px(17.35) ≈ 48px. Reflection text is LEFT-aligned
          // (owner: centered reflection is hard to read) — ragged right.
          paddingBottom:
            wideText === "bottom"
              ? px(17.35)
              : style.textBottom
                ? padBottom
                : undefined,
          textAlign: wideText === "bottom" ? "left" : undefined,
        }}
      >
        {frosted ? <FrostPanel px={px}>{inner}</FrostPanel> : inner}
      </AbsoluteFill>
    )
  }

  if (card.kind === "conclusion") {
    // The emotional ending: always centered on the blurred background, whatever
    // the layout — a held, highlighted closing beat (not bottom-anchored, not in
    // a frost panel).
    const body = (
      <>
        {style.pullquote === "glyph" ? (
          <div
            style={{
              fontFamily: SERIF,
              fontSize: px(96),
              lineHeight: 0.55,
              color: style.rule,
              height: px(50),
              ...reveal(frame, fps, 0.25, 1, "zoom"),
            }}
          >
            &ldquo;
          </div>
        ) : (
          <div
            style={{
              width: px(48),
              height: px(4),
              background: style.rule,
              marginBottom: px(28),
              ...reveal(frame, fps, 0.3, 1, "growLine"),
            }}
          />
        )}
        <p
          style={{
            margin: 0,
            fontFamily: SANS,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: px(41),
            lineHeight: 1.18,
            letterSpacing: px(-0.4),
            color: style.body,
            ...(letters ? {} : reveal(frame, fps, 0.45, 1, "up")),
          }}
        >
          {letters ? (
            <LetterReveal
              text={card.text ?? ""}
              highlight={card.highlight}
              style={style}
              frame={frame}
              fps={fps}
              delaySec={0.5}
            />
          ) : (
            withHighlight(card.text ?? "", card.highlight, style)
          )}
        </p>
        {style.pullquote === "glyph" ? (
          <div
            style={{
              marginTop: px(30),
              width: px(48),
              height: px(2),
              background: style.rule,
              ...reveal(frame, fps, 0.9, 1, "fade"),
            }}
          />
        ) : null}
        {style.pullquote === "bars" ? (
          <div
            style={{
              marginTop: px(30),
              width: px(48),
              height: px(4),
              background: style.rule,
              ...reveal(frame, fps, 0.9, 1, "fade"),
            }}
          />
        ) : null}
      </>
    )
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: pad,
        }}
      >
        {body}
      </AbsoluteFill>
    )
  }

  if (card.kind === "video") {
    // Dedicated Birth-of-Jesus clip plays clear (rendered by Background); no
    // text overlay so the film reads as itself.
    return null
  }

  if (card.kind === "cta") {
    // Teaser end-card: brand mark, a call to watch, the link + handle. Centered
    // on the blurred background, appears smoothly.
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: pad,
        }}
      >
        <div style={{ ...reveal(frame, fps, 0.15, 1, "up") }}>
          <BrandMark px={px} />
        </div>
        <p
          style={{
            margin: `${px(26)}px 0 ${px(18)}px`,
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: px(38),
            lineHeight: 1.15,
            letterSpacing: px(-0.4),
            color: style.heading,
            maxWidth: px(320),
            ...reveal(frame, fps, 0.35, 1, "up"),
          }}
        >
          {card.ctaHeadline ?? "Watch the full devotional"}
        </p>
        {card.ctaUrl ? (
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: px(22),
              color: style.eyebrow,
              ...reveal(frame, fps, 0.55, 1, "fade"),
            }}
          >
            {card.ctaUrl}
          </div>
        ) : null}
        {card.ctaHandle ? (
          <div
            style={{
              marginTop: px(10),
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: px(15),
              letterSpacing: px(0.3),
              color: style.secondary,
              ...reveal(frame, fps, 0.7, 1, "fade"),
            }}
          >
            {card.ctaHandle} · link in bio
          </div>
        ) : null}
      </AbsoluteFill>
    )
  }

  // questions + prayer — questions animate in one by one, then the prayer
  const questions = card.questions ?? []
  // Landscape (16:9): the frame is half as tall — scale this text-dense card
  // down a notch so question + prayer clear the header and the bottom edge.
  const q = (n: number) => (isLandscape ? px(n * 0.8) : px(n))
  // Prayer appears well after the questions — a 5s beat to sit with them first.
  const prayerDelay = 5
  // Questions + prayer are text-heavy: always centered on the blurred background
  // (no panel), independent of layout — same treatment as the conclusion.
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        // Landscape: top padding clears the header logo/date row.
        padding: isLandscape ? `${px(64)}px ${px(34)}px ${px(28)}px` : pad,
      }}
    >
      <Eyebrow px={px} color={style.eyebrow} size={12}>
        <span style={reveal(frame, fps, 0.15, 1, "down")}>Ask yourself</span>
      </Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: q(22) }}>
        {questions.map((text, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: q(14),
              alignItems: "baseline",
              ...reveal(frame, fps, 0.3 + i * 0.35, 1, "up"),
            }}
          >
            {questions.length > 1 ? (
              // Number only when there are multiple questions; a single question
              // shows no "1." prefix.
              <span
                style={{
                  flex: "0 0 auto",
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: q(19),
                  color: style.eyebrow,
                }}
              >
                {i + 1}
              </span>
            ) : null}
            <p
              style={{
                margin: 0,
                fontFamily: SANS,
                fontWeight: 400,
                fontSize: q(26),
                lineHeight: 1.36,
                color: style.body,
              }}
            >
              {text}
            </p>
          </div>
        ))}
      </div>
      {card.prayer ? (
        <div
          style={{
            marginTop: q(32),
            ...reveal(frame, fps, prayerDelay, 1, "fade"),
          }}
        >
          <div
            style={{
              width: q(48),
              height: style.pullquote === "bars" ? px(4) : px(1),
              background: style.rule,
              marginBottom: q(22),
            }}
          />
          <Eyebrow px={px} color={style.eyebrow} size={12} mb={14}>
            Pray
          </Eyebrow>
          <p
            style={{
              margin: 0,
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: q(22),
              lineHeight: 1.56,
              color: style.body,
            }}
          >
            {card.prayer}
          </p>
        </div>
      ) : null}
      {/* The star-orbit progress ring is rendered as a FULL-FRAME overlay in the
          main composition (QuestionsProgressRing), NOT here — inside this card it
          would be trapped in the landscape text column and could never reach the
          frame's bottom-right corner. */}
    </AbsoluteFill>
  )
}

export { CardBody }
