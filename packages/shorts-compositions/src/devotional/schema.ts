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
  // The stepper screen that names each stage before it starts. Appears up to
  // four times, once per stage, each time with the light landing on its step.
  "step",
] as const

/** The stepper's stages, in order. `stepIndex` on a `step` card points here. */
export const DEVOTIONAL_STEPS = ["READ", "WATCH", "REFLECT", "PRAY"] as const

export const devotionalCardSchema = z.object({
  kind: z.enum(DEVOTIONAL_CARD_KINDS),
  /** Per-card narration snippet (Option A). Video card has none (plays clip audio). */
  audioFile: z.string().optional(),
  durationSec: z.number().positive().optional(),
  /** Extra silent hold added to this card's on-screen time (seconds). */
  holdSec: z.number().nonnegative().optional(),
  /** Small section label shown above the title (e.g. "Reflect" on the first reflection card). */
  sectionLabel: z.string().optional(),
  /**
   * `step` cards only: which stage the light lands on (0 = READ). Everything
   * before it is already done (gold); everything after is still ahead (dim).
   * `-1` is the OPENING screen: every stage on, none lit, no light at all.
   */
  stepIndex: z.number().int().min(-1).optional(),
  /** `step` cards only: the stage labels, when not the default four. The
   *  clip-first structure runs WATCH / REFLECT / PRAY — the film has already
   *  played, so there is no READ to announce. `stepIndex` indexes THIS list. */
  steps: z.array(z.string().min(1)).min(2).optional(),
  /** `step` cards only: a line shown above the stack (the opening screen's
   *  spoken line). Revealed letter by letter, like the scripture verse. */
  headline: z.string().optional(),
  /**
   * `step` cards only: seconds of the card that pass BEFORE its narration
   * starts. The transition animation runs in this window, so the light has
   * landed by the time the voice names the step — the owner's note was that
   * starting both together made the steps "blink".
   */
  stepLeadSec: z.number().nonnegative().optional(),
  /** staticFile name of the clip for a `video` card (plays with its own sound). */
  videoFile: z.string().optional(),
  /**
   * How a portrait `video` card fits the 16:9 clip. `window` (default) is the
   * square window at the top with captions below it. `full` fills the whole
   * 9:16 frame — the clip-first structure, where the film is the opening and
   * gets the frame to itself; captions sit over the lower part of the picture.
   */
  videoFill: z.enum(["window", "full"]).optional(),
  /**
   * How a full-frame video card's captions arrive. `words` reveals word by
   * word with the accent flash the reflection uses; `words-lift` (the series
   * default) is the same reveal with the spoken word landing a tenth larger
   * and easing back to size as it cools.
   */
  captionStyle: z.enum(["words", "words-lift", "phrase"]).optional(),
  /** `phrase` captions: the piece's theme word, held in the accent colour
   *  every time it appears. */
  themeWord: z.string().optional(),
  /** Stretches of a full-frame film card shown as two panels: the whole 16:9
   *  frame on top, a close crop following the face underneath. */
  clipSplits: z
    .array(
      z.object({
        fromSec: z.number(),
        toSec: z.number(),
        /** Where the close panel looks: the nearest face, over time. */
        path: z
          .array(z.object({ atSec: z.number(), x: z.number(), y: z.number() }))
          .optional(),
      }),
    )
    .optional(),
  /**
   * Clip-first opening over the muted lead of the film card, so the viewer
   * knows this is a devotional and not a stray film clip. `cover`: the brand
   * mark, series name, rounded length and the three steps over a darkened
   * film, WATCH already lit; the other steps and the scrim leave as the sound
   * comes in. `bands`: the frame split into three bands, WATCH in colour with
   * the live film, REFLECT and PRAY desaturated below; WATCH grows to fill the
   * frame. Needs `mutedLeadSec` for its length.
   */
  intro: z.enum(["cover", "bands"]).optional(),
  /**
   * Where a full-frame portrait video card crops the 16:9 clip, over time: the
   * normalized x of the source the frame is centred on, as a PATH in seconds
   * from the clip's start, interpolated linearly between points. Absent means a
   * blind centre crop, which on a two-person shot lands between the people.
   * Two points a frame apart make an instant jump — how a cut is followed.
   */
  clipFocus: z
    .array(
      z.object({
        atSec: z.number().nonnegative(),
        x: z.number().min(0).max(1),
      }),
    )
    .optional(),
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
  /** Fixed-date occasion tag shown above the headline (e.g. "World
   *  Humanitarian Day"). Cover only; most days have none. */
  occasion: z.string().optional(), // cover
  verse: z.string().optional(), // scripture
  citation: z.string().optional(), // scripture
  /** Translation tag shown after the citation ("BSB"). */
  translation: z.string().optional(), // scripture
  paragraphs: z.array(z.string()).optional(), // reflection-full
  closing: z.string().optional(), // reflection-full emphasized line
  text: z.string().optional(), // reflection-focus / conclusion
  highlight: z.string().optional(), // phrase within text/title to accent
  questions: z.array(z.string()).optional(), // questions card
  prayer: z.string().optional(), // questions card
  askLabel: z.string().optional(), // questions card eyebrow (localized "Ask yourself")
  /** Source credit shown on THIS card. The cover carries it in the classic
   *  structure; the clip-first cut has no cover, so the closing card does. */
  attribution: z.string().optional(),
  prayLabel: z.string().optional(), // questions card prayer eyebrow (localized "Pray")
  ctaHeadline: z.string().optional(), // cta card, e.g. "Watch the full devotional"
  ctaHandle: z.string().optional(), // cta card, e.g. "@gospelmedialab"
  ctaUrl: z.string().optional(), // cta card, e.g. "jesusfilm.org/watch"
  /** Cover only: the settle line the voice speaks right after the hook (e.g.
   *  "Let's slow down and give Scripture our attention."). Shown under the
   *  title, easing in with a slight zoom, so the spoken line is also read. */
  settleLine: z.string().optional(),
  /** Video card only: seconds at the start where the clip plays SILENT while
   *  `leadLabel` is on screen, before its own audio eases in. */
  /**
   * Where to crop the background's 16:9 frame to fill a 9:16 card: the
   * normalized x of the face the shot is about (0 = left edge), as steps in
   * seconds from THIS card's start. Absent means the old behaviour, a blind
   * centre crop — which is right only when the subject happens to sit
   * mid-frame, and on a two-person shot lands in the GAP between them and
   * shows a shoulder and a wall.
   *
   * A list rather than one value because a card outlives the shot it opens on:
   * one eleven-second card here spans three cuts. Each entry begins at a cut in
   * the footage, so the crop jumps where the picture already jumps and the move
   * is invisible.
   */
  bgFocus: z
    .array(
      z.object({
        atSec: z.number().nonnegative(),
        x: z.number().min(0).max(1),
        /** Ease into this framing rather than cutting to it. Set when the move
         *  could not be placed on a cut in the footage: a cut hides a jump, a
         *  held shot does not, and a slow reframe reads as the camera adjusting
         *  rather than as the picture lurching. */
        ease: z.boolean().optional(),
      }),
    )
    .optional(),
  mutedLeadSec: z.number().nonnegative().optional(),
  /** Video card only: the line shown over that silent opening ("Let's watch"). */
  leadLabel: z.string().optional(),
  /** Real per-word times from the narration's own ElevenLabs alignment, in
   *  seconds from this card's audio start. When present the card reveals its
   *  text word by word in step with the voice; when absent it falls back to
   *  the pace-based reveal, so older manifests render exactly as before. */
  words: z
    .array(
      z.object({
        word: z.string(),
        startSec: z.number(),
        endSec: z.number(),
      }),
    )
    .optional(),
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
  /**
   * Film-grain tile size in px (default 260).
   *
   * The grain SVG is a 120x120 noise tile, so the 260px default upscales it
   * 2.2x and the result is soft and large rather than film-like. On the Good
   * Samaritan's sunlit desert that read as no grain at all.
   *
   * Opacity is NOT the lever, which is worth recording because it was tried
   * first: `grainMedia` is already 0.72, so any multiplier above ~1.39 clamps
   * at full opacity. Measured on that render, going from 1x to saturated moved
   * high-frequency luminance from 3.89 to 4.57, an 18% change that is invisible.
   * Shrinking the tile is what makes grain read.
   */
  grainSizePx: z.number().optional(),
  /**
   * CSS filter applied to the grain noise before it is blended, and the blend
   * mode used. Overrides the built-in dark-brown tint.
   *
   * These exist because the built-in tint turned out to be why grain was
   * invisible on bright footage: `brightness(0.32)` crushes the noise almost to
   * black, and a near-black layer in `overlay` just darkens the frame evenly
   * instead of modulating it. Neither opacity (saturated at 0.72 base) nor tile
   * size (260px vs 40px rendered pixel-identical frames) could compensate.
   */
  grainFilter: z.string().optional(),
  grainBlend: z.string().optional(),
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
  /**
   * Clip-first: a small progress ring in the top-right corner, clocking each
   * STEP (the film; the reflection with its takeaway and verse; the question
   * and prayer) so the dot completes one circle as the step ends. Replaces the
   * ring the closing card carries above its question.
   */
  stepRing: z.boolean().optional(),
  /**
   * Shape of the step clock when `stepRing` is on: the orbit ring in the
   * top-right corner (default), or a thin line across the top inside the
   * social safe area, the same glowing point travelling left to right.
   */
  stepProgress: z.enum(["ring", "bar"]).optional(),
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
  /** Cover only: skip the date entirely — no date box, logo sits alone. Used
   *  for social test cards where the date would be a distraction. */
  hideCoverDate: z.boolean().optional(),
  /** The video card CONTINUES the shared background take instead of starting
   *  its clip over.
   *
   *  A full devotional gives the video card its own curated window, so it
   *  rightly starts at frame 0 of its own file. A teaser plays ONE take: the
   *  same file is the backdrop under the text cards and then takes the frame.
   *  Starting it over there replays footage the viewer has just watched, which
   *  reads as the video restarting. Opt-in, so the full devotional's curated
   *  window is untouched. */
  continuousClip: z.boolean().optional(),
  /**
   * Seconds of the shared background take to skip before the first card that
   * uses it. The staged background opens with a 0.6s fade from black; under
   * the cover that reads as the video starting, but when the first card on
   * the take is the stepper (clip-first) it is a black flash after the film.
   */
  bgStartOffsetSec: z.number().nonnegative().optional(),
  /** Hold the text of the card BEFORE a video card on screen for this long as
   *  the video comes up (seconds).
   *
   *  Normally each card clears its text inside its own duration so two lines
   *  are never on screen together. A verse is different: it is worth reading
   *  while the scene it describes begins. Implemented as a longer dissolve into
   *  the video plus a suppressed text fade, not as an overlay, so the verse and
   *  the footage are genuinely cross-dissolving. */
  verseHoldIntoVideoSec: z.number().nonnegative().optional(),
  /** Cover only: no brand mark at all. The cover is a centred flex column, so
   *  dropping the logo row leaves the title alone in the middle of the frame —
   *  which is the point: a teaser has three seconds to be read, and a mark
   *  animating above the hook spends them. Full devotionals keep the logo. */
  hideCoverLogo: z.boolean().optional(),
  /** Cover only: leave the footage SHARP behind the title (no blur, lighter
   *  scrim). The blur exists so long text stays legible over moving footage; a
   *  cover carries one line, and on a teaser the footage is the thing being
   *  advertised. */
  coverBgSharp: z.boolean().optional(),
  /** Cover only: show the title + attribution from frame 0 while the logo
   *  animation still plays underneath (distinct from `staticCover`, which
   *  freezes the logo too). Social test cards want the title readable
   *  instantly but still want the logo stamp/morph to play. */
  coverTextStatic: z.boolean().optional(),
  /** Cover only: a short line shown under the title, same font treatment as
   *  the date. Fades in once the logo settles. */
  coverSecondaryLine: z.string().optional(),
  /** Cover only: text to show in the DATE's slot, with the date's exact type
   *  treatment, instead of the date itself ("Today's Devotional"). A dated
   *  cover ages a video the moment it is seen, which is wrong for a series
   *  meant to be watched whenever someone finds it. */
  coverDateLabel: z.string().optional(),
  /** Cover only: the TITLE animates in first, from frame 0, and the logo
   *  sequence is delayed so it begins about two seconds in. The default order
   *  is the reverse — logo, then date, then title — which leaves the first
   *  seconds of a scroll-stopping line unread while a mark animates. */
  coverTitleFirst: z.boolean().optional(),
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
  /** Typeface for the spoken-text cards (reflection/conclusion). "sans" is the
   *  established Inter; "serif" switches them to the editorial serif stack the
   *  owner asked to try. Cover/eyebrows/labels are unaffected. */
  textFont: z.enum(["sans", "serif"]).optional(),
  /** FILTER — color/grade/palette. Independent of `layout`.
   *  Active set: grain · tealorange · splittone. (teal/sepia kept for back-compat.) */
  style: z
    .enum(["grain", "tealorange", "splittone", "teal", "sepia", "cinema"])
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
