---
title: feat: Persist Watch player volume preference
type: feat
status: complete
date: 2026-08-04
---

# feat: Persist Watch player volume preference

## Overview

Persist the committed Watch player volume and mute state in browser storage so a
person who adjusts audio on one Watch page keeps the same setting when moving to
another Watch page. The change should apply to intentional playback, not muted
autoplay previews.

## Problem Frame

The Watch hero player currently initializes committed playback controls from
component defaults. If a viewer unmutes, mutes, or changes volume, that
configuration is lost on navigation because the next Watch page mounts a fresh
player instance. The feature needs a small app-wide client preference that is
safe under SSR, private browsing, malformed storage, and Mux element remounts.

## Requirements Trace

- R1. Save `muted` and `volume` after the viewer interacts with the committed
  Watch volume setting.
- R1a. Treat "Watch now" and "Tap to Unmute" as committed playback sound
  interactions because they are explicit user gestures that start audible
  playback before the custom chrome is visible.
- R2. Apply a valid saved setting when a new committed Watch player controls
  instance mounts on another page.
- R3. Ignore missing, malformed, or out-of-range saved settings.
- R4. Preserve muted autoplay preview behavior; do not make browse/home
  previews start with audible audio.
- R5. Keep React Compiler rules satisfied by mutating media handles through
  refs, not state-held props.
- R6. Handle browsers where programmatic `HTMLMediaElement.volume` writes are
  unsupported by preserving mute behavior and avoiding preference corruption.

## Scope Boundaries

