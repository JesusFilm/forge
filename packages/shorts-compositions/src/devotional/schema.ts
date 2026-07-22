// Pure zod schema + constants for the daily-devotional video composition.
// Self-contained and independent of the production "short" composition.
import { z } from "zod"

export const DEVOTIONAL_COMPOSITION_ID = "devotional"
/** Landscape 16:9 variant (desktop/YouTube) — same component, same props; the
 *  composition adapts layout by orientation. */
export const DEVOTIONAL_WIDE_COMPOSITION_ID = "devotional-wide"
export const DEVOTIONAL_WIDE_WIDTH = 1920
export const DEVOTIONAL_WIDE_HEIGHT = 1080
export const DEVOTIONAL_WIDTH = 1080
// 9:16 — the format all social platforms (Reels / TikTok / Shorts) want, so one
// render fits everywhere. `px()` scales by WIDTH (1080/390), so type + spacing
// are unchanged; only the vertical room differs from the old 9:19.5 frame.
export const DEVOTIONAL_HEIGHT = 1920
export const DEVOTIONAL_FPS = 30

export const DEVOTIONAL_CARD_KINDS = [
  "cover",
  "scripture",
  "video",
  "reflection-full",
  "reflection-focus",
  "conclusion",
  "questions",
  "cta", // teaser end-card: "watch the full devotional" + handle + link
] as const

export const devotionalCardSchema = z.object({
  kind: z.enum(DEVOTIONAL_CARD_KINDS),
  /** Per-card narration snippet (Option A). Video card has none (plays clip audio). */
  audioFile: z.string().optional(),
  durationSec: z.number().positive().optional(),
  /** Extra silent hold added to this card's on-screen time (seconds). */
  holdSec: z.number().nonnegative().optional(),
  /** Small section label shown above the title (e.g. "Reflect" on the first reflection card). */
  sectionLabel: z.string().optional(),
  /** staticFile name of the clip for a `video` card (plays with its own sound). */
  videoFile: z.string().optional(),
  /**
   * Timed captions for a `video` card, transcribed from the clip's own audio
   * (experimental subtitle bot). Rendered in the dark band just below the
   * fitted video window. Times are seconds relative to the clip's start.
   */
  subtitles: z
    .array(
      z.object({
        text: z.string(),
        startSec: z.number().nonnegative(),
        endSec: z.number().positive(),
      }),
    )
    .optional(),
  /**
   * Per-card background segment (staticFile name). Consecutive cards carry
   * consecutive footage from the source film, so the background flows as one
   * continuous take instead of the same clip repeating on every card. Falls
   * back to the top-level `bgFile` when absent.
   */
  bgFile: z.string().optional(),
  /** Length (seconds) of this card's `bgFile` clip. When set, the background is
   *  looped at this period so it never freezes if the card outlasts the clip. */
  bgDurationSec: z.number().positive().optional(),

  // ---- semantic content (used per kind) ----
  title: z.string().optional(), // cover
  verse: z.string().optional(), // scripture
  citation: z.string().optional(), // scripture
  paragraphs: z.array(z.string()).optional(), // reflection-full
  closing: z.string().optional(), // reflection-full emphasized line
  text: z.string().optional(), // reflection-focus / conclusion
  highlight: z.string().optional(), // phrase within text/title to accent
  questions: z.array(z.string()).optional(), // questions card
  prayer: z.string().optional(), // questions card
  ctaHeadline: z.string().optional(), // cta card, e.g. "Watch the full devotional"
  ctaHandle: z.string().optional(), // cta card, e.g. "@gospelmedialab"
  ctaUrl: z.string().optional(), // cta card, e.g. "jesusfilm.org/watch"
})

export type DevotionalCard = z.infer<typeof devotionalCardSchema>

