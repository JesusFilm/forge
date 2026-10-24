export function getWebVttCueText(cue: VTTCue): string {
  return cue.getCueAsHTML().textContent ?? ""
}
