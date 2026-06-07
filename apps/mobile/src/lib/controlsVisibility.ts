/**
 * Pure (visible, mounted) transition table for the auto-hiding video chrome.
 *
 * The imperative hook `useControlsVisibility` runs the fade/timer/listener side
 * effects, but it delegates *what the logical visibility state becomes* to this
 * function — so the fade-race invariants are unit-testable without the RN
 * runtime (the hook itself is verified in the simulator, R19).
 *
 * `visible` is the logical ground truth (the hook mirrors it into a ref that
 * native callbacks read); `mounted` drives whether the chrome layer is in the
 * tree at all. They diverge during a fade: the chrome is logically hidden the
 * instant the hide starts, yet stays mounted until the fade finishes.
 *
 * Invariants this encodes (the bugs ce-code-review #7 fixed):
 *  - `hideStart` (idle timer fired, or explicit tap-to-hide): logically hidden
 *    NOW, still mounted for the fade. A tap landing mid-fade therefore reads
 *    "hidden" and routes to `reveal`, instead of falling through into a hide it
 *    should have cancelled.
 *  - `hideDone` (fade-out completed): unmount ONLY if still logically hidden. A
 *    `reveal`/interaction during the fade flips `visible` back true, making the
 *    completion stale — it must leave the chrome mounted (the `if (finished)` +
 *    interaction guard, expressed as a pure rule).
 *  - `reveal` (tap-while-hidden, control interaction, buffering, screen-reader
 *    on, foreground resume): always fully visible + mounted, cancelling any
 *    pending hide.
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
