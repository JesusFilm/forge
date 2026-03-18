export const FOREGROUND_POLL_DELAY_MS = 5_000
export const BACKGROUND_POLL_DELAY_MS = 30_000

type PollResultGateInput = {
  cancelled: boolean
  activeRequestSeq: number
  responseSeq: number
  aborted: boolean
}

export function getNextPollDelayMs(isDocumentHidden: boolean): number {
  return isDocumentHidden ? BACKGROUND_POLL_DELAY_MS : FOREGROUND_POLL_DELAY_MS
}

export function shouldApplyPollResult({
  cancelled,
  activeRequestSeq,
  responseSeq,
  aborted,
}: PollResultGateInput): boolean {
  if (cancelled) return false
  if (aborted) return false
  return responseSeq === activeRequestSeq
}
