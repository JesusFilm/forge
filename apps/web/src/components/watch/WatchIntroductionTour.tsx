"use client"

import type { RefObject } from "react"

export type WatchIntroductionTourProps = {
  open: boolean
  onSkip: () => void
  onComplete: () => void
  finalFocus: RefObject<HTMLElement | null>
}

/** U2 supplies the accessible visual tour without widening the eager shell. */
export function WatchIntroductionTour(_props: WatchIntroductionTourProps) {
  return null
}
