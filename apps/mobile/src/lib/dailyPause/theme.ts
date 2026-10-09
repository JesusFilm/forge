// Pass 2 tokens, copied from the Figma frame "Pass 2 · Dark, pill stepper"
// (file 0x3kAiEt7C7kSHpg0f4wiD, node 343:2). The devotional uses these, not the
// app's BG_COLOR (#1c1917), because the frame draws on its own ground.
import type { PauseTextType } from "./fonts"

export const pauseColors = {
  /** Screen ground; also the text on ink-filled buttons and the active pill. */
  background: "#0c0b0a",
  /** Primary text, button and active-pill fill, the countdown ring stroke. */
  ink: "#f4efe6",
  /** Minutes line, check marks, verse reference, attribution, section labels,
   *  switch on. */
  accent: "#f2c46b",
  /** Secondary text: customize link, waiting line, row subtitles. */
  muted: "#b7a99a",
  /** The outline of an upcoming pill. */
  pillBorder: "#3a342c",
  /** Done pill, unselected meditation time, switch off track. */
  raised: "#2a2824",
  /** The Customize sheet. */
  sheet: "#171614",
  /** The countdown ring's seconds numeral, one step off ink in the frame. */
  ringNumeral: "#f4ede4",
  /** The switch-off knob and the played part of the video progress bar. */
  white: "#ffffff",
  /** The unplayed part of the video progress bar. */
  progressTrack: "rgba(255,255,255,0.35)",
} as const

export const pauseRadii = {
  /** Primary button, the Customize sheet, and its Done button. */
  button: 28,
  pill: 24,
  /** A meditation time segment. */
  segment: 22,
  switchTrack: 16,
} as const

export const pauseSpacing = {
  screenTop: 48,
  screenBottom: 36,
  screenSide: 28,
  /** The gap between every item of a screen body column. */
  screenGap: 16,
  pillPaddingX: 20,
  pillPaddingY: 12,
  /** Between a done pill's check mark and its label. */
  pillCheckGap: 8,
  buttonPaddingX: 28,
  buttonPaddingY: 16,
  /** The Opening's fixed gap between the minutes line and the question. */
  openingQuestionGap: 35,
  /** The Reflect and Pray screens' fixed gap between the stepper and the
   *  ring box. */
  ringGap: 87,
  /** The Pray screen's empty box between the attribution and Amen. */
  prayButtonGap: 42,
  /** The Reflect screen's gap between its scroll view and Continue, and the
   *  lift of Continue off the bottom edge (the owner, 2026-10-07). */
  reflectButtonGap: 32,
  reflectButtonLift: 40,
  /** The Share screen's fixed top spacer and its spacer above the button. */
  shareTop: 264,
  shareButtonGap: 17,
  sheetPaddingX: 20,
  sheetPaddingTop: 14,
  sheetPaddingBottom: 24,
  sheetGap: 14,
  segmentGap: 8,
  segmentPaddingY: 12,
  /** Between a settings row's title and its subtitle. */
  rowCopyGap: 3,
  doneButtonPaddingY: 15,
} as const

export const pauseSizes = {
  handleHeight: 4,
  switchWidth: 52,
  switchHeight: 32,
  switchKnob: 26,
  switchKnobInset: 3,
  /** The countdown ring's box spans the column; the frame draws 114 x 109. */
  ringBoxHeight: 121,
  ringWidth: 114,
  ringStroke: 5,
  progressBarHeight: 3,
} as const

/** One style per text type, so a type has the same size on every screen (the
 *  owner, 2026-10-07). Apply one with `pauseText(font, pauseType.<type>)`. */
export const pauseType = {
  /** The Reflect verse and the Pray prayer text. */
  reading: { face: "bodyLightItalic", fontSize: 22, lineHeight: 32 },
  /** Small capitals: the verse reference, the attribution, section labels,
   *  and text links. */
  label: {
    face: "sansSemiBold",
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  /** "DAILY BIBLE PAUSE" over a screen or a card. */
  eyebrow: { face: "sansMedium", fontSize: 12, letterSpacing: 2.6 },
  /** A short line under the reading text. */
  note: { face: "bodyItalic", fontSize: 16 },
  /** A message that a video could not load or start. */
  message: { face: "bodyLight", fontSize: 16 },
  /** The label of every pill button in a run. */
  button: { face: "sansSemiBold", fontSize: 18 },
} as const satisfies Record<string, PauseTextType>
