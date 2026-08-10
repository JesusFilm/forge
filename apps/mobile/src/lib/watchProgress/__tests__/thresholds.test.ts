import {
  barFillRatio,
  isBarVisible,
  isCompleted,
  isResumeEligible,
  progressBarState,
  progressRatio,
  resumePositionSeconds,
} from "../thresholds"

describe("threshold table (KTD6 web parity)", () => {
  const table: Array<{
    position: number
    duration: number
    visible: boolean
    completed: boolean
    resume: boolean
  }> = [
    {
      position: 0,
      duration: 100,
      visible: false,
      completed: false,
      resume: false,
    },
    {
      position: 0.5,
      duration: 100,
      visible: false,
      completed: false,
      resume: false,
    },
    {
      position: 1,
      duration: 100,
      visible: true,
      completed: false,
      resume: true,
    },
    {
      position: 89.9,
      duration: 100,
      visible: true,
      completed: false,
      resume: true,
    },
    {
      position: 90,
      duration: 100,
      visible: true,
      completed: true,
      resume: false,
    },
    {
      position: 100,
      duration: 100,
      visible: true,
      completed: true,
      resume: false,
    },
  ]

  for (const { position, duration, visible, completed, resume } of table) {
    it(`${position}/${duration}s → visible=${visible} completed=${completed} resume=${resume}`, () => {
      const ratio = progressRatio(position, duration)
      expect(isBarVisible(ratio)).toBe(visible)
      expect(isCompleted(ratio)).toBe(completed)
      expect(isResumeEligible(ratio)).toBe(resume)
    })
  }

  it("snaps the completed bar to full", () => {
    expect(barFillRatio(progressRatio(93, 100))).toBe(1)
    expect(barFillRatio(progressRatio(50, 100))).toBe(0.5)
  })

  it("degrades bad inputs to zero", () => {
    expect(progressRatio(10, 0)).toBe(0)
    expect(progressRatio(Number.NaN, 100)).toBe(0)
    expect(progressRatio(10, Number.NaN)).toBe(0)
    expect(progressRatio(-5, 100)).toBe(0)
  })

  it("clamps over-duration positions to 1", () => {
    expect(progressRatio(120, 100)).toBe(1)
  })
})

describe("resumePositionSeconds", () => {
  it("resumes at the recorded position", () => {
    expect(resumePositionSeconds(42, 100)).toBe(42)
  })

  it("clamps to one second before the end", () => {
    expect(resumePositionSeconds(99.5, 100)).toBe(99)
    expect(resumePositionSeconds(150, 100)).toBe(99)
  })

  it("never returns a negative seek", () => {
    expect(resumePositionSeconds(-3, 100)).toBe(0)
    expect(resumePositionSeconds(2, 0.5)).toBe(0)
  })
})

describe("progressBarState (the bar surfaces' selector)", () => {
  it("renders no bar below 1 percent and for absent entries", () => {
    expect(
      progressBarState({ positionSeconds: 0.5, durationSeconds: 100 }).visible,
    ).toBe(false)
    expect(progressBarState(null).visible).toBe(false)
    expect(progressBarState(undefined).visible).toBe(false)
  })

  it("snaps completed entries to a full bar with no resume", () => {
    const state = progressBarState({
      positionSeconds: 95,
      durationSeconds: 100,
    })
    expect(state).toEqual({
      visible: true,
      fillRatio: 1,
      completed: true,
      resumeEligible: false,
    })
  })

  it("renders proportional fill with resume in between", () => {
    const state = progressBarState({
      positionSeconds: 42,
      durationSeconds: 100,
    })
    expect(state).toEqual({
      visible: true,
      fillRatio: 0.42,
      completed: false,
      resumeEligible: true,
    })
  })
})
