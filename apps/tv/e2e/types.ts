export type DpadDirection = "up" | "down" | "left" | "right" | "select" | "back"

export type FlowStep =
  | { dpad: DpadDirection }
  | { wait: number }
  | { screenshot: string }
  | { launch: string }
  | { delay: number }

export type FlowDefinition = {
  name: string
  platform: Array<"tvos" | "androidtv">
  steps: FlowStep[]
}

export type StepResult = {
  step: FlowStep
  success: boolean
  error?: string
  screenshotPath?: string
}

export type FlowResult = {
  name: string
  platform: "tvos" | "androidtv"
  steps: StepResult[]
  success: boolean
  duration: number
}

export interface TVAdapter {
  readonly platform: "tvos" | "androidtv"

  /** Send a D-pad direction command */
  sendDpad(direction: DpadDirection): Promise<void>

  /** Capture a screenshot and save to the given path */
  captureScreenshot(outputPath: string): Promise<void>

  /** Launch an app by bundle ID */
  launchApp(bundleId: string): Promise<void>

  /** Check if the adapter's requirements are met */
  checkAvailability(): Promise<void>
}

export const DEFAULT_STEP_DELAY_MS = 200