- This plan targets `apps/web` Watch committed playback only.
- It does not persist home-page preview mute state.
- It does not introduce server-side user preferences or cross-device sync.
- It does not change language, subtitle, progress, or watch history storage
  contracts.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/watch/HeroPlayerControls.tsx` owns committed Watch
  chrome state, subscribes to Mux media events, and renders the volume/mute
  controls.
- `apps/web/src/components/watch/HeroPlayer.tsx` owns the pre-chrome "Watch now"
  and "Tap to Unmute" paths, which can start audible committed playback before
  the custom chrome has fully taken over.
- `apps/web/src/lib/viewer-id.ts`, `apps/web/src/lib/watch-progress-client.ts`,
  and `apps/web/src/lib/watch-home-carousel-sequence.ts` demonstrate the local
  pattern of best-effort `localStorage` access with failure tolerance.
- `apps/web/src/lib/subtitle-preference-client.ts` demonstrates small,
  dedicated preference helpers with focused unit tests.

### Institutional Learnings

- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
  documents that `HeroPlayerControls` should depend on the lifted `player`
  state for subscriptions while using refs for live media operations.
- `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`
  requires media mutations through refs when React Compiler immutability rules
  would reject mutating a state-held prop.
- `docs/solutions/design-patterns/persist-display-name-for-cold-load-label.md`
  reinforces that persisted app-wide preferences must avoid premature or
  unrelated writes that corrupt user intent.

### External References

- External research skipped. This is a bounded local UI persistence change with
  strong existing repo patterns. Browser media volume support is the one known
  platform caveat: some browsers, notably iOS Safari, may ignore or constrain
  programmatic `HTMLMediaElement.volume` writes, so mute persistence must remain
  correct even when exact volume restore is best-effort.

## Key Technical Decisions

- Use a small `localStorage` JSON preference with `{ muted, volume }`:
  app-wide within the browser and enough to restore the volume chrome without a
  server dependency.
- Keep the helper browser-safe and failure-tolerant: SSR returns `null`,
  malformed JSON returns `null`, and storage exceptions are swallowed.
- Apply preferences in `HeroPlayerControls` when a player attaches and recheck
  on early media readiness events if the same element normalizes defaults after
  metadata load. Mutate the live media element through `playerRef.current` to
  satisfy React Compiler immutability constraints.
- Persist on `volumechange`, explicit mute toggles, slider/keyboard volume
  changes, and pre-chrome sound-start gestures so the first intentional audible
  interaction is captured.
- Do not apply the preference to muted autoplay previews or decorative section
  videos, preserving autoplay policy and browse ergonomics.
- Store only valid observed media values. If a browser ignores a volume write,
  do not overwrite a saved preference with a false value solely because restore
  was unsupported; keep mute state authoritative and exact volume best-effort.

## Open Questions

### Resolved During Planning

- Should previews use the saved preference? No. The user request is about
  volume configuration across pages, and Watch previews intentionally stay muted
  for autoplay and browse safety.
- Should the preference be stored server-side? No. The current requirement is
  same-browser retention across pages; local storage is the smallest matching
  contract.
- Should the first "Watch now" / "Tap to Unmute" gesture count as a volume
  preference interaction? Yes. It is the viewer's first explicit committed
  playback sound interaction on the Watch page, before the chrome volume control
  is mounted.
- Should successful `?autoplay=1` committed playback write a preference? No.
  That path is a navigation continuation, not a new volume-setting interaction.
  It should rely on the already-saved preference from the originating chrome or
  prior sound interaction.
- What happens when exact volume restore is unsupported? Mute persistence
  remains required; volume persistence is best-effort and must not corrupt a
  previously valid saved value.

### Deferred to Implementation

- Exact storage key name: choose a stable app-scoped key during implementation.
- Exact event coverage: verify from tests which interaction paths need direct
  writes versus media-event writes.

## Implementation Units

- [x] **Unit 1: Add a Watch volume preference helper**

**Goal:** Centralize serialization, validation, and best-effort storage access
for Watch volume state.

**Requirements:** R1, R2, R3, R6

**Dependencies:** None

**Files:**

- Create: `apps/web/src/lib/watch-volume-preference.ts`
- Test: `apps/web/src/lib/watch-volume-preference.test.ts`

**Approach:**

- Define a narrow preference shape with boolean `muted` and finite `volume` in
  the media range `0..1`.
- Return `null` for SSR, missing storage, invalid JSON, invalid shape, or
  out-of-range volume.
- Swallow storage read/write exceptions so private browsing or quota failures do
  not break playback.
- Reject invalid observed values rather than clamping them; clamping would turn
  corrupt state into an apparently intentional preference.

**Patterns to follow:**

- `apps/web/src/lib/subtitle-preference-client.ts`
- `apps/web/src/lib/viewer-id.ts`

**Test scenarios:**

- Happy path: writing `{ muted: true, volume: 0.35 }` then reading returns the
  same values.
- Error path: malformed JSON returns `null`.
- Edge case: out-of-range volume returns `null`.
- Edge case: invalid `muted` type returns `null`.
- Error path: invalid volume writes do not create a stored preference.

**Verification:**

- Helper tests prove storage is valid, resilient, and browser-safe.

- [x] **Unit 2: Apply and persist preference in committed Watch chrome**

**Goal:** Make `HeroPlayerControls` restore saved volume state on mount and save
subsequent user changes.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/web/src/components/watch/HeroPlayerControls.tsx`
- Test: `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`

**Approach:**

- On player attachment, read the stored preference and apply it through
  `playerRef.current`.
- Recheck the preference on early readiness events such as `loadedmetadata` when
  the same live media element may have normalized `muted` or `volume` after the
  initial ref attachment. Keep this bounded so regular `volumechange` events do
  not fight user interaction or create repeated event churn.
- Keep React state (`muted`, `volume`) synchronized with the applied values so
  aria values and icons render correctly.
- Persist when the media emits `volumechange` and when the component directly
  mutates volume/mute from controls.
- Do not repeatedly write or mutate when the live media element already matches
  the stored preference.
- If the browser ignores a programmatic volume assignment, preserve the stored
  value and avoid writing the ignored live value back as though it were a user
  choice. Mute state can still be applied and persisted.

**Execution note:** Add characterization-style tests around current controls
before changing event subscription shape when needed.

**Patterns to follow:**

- `apps/web/src/components/watch/HeroPlayerControls.tsx` existing media event
  subscription pattern.
- `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`
  Pattern 1 for mutable media handles.

**Test scenarios:**

- Happy path: a stored `{ muted: true, volume: 0.25 }` applies to a newly
  mounted controls instance.
- Error path: corrupt stored JSON leaves the player defaults untouched.
- Integration: clicking the mute button stores the new muted state and volume;
  remounting controls applies that stored state to a new player.
