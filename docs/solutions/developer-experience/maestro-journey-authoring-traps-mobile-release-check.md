---
title: Maestro traps when you write or repair a mobile release check journey
date: 2026-10-27
last_updated: 2026-10-28
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Writing or repairing a journey in apps/mobile/release-check/journeys/ through `session try`"
  - "A journey passes on the iPhone but fails on the iPad Pro 13, or a tap closes a sheet that the journey still needs"
  - "A journey step passes, but nothing on the screen proves that the step did its work"
  - "A throwaway probe journey needs a fixed hold or a screenshot"
  - "A journey passes on some tries and fails on others (a flaky journey)"
  - "A journey must tap inside a short window, for example player controls that hide 3 seconds after a tap"
retire_when: "Maestro (2.11.0 on the owner's Mac) or iOS 26 changes how a text selector matches, where a tap outside a sheet goes, or how long tapOn and extendedWaitUntil wait; check the Maestro release notes and the iOS release notes, then try the affected journeys through `session try`"
tags:
  [
    maestro,
    release-check,
    journey,
    e2e,
    ios-26,
    ipad,
    ui-automation,
    mobile,
    flaky,
  ]
---

# Maestro traps when you write or repair a mobile release check journey

## Context

The mobile release check (feat-798, added in PR #2919) runs fixed Maestro journeys from `apps/mobile/release-check/journeys/` on five test devices. Claude wrote and repaired the journeys through `node apps/mobile/release-check/cli.mjs session up|try|down` on the five test devices: the iPhone SE, the iPhone 17 Pro Max, the iPad Pro 13, and the Android phone and tablet emulators. Each trap below cost at least one failed try, or gave a pass that proved nothing.

The journeys keep a short comment at each place where a trap occurs. The README's journey rules (`apps/mobile/release-check/README.md`, section "Write or repair a journey") hold only the single-quote rule of trap 1, and they link to this doc for the others. This doc is the only place that states the other rules, so read it before a new journey on a new screen meets the same traps again.

On 2026-10-28 a second pass fixed the journeys that the first full release run labeled flaky. Traps 8 and 9, the change to trap 6, and the method in "Find the cause of a flaky journey" come from those session tries.

The planning sweep had already noted one layout trap (session history): the iPad shows its tab bar at the top, so a step that depends on a bottom tab bar fails there. One script must work on five layouts.

## Guidance

### 1. A `text` selector matches the whole text, not a part of it

Maestro compares the whole element text, as a regular expression or as exact text (per maestro-client `Filters.textMatches`; auto memory [claude]). A part of the text does not match.

- For a part of the text, add `.*`: `text: 'Can God be Known\?.*'` (`apps/mobile/release-check/journeys/series-next-episode.yaml:42`).
- Escape regex characters such as `?`, `(`, and `+` with a backslash.
- Put a pattern with a backslash in single quotes. The journey rules refuse a backslash after a double quote, because YAML reads it as an escape (`apps/mobile/release-check/lib/journeys/flow.js:359-364`).
- Exact text also matches, so `text: Delete 1 video?` works by equality although `?` is a regex character (`apps/mobile/release-check/journeys/downloads-library-ios.yaml:202`).

### 2. On iOS 26, a tap outside a sheet also reaches the app under it

A tap on the dismiss area of a share sheet closes the sheet, and the same tap also reaches the view below it. The tap can open a verse, a video, or a row that the journey did not intend.

- On the iPhone, tap a spot under the sheet that ignores a tap. `apps/mobile/release-check/journeys/bible-verse-select.yaml:87-91` taps `point: 50%,20%`, which lands on empty verse area.
- On the iPhone, a swipe down also closes the sheet (observed during the journey work; no committed journey uses it).
- The iPad shows the share sheet as a popover, and a swipe does not close a popover. Tap outside it.

### 3. On the iPad, Maestro calls a control below a short sheet's edge visible

The iPad shows some forms as a short form sheet. Maestro reports a button below the sheet's lower edge as visible. A tap there lands outside the sheet and closes it.

- Swipe the sheet's own content up first, then use `scrollUntilVisible` for the button (`apps/mobile/release-check/journeys/more-and-feedback.yaml:91-104`, `apps/mobile/release-check/journeys/downloads-library-ios.yaml:50-62`).
- The iPad folder picker is a popover whose buttons Maestro cannot see. The downloads journey checks for `PopoverDismissRegion` and taps empty space below the picker to close it (`apps/mobile/release-check/journeys/downloads-library-ios.yaml:76-97`).

### 4. On iOS, a Pressable with an `accessibilityLabel` hides its child text

A Pressable becomes one accessibility element, and its label replaces the text inside it. Maestro reads that tree, so a `text:` selector for the child text finds nothing.

- Select the element by its testID and its label. The feedback success panel is `{ id: screen-feedback, text: Close }` (`apps/mobile/release-check/journeys/more-and-feedback.yaml:111-117`).
- The success panel shows for only 1.5 seconds. The Send tap uses `waitToSettleTimeoutMs: 100`, so the next step starts before the panel goes (`apps/mobile/release-check/journeys/more-and-feedback.yaml:105-110`).
- A related lesson is in `docs/solutions/mobile/rn-view-accessible-required-for-accessibilityrole.md`: check the accessibility tree, not the props.

### 5. A closed form does not prove that the app sent the write

The read-only server answers each listed write with a fake success. It logs that answer with the route `success-reply` (`apps/mobile/release-check/lib/server/server.js:197-203`) in `server-log.jsonl` (`apps/mobile/release-check/lib/runFolder.js:19`). A form can close for other reasons, for example a tap below an iPad sheet (trap 3).

When you repair a journey that sends something, find the `success-reply` line for that write in the session's server log. Do not accept "the form closed" as the proof.

### 6. A wait is not a timer

- `waitForAnimationToEnd` returns as soon as the screen is still, not at its timeout. In a probe on the Search tab it returned after about 1.2 seconds (observed during the journey work; auto memory [claude]).
- `extendedWaitUntil` with `notVisible` can fail at once when the element stays on a still screen. In the full run of 2026-10-27, the `more-and-feedback` step "The player controls hide" had `timeout: 10000` and failed after about 0.2 seconds, while the controls stayed up over a video at 0:00 (run `2026-10-27T21-18-29Z-2569`, iPhone SE, first try).
- To wait for a state, poll it: a `repeat` with `while:` on the state, around a short optional `extendedWaitUntil` for an id that never shows (`apps/mobile/release-check/journeys/play-video.yaml:47-59`, "Wait until the controls hide"). The loop ends on the real state, and the short wait is only its poll interval, so a committed journey may use it there.

For a fixed hold in a throwaway probe, use `extendedWaitUntil` for an id that never shows, with `optional: true` and the hold time as `timeout`. In the probes, the step ended as WARNED, and the try stayed green: the runner fails a step only on FAILED (`apps/mobile/release-check/lib/journeys/results.js:94`). A hold can end early on a still screen, so never commit one outside a polling loop. Never use a `screen-…` id for it, because an optional screen assertion still counts as coverage (an open P3 review finding in PR #2919 against `apps/mobile/release-check/lib/journeys/flow.js`; after a fix, it no longer counts).

### 7. Run a probe journey only from inside the journeys folder

- `session try` runs only a `.yaml` file inside `apps/mobile/release-check/journeys/`. A subfolder (for example one named `_probe`) works, but a file in `node_modules` or `__tests__` is refused (`resolveJourney`, `apps/mobile/release-check/lib/session.js:568-592`).
- `check-lists` and every run read every journey file in the folder, so delete a probe file before you commit.
- The runner gives Maestro `--debug-output <try>/debug --flatten-debug-output` (`apps/mobile/release-check/lib/journeys/maestro.js:52-54`). A `takeScreenshot: { path: name }` step wrote its PNG under that `debug` folder of the try, inside `<session>/tries/` (`apps/mobile/release-check/lib/session.js:595`; the place inside `debug` was observed in a probe).
- Never call `maestro` directly. The runner owns the devices and the read-only server (`apps/mobile/CLAUDE.md`, "Release check").

### 8. Maestro spends seconds around each tap command

- In the iPhone SE session tries of 2026-10-28, each `tapOn` waited up to about 3 seconds before its tap (log lines "Tap aimed via settled hierarchy" and "Tap aimed via trusted pre-wait hierarchy"), and 0.5 to 3.7 seconds after it, to see the UI change ("Something has changed in the UI judging by view hierarchy").
- `waitToSettleTimeoutMs: 200` and `retryTapIfNoChange: false` did not remove the wait after the tap.
- So two separate tap commands land about 4.5 to 6 seconds apart, also inside a `repeat` loop. A loop that tapped the player's center to show the controls and then pause failed to pause in 9 of 13 tries, because the controls hide 3 seconds after a tap (`HIDE_DELAY_MS`, `apps/mobile/src/hooks/useControlsVisibility.ts:20`).
- Two taps inside one `tapOn`, with `repeat` and `delay`, land on time. `delay: 1000` worked. With `delay: 400`, the second tap came before the pause button took a tap, and 5 of 6 tries failed.
- Make the start state known first. `play-video` and `more-and-feedback` wait until the controls hide, then tap the center twice, 1 second apart, in a loop that ends when the play button shows (`apps/mobile/release-check/journeys/play-video.yaml:38-65`). This passed 6 of 6 tries on the iPhone SE.

### 9. A tap that skips a timed overlay can reach the view under it

- `bible-verse-select` tapped the swipe demonstration to skip it. When Maestro's tap came about 4 seconds after the reader showed, the tap selected the verse under the demonstration in 3 of 4 tries. At about 9 seconds it never did (9 of 9), on the Android phone.
- In those tries the demonstration ended after about 4 to 5 seconds, not after its 12.4 seconds, so an early tap could meet its end. The early end is an open app defect (feat-899).
- When a step does not test the skip, wait for a timed overlay to end instead of tapping it (`apps/mobile/release-check/journeys/bible-verse-select.yaml:34-46`). The journey then passed 6 of 6 tries on the Android phone and 2 of 2 on the iPhone SE.
- `bible-chapter`, `bible-sheets` and `bible-translation-download` still tap the skip. They did not fail in the runs, but the same race applies until feat-899 is fixed.

## Find the cause of a flaky journey

1. Try the journey 5 times or more through `session try`. One try proves nothing about a flake.
2. Each try saves Maestro's output under `<session>/tries/<n>-<journey>/debug/<journey>/` (observed in the session tries). Its `maestro.log`, in the `logs` subfolder, gives a time for each step and each tap. `commands*.json` gives each step's status, start time and duration.
3. Compare a failed try with a passed one: the duration of the same step, and the time of a tap against the start of what it races. The Bible fix came from such a table (trap 9).
4. To see the screen over time, write a probe journey in a `_probe` subfolder of the journeys folder (trap 7) with `takeScreenshot` steps. Screenshots one after another take about 70 ms each, so put a short optional hold (trap 6) before each one. Delete the probe before you commit (trap 7).
5. A timing that the app does not explain, such as an overlay that ends early or a page that starts before its video loads, can be an app defect. Write a roadmap ticket rather than hide it in the journey (feat-898, feat-899, feat-900).

## Why This Matters

A trap shows in one of two ways. A loud trap fails the try, and each try costs device time while other sessions wait for the runner's lock. A quiet trap passes the try and proves nothing: a partial `text:` that never matches inside an optional block, a "form closed" check, or a fixed hold that was never fixed.

The release check fails a release on every failure, including a flaky journey. A journey that depends on a trap by luck becomes a flaky failure on a later run.

## When to Apply

- Before you write a new journey, and when a journey fails only on the iPad or only on iOS 26.
- When a step finds no element, but the screenshot shows the text.
- When you need proof that a write reached the read-only server.
- When you write a probe journey to look at a screen.
- When a journey passes on some tries and fails on others, or must tap inside a short window.

## Examples

A partial text selector:

```yaml
# Fails: the episode card's text holds more than the title.
- tapOn:
    text: Can God be Known?

# Works: a full match with `.*`, in single quotes because of the backslash.
- tapOn:
    text: 'Can God be Known\?.*'
```

A send button below an iPad form sheet's edge:

```yaml
# Fails on the iPad: Maestro calls the button visible, and the tap closes the sheet.
- tapOn:
    id: feedback-send

# Works on all five devices: scroll the sheet's own content first.
- swipe:
    from:
      id: screen-feedback
    direction: UP
- scrollUntilVisible:
    element:
      id: feedback-send
    direction: DOWN
- tapOn:
    id: feedback-send
    waitToSettleTimeoutMs: 100
```

Pausing a video whose controls hide 3 seconds after a tap:

```yaml
# Fails: each tap command takes seconds, so the controls hide between taps.
- repeat:
    while:
      notVisible:
        text: Play
    commands:
      - tapOn:
          text: Toggle player controls

# Works: wait until the controls hide, then two taps inside one command.
- repeat:
    while:
      notVisible:
        text: Play
    times: 3
    commands:
      - repeat:
          while:
            visible:
              text: Pause
          times: 8
          commands:
            - extendedWaitUntil:
                visible:
                  id: player-controls-never-shown
                timeout: 1000
                optional: true
      - tapOn:
          text: Toggle player controls
          repeat: 2
          delay: 1000
```

## Related

- `apps/mobile/release-check/README.md`, section "Write or repair a journey": the journey rules that `check-lists` enforces.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`: the manual `idb` version of the same device work.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`: why a client-side signal does not prove a write (trap 5).
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`: prove the instrument before you trust its signal (traps 5 and 6).
