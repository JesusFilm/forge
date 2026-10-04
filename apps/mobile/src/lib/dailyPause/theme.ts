// Pass 2 tokens, copied from the Figma frame "Pass 2 · Dark, pill stepper"
// (file 0x3kAiEt7C7kSHpg0f4wiD, node 343:2). The devotional uses these, not the
// app's BG_COLOR (#1c1917), because the frame draws on its own ground.

export const pauseColors = {
  /** Screen ground; also the text on ink-filled buttons and the active pill. */
  background: "#0c0b0a",
  /** Primary text, button and active-pill fill, the Pray ring stroke. */
  ink: "#f4efe6",
  /** Minutes line, check marks, scripture reference, section labels, switch on. */
  accent: "#f2c46b",
  /** Secondary text: customize link, waiting line, attribution, row subtitles. */
  muted: "#b7a99a",
  /** The outline of an upcoming pill. */
  pillBorder: "#3a342c",
  /** Done pill, unselected meditation time, switch off track. */
  raised: "#2a2824",
  /** The Customize sheet. */
  sheet: "#171614",
  /** The sheet's drag handle: ink at 20%. */
  handle: "rgba(244,239,230,0.2)",
  /** The Pray ring's seconds numeral, one step off ink in the frame. */
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
  handle: 2,
} as const

export const pauseSpacing = {
  screenTop: 48,
  screenBottom: 36,
  screenSide: 28,
  /** The gap between every item of a screen body column. */
  screenGap: 16,
  stepperGap: 10,
  pillPaddingX: 20,
  pillPaddingY: 12,
  /** Between a done pill's check mark and its label. */
  pillCheckGap: 8,
  buttonPaddingX: 28,
  buttonPaddingY: 16,
  /** The Opening's fixed gap between the minutes line and the question. */
  openingQuestionGap: 35,
  /** The Pray screen's fixed gap between the stepper and the ring box. */
  prayRingGap: 87,
  /** The Pray screen's empty box between the attribution and Amen. */
  prayButtonGap: 42,
  /** The Share screen's fixed top spacer and its spacer above the button. */
  shareTop: 264,
  shareButtonGap: 17,
  /** The Customize screen's dimmed header: top inset and line gap. */
  customizeHeaderTop: 48,
  customizeHeaderGap: 8,
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
  handleWidth: 40,
  handleHeight: 4,
  switchWidth: 52,
  switchHeight: 32,
  switchKnob: 26,
  switchKnobInset: 3,
  /** The Pray ring box spans the column; the ring itself is drawn 114 x 109. */
  prayRingBoxHeight: 121,
  prayRingWidth: 114,
  prayRingHeight: 109,
  prayRingStroke: 5,
  progressBarHeight: 3,
  /** The Customize header's opacity while the sheet is up. */
  customizeHeaderOpacity: 0.45,
} as const