- Happy path: keyboard volume change persists the new positive volume.
- Edge case: stored volume is reapplied after a simulated media readiness reset
  without causing repeated writes.
- Edge case: a simulated browser that ignores `volume` assignment keeps mute
  restore working and does not corrupt the stored volume preference.

**Verification:**

- Controls tests prove saved preferences survive unmount/remount and invalid
  storage does not affect playback.

- [x] **Unit 3: Capture pre-chrome sound-start gestures**

**Goal:** Persist the first intentional audible playback action even when it
occurs before custom chrome interaction.

**Requirements:** R1, R1a, R4

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/web/src/components/watch/HeroPlayer.tsx`
- Test: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`

**Approach:**

- Write `{ muted: false, volume: player.volume }` when the user explicitly
  starts sound through "Watch now" or "Tap to Unmute".
- Do not persist automatic muted preview activation.
- Do not persist failed autoplay attempts that were not user gestures.
- Inventory the committed sound-start paths in `HeroPlayer` while implementing.
  The visible pill paths should write because they express a fresh sound intent;
  successful `?autoplay=1` continuation should not write because it carries
  navigation state from an earlier interaction.

**Patterns to follow:**

- Existing `runSoundIntent` handling in
  `apps/web/src/components/watch/HeroPlayer.tsx`.

**Test scenarios:**

- Integration: clicking the pre-chrome sound pill still seeks/unmutes/plays in
  the existing iOS-safe order and stores `{ muted: false, volume: 1 }`.
- Regression: muted preview setup remains unchanged by the preference helper.
- Edge case: successful `?autoplay=1` committed playback does not overwrite a
  saved preference as a new interaction.

**Verification:**

- Hero player tests prove the first committed audible gesture writes the
  preference without changing preview behavior.

- [x] **Unit 4: Roadmap and validation**

**Goal:** Keep the repo execution record current and verify the touched scope.

**Requirements:** R1-R5

**Dependencies:** Units 1-3

**Files:**

- Create or modify:
  `docs/roadmap/platform/feat-334-watch-player-volume-preference.md`

**Approach:**

- Create the roadmap ticket if none exists, mark it in progress before work and
  complete after validation.
- Run focused tests for the helper, controls, and hero player.
- Run focused lint for touched files and Web typecheck.

**Test scenarios:**

- Test expectation: none -- roadmap metadata has no runtime behavior.

**Verification:**

- Roadmap ticket reflects completion and validation commands pass.

## System-Wide Impact

- **Interaction graph:** `HeroPlayer` captures the initial sound gesture;
  `HeroPlayerControls` applies and updates the preference during committed
  playback; preview surfaces remain separate.
- **Error propagation:** Storage errors are swallowed and playback continues
  with media defaults.
- **State lifecycle risks:** Preference application must be bounded to player
  attach and early readiness normalization so it survives media resets without
  fighting later user interactions.
- **API surface parity:** No server API or public route contract changes.
- **Integration coverage:** Remount tests cover the cross-page persistence
  behavior that unit-level helper tests cannot prove alone.
- **Unchanged invariants:** Muted autoplay preview, player progress, language
  preference, and subtitle preference behavior remain unchanged.

## Risks & Dependencies

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Invalid or stale storage breaks playback                | Validate shape and range; reject corrupt values                                                 |
| React Compiler rejects media mutation through props     | Mutate through `playerRef.current` and run focused ESLint                                       |
| Preference accidentally makes autoplay previews audible | Scope reads to committed Watch controls and writes to explicit sound gestures                   |
| First sound gesture before chrome is missed             | Persist inside `HeroPlayer` sound-intent path                                                   |
| Browser ignores exact volume writes                     | Keep mute authoritative, treat volume restore as best-effort, and avoid corrupting saved volume |

## Documentation / Operational Notes

- No operator rollout work is required. This is a client-side browser
  preference.
- The roadmap ticket should capture the touched files and verification results.

## Sources & References

- Related code: `apps/web/src/components/watch/HeroPlayerControls.tsx`
- Related code: `apps/web/src/components/watch/HeroPlayer.tsx`
- Related tests: `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`
- Related tests: `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- Related learning:
  `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
- Related learning:
  `docs/solutions/design-patterns/react-compiler-ref-and-setstate-patterns-20260513.md`