export const devotionalInputPropsSchema = z.object({
  /** Human date shown in the header, e.g. "Dec 25". */
  headerDate: z.string().default("Dec 25"),
  /** Source credit for the reflection (e.g. "Adapted from Matthew Henry"),
   *  shown small on the cover and the closing questions card. */
  attribution: z.string().optional(),
  cards: z.array(devotionalCardSchema),
  audioDurationSec: z.number().positive(),
  /** Blurred/dimmed background clip (Birth of Jesus) shown behind every card. */
  bgFile: z.string().optional(),
  bgDurationSec: z.number().positive().optional(),
  /** Playback rate for the shared continuous background (default 1). The
   *  renderer sets it slightly below 1 when the source film is a touch shorter
   *  than the background timeline, so the ONE continuous take stretches to cover
   *  every card without running out / freezing. Imperceptible (~3–5%). */
  bgPlaybackRate: z.number().positive().optional(),
  /** Soft instrumental bed under the whole devotional (loops, fades in/out). */
  musicFile: z.string().optional(),
  /** Music bed level (0–1), low so narration stays on top. */
  musicVolume: z.number().min(0).max(1).default(0.28),
  /** Optional CSS filter to grade the background footage (overrides the style's
   *  own tint) — used for previewing color-grade options. */
  mediaFilterOverride: z.string().optional(),
  /** Optional CSS filter for the `video` card's clip (fitted view + blurred
   *  wings). The video card is natural color by default; set this to cool/tint
   *  warm source footage so it matches the graded text cards. */
  videoCardFilter: z.string().optional(),
  /** Text entrance animation: "block" (fade/slide whole lines) or "letters"
   *  (smooth letter-by-letter reveal). */
  textAnim: z.enum(["block", "letters"]).default("block"),
  /** Override the silent hold on the final card (seconds). Full devotionals use
   *  the built-in ~8s dwell; teasers set this low (~2s) to stay short. */
  outroHoldSec: z.number().nonnegative().optional(),
  /** Override the opening pause before the narration (seconds). Drives the
   *  cover's on-screen length and the first card's audio delay. Defaults to the
   *  built-in intro hold; samples set this to fit a fixed cover length. */
  introHoldSec: z.number().nonnegative().optional(),
  /** Hold the last frame clean instead of fading to black at the close. Used by
   *  cover-only samples and any clip that will be seam-spliced into a following
   *  shot rather than ending on black. */
  noEndFade: z.boolean().optional(),
  /** Mute the video card's clip audio and let the music bed play through it
   *  (instead of ducking to silence). Used for teasers so the loud clip audio
   *  doesn't jump against the quiet music. */
  muteVideoAudio: z.boolean().optional(),
  /** Peak volume for the video card's clip audio (0–1). When set, the music is
   *  NOT ducked (clip sits quietly under the bed) and the clip fades in/out
   *  slowly. Teasers use ~0.30. Background clips (behind text cards) play at
   *  HALF this, so the clip's ambient sound is present from the start (~0.15)
   *  and rises on the video card. Default full-devo behaviour is ~0.95 + duck. */
  videoAudioLevel: z.number().min(0).max(1).optional(),
  /** Play the text-card BACKGROUND clip audio (teasers). Off => backgrounds are
   *  music-only regardless of videoAudioLevel. Full devotionals leave this off. */
  bgAudio: z.boolean().default(false),
  /** LANDSCAPE (16:9) text placement: "bottom" = lower-third blur band,
   *  "right" = vertical blur panel on the right. Ignored in portrait. */
  wideText: z.enum(["bottom", "right"]).optional(),
  /** Render the cover's text with NO entrance animation (shown from frame 0).
   *  Teasers use this so the hook + eyebrow are readable instantly. */
  staticCover: z.boolean().optional(),
  /** Override the crossfade between non-video cards (seconds). Teasers raise it
   *  (~1.4s) so the opening dissolves — and the verse blur ramps in — slowly. */
  xfadeSec: z.number().nonnegative().optional(),
  /** Archival "film treatment" on the footage: highlight bloom/halation, a
   *  heavier film-grain layer, a deeper vignette, and a subtle film-frame edge.
   *  Turns dated source footage into a deliberate, timeless look. Off by
   *  default so existing devotionals are unaffected. */
  filmTreatment: z.boolean().default(false),
  /** Manual override for the teal-orange split-tone blend layers. Normally left
   *  unset — the chosen `style` filter decides (tealorange/splittone bake it in).
   *  Set explicitly only to force split-tone on/off regardless of filter. */
  splitTone: z.boolean().optional(),
  /** Scales the text-blur strength (the backdrop blur behind reflection/
   *  conclusion/questions text). Default 1. Used to preview softer blur levels
   *  (e.g. 0.9 = 10% less). */
  blurScale: z.number().positive().optional(),
  /** FILTER — color/grade/palette. Independent of `layout`.
   *  Active set: grain · tealorange · splittone. (teal/sepia kept for back-compat.) */
  style: z
    .enum(["grain", "tealorange", "splittone", "teal", "sepia"])
    .default("grain"),
  /** LAYOUT — arrangement (header, cover, scripture, text anchor, panels).
   *  Independent of `style`: any layout pairs with any filter. When omitted,
   *  each filter falls back to its native layout (grain→centered,
   *  teal→editorial, sepia→classic) so existing devotionals are unchanged. */
  layout: z
    .enum(["centered", "editorial", "classic", "grounded", "grounded-panel"])
    .optional(),
  /**
   * Whether to paint the decorative mute icon (bottom-right). Baked into flat
   * MP4s (social); turned OFF for the interactive web player, where a real
   * control wired to the <video> element handles mute/unmute.
   */
  showMuteButton: z.boolean().default(true),
})

export type DevotionalInputProps = z.infer<typeof devotionalInputPropsSchema>
