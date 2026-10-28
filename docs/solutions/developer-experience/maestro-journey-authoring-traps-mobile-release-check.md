---
title: Maestro traps when you write or repair a mobile release check journey
date: 2026-10-27
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
retire_when: "Maestro (2.11.0 on the owner's Mac) or iOS 26 changes how a text selector matches or where a tap outside a sheet goes; check the Maestro release notes and the iOS release notes, then try the affected journeys through `session try`"
tags:
  [maestro, release-check, journey, e2e, ios-26, ipad, ui-automation, mobile]
---

# Maestro traps when you write or repair a mobile release check journey

## Context

The mobile release check (feat-798, added in PR #2919) runs fixed Maestro journeys from `apps/mobile/release-check/journeys/` on five test devices. Claude wrote and repaired the journeys through `node apps/mobile/release-check/cli.mjs session up|try|down` on the five test devices: the iPhone SE, the iPhone 17 Pro Max, the iPad Pro 13, and the Android phone and tablet emulators. Each trap below cost at least one failed try, or gave a pass that proved nothing.

The journeys keep a short comment at each place where a trap occurs. The README's journey rules (`apps/mobile/release-check/README.md`, section "Write or repair a journey") hold only the single-quote rule of trap 1. No file in the repo states the other rules, so a new journey on a new screen meets the same traps again.

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

### 6. `waitForAnimationToEnd` is not a fixed wait

`waitForAnimationToEnd` returns as soon as the screen is still, not at its timeout. In a probe on the Search tab it returned after about 1.2 seconds (observed during the journey work; auto memory [claude]).

For a fixed hold in a throwaway probe, use `extendedWaitUntil` for an id that never shows, with `optional: true` and the hold time as `timeout`. In the probes, the step ended as WARNED, and the try stayed green: the runner fails a step only on FAILED (`apps/mobile/release-check/lib/journeys/results.js:94`). Do not commit such a hold. Never use a `screen-…` id for it, because an optional screen assertion still counts as coverage (an open P3 review finding in PR #2919 against `apps/mobile/release-check/lib/journeys/flow.js`; after a fix, it no longer counts).

### 7. Run a probe journey only from inside the journeys folder

- `session try` runs only a `.yaml` file inside `apps/mobile/release-check/journeys/`. A subfolder (for example one named `_probe`) works, but a file in `node_modules` or `__tests__` is refused (`resolveJourney`, `apps/mobile/release-check/lib/session.js:568-592`).
- `check-lists` and every run read every journey file in the folder, so delete a probe file before you commit.
- The runner gives Maestro `--debug-output <try>/debug --flatten-debug-output` (`apps/mobile/release-check/lib/journeys/maestro.js:52-54`). A `takeScreenshot: { path: name }` step wrote its PNG under that `debug` folder of the try, inside `<session>/tries/` (`apps/mobile/release-check/lib/session.js:595`; the place inside `debug` was observed in a probe).
- Never call `maestro` directly. The runner owns the devices and the read-only server (`apps/mobile/CLAUDE.md`, "Release check").

## Why This Matters

A trap shows in one of two ways. A loud trap fails the try, and each try costs device time while other sessions wait for the runner's lock. A quiet trap passes the try and proves nothing: a partial `text:` that never matches inside an optional block, a "form closed" check, or a fixed hold that was never fixed.

The release check fails a release on every failure, including a flaky journey. A journey that depends on a trap by luck becomes a flaky failure on a later run.

## When to Apply

- Before you write a new journey, and when a journey fails only on the iPad or only on iOS 26.
- When a step finds no element, but the screenshot shows the text.
- When you need proof that a write reached the read-only server.
- When you write a probe journey to look at a screen.

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

## Related

- `apps/mobile/release-check/README.md`, section "Write or repair a journey": the journey rules that `check-lists` enforces.
- `docs/solutions/developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`: the manual `idb` version of the same device work.
- `docs/solutions/developer-experience/mobile-write-path-smoke-via-fake-admin-proxy.md`: why a client-side signal does not prove a write (trap 5).
- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`: prove the instrument before you trust its signal (traps 5 and 6).
