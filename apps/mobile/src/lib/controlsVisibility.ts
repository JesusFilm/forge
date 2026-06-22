/**
 * Pure transition table for the auto-hiding video chrome, so the fade-race
 * invariants are unit-testable without the RN runtime (the imperative hook
 * `useControlsVisibility` runs the side effects; verified in simulator, R19).
 *
 * `visible` is logical ground truth; `mounted` keeps the chrome in the tree.
 * They diverge during a fade: hidden the instant hide starts, still mounted
 * until the fade finishes.
 *
 * Invariants (bugs ce-code-review #7 fixed):
 *  - `hideStart`: logically hidden NOW, still mounted for the fade, so a tap
 *    mid-fade reads "hidden" → `reveal` instead of falling into a hide it
 *    should have cancelled.
 *  - `hideDone`: unmount ONLY if still hidden — a mid-fade `reveal` flips
 *    `visible` true, making completion stale (must leave chrome mounted).
 *  - `reveal` (tap-while-hidden, interaction, buffering, screen-reader, resume):
 *    always visible + mounted, cancelling any pending hide.
 */
export type ControlsState = { visible: boolean; mounted: boolean }

export type ControlsEvent = "reveal" | "hideStart" | "hideDone"

export function nextControlsState(
  state: ControlsState,
  event: ControlsEvent,
): ControlsState {
  switch (event) {
    case "reveal":
      return { visible: true, mounted: true }
    case "hideStart":
      // Logically hidden immediately; stays mounted so the fade can play out.
      return { visible: false, mounted: true }
    case "hideDone":
      // Stale-completion guard: a reveal during the fade set visible=true, so
      // keep the chrome up; only a genuinely-still-hidden state unmounts.
      return state.visible
        ? { visible: true, mounted: true }
        : { visible: false, mounted: false }
  }
}
