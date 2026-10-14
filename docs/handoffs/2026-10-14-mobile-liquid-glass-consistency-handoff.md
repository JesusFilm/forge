---
artifact_contract: "ce-handoff/v1"
created_at: "2026-10-14T03:41:24Z"
title: "Mobile native Liquid Glass consistency"
summary: "Audit of every non-glass floating control in apps/mobile on iOS 26, with feasibility verdicts, handed to a new agent before any code change"
keywords:
  [
    "liquid-glass",
    "expo-glass-effect",
    "GlassView",
    "ios-26",
    "apps-mobile",
    "feat-699",
    "design-qa",
  ]
cwd: "/Users/urimchae/orca/workspaces/forge/mobile-app-polish"
resume_focus: "Plan and build feat-699: native Liquid Glass for the non-glass controls in apps/mobile, starting with the two spikes"
repository: "JesusFilm/forge"
repo_root_sha: "d184d9ed865d45902a6b0d2c5ffef8efa560e623"
branch: "Ur-imazing/mobile-liquid-glass"
head: "0c22078dfa591cfebcd2d634fe3cb45893a1e229"
worktree_path: "/Users/urimchae/orca/workspaces/forge/mobile-liquid-glass"
---

# Mobile native Liquid Glass consistency: handoff

`head` above is the base commit on `main`. The commit that adds this file sits on top of it.

## Objective and the user's intent

The user (Urim, the `apps/mobile` owner) wants the app to use native Liquid Glass consistently. In this session the user asked three things, in this order:

1. "Which elements in the mobile app are not native liquid glass?"
2. "Draw what each screen you have listed would look like with and without native liquid glass elements, and whether this is feasible or not to implement."
3. Hand the project to a new agent in a new worktree, and "do not lose any important context".

The user did not choose the scope, the order, or any element to build. Every ordering and rating below is the previous agent's own call unless the text says otherwise.

## Current state

- **Done:** an audit, by code reading only. It is in `docs/design-qa/mobile-liquid-glass-audit/index.html` (open it in a browser). The page has a summary table, two phone drawings per screen (today and with glass), and a verdict with the reason for each element. The same page is also a private Claude artifact, <https://claude.ai/artifact/9R4MUM791rmAXZaXePW6hS>. That artifact is a snapshot; the repo copy is newer by one note (the 2× cue line in the Explore section).
- **Done:** roadmap ticket `docs/roadmap/platform/feat-699-mobile-native-liquid-glass-consistency.md`, status `not-started`. The previous agent wrote it and chose `P2`, the start date, and the 10-day duration. The user did not set these.
- **Not started:** every code change. No glass change has been tried on a device or a simulator.
- **Worktree prepared (machine-local):** `pnpm install` ran, and `bash scripts/setup-sim-env.sh mobile` seeded `apps/mobile/.env.local`. That file holds a bearer token; do not print or commit it. The commit hooks are live (`.husky/_` exists).

## Facts the next agent depends on

- **Glass today (iOS 26):** `NativeTabs` in `apps/mobile/app/(tabs)/_layout.ios.tsx`, `HomeHeader.tsx`, `FloatingBackButton.tsx`, `ReaderGlassButton.tsx` with `ChapterPill.tsx`, and `TabBarBackground.tsx` (used only by `SelectionActionBar.tsx`). `TabBarBackground.tsx:17-40` is the pattern to copy.
- **The one rule behind most verdicts:** `GlassView` draws nothing under a parent whose opacity animates, and it ignores its own opacity. Proof and scope: `docs/solutions/best-practices/expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md` (2026-08-13, a 90% red tint showed no change). The rule is narrow: `FloatingBackButton` shows real glass over video on the same watch screen, because no fading layer is its parent.
- **The three fades that block glass:** `VideoPlayer.tsx:903` (`controls.opacityAnim`, which wraps `PlayerControls`), `app/watch/[slug].tsx:160` (`scrollTopOpacity`), `HomeScreen.tsx:358` (`chromeOpacity`). `Snackbar.tsx:45` also fades its opacity.
- **A possible way past the fades, unproven:** `expo-glass-effect` 57.0.4 types (`apps/mobile/node_modules/expo-glass-effect/build/GlassView.types.d.ts`) list `glassEffectStyle: 'clear' | 'regular' | 'none'` or `{ style, animate, animationDuration }`, plus `GlassContainer` with `spacing`. The idea that `{ style: 'none', animate: true }` can stand in for an opacity fade is the previous agent's inference from those types. It is not tested.
- **The native sheets turn the glass off:** they are real UIKit form sheets, but `app/watch/_layout.tsx:13-35` and `app/series/_layout.tsx:8-36` set `sheetCornerRadius: 16` and an opaque `contentStyle`. `react-native-screens` is 4.26.2. Whether it then shows the system glass sheet is the first spike.
- **Correction made during the audit:** the SDUI video and collection pages (`app/_layout.tsx:471,483`) put a custom `HeaderBackButton` in a native header. `react-native-screens` puts that view in a `UIBarButtonItem` (`ios/RNSScreenStackHeaderSubview.mm:189-225`), and iOS 26 draws a shared glass background unless `hidesSharedBackground` is set (`ios/RNSBarButtonItem.mm:72-80`). The app never sets it. So that button is probably glass already. Confirm on the simulator.
- **Native search tab:** `expo-router` 57.0.26 `NativeTabs` accepts `role: "search"` (`build/native-tabs/types.d.ts:649`). It is a redesign of the Search screen, so it needs the owner's approval first.
- **The 2× cue is not on main.** It comes from the Explore 2× hold, which is uncommitted on `Ur-imazing/mobile-app-polish` (the workspace `~/orca/workspaces/forge/mobile-app-polish`, machine-local). When it merges, it gets the same glass treatment as the paused glyph in `ClipOverlay.tsx`.

## Open questions for the owner

The previous agent raised these. The user has not answered them.

1. Should the Bible reader sheets become glass? They follow the reader's own light, dark and true dark themes.
2. Should the mini player window show its controls on glass at all? The window is small.
3. Is the native iOS 26 search tab wanted, or only a glass field in today's place?
4. Should the Downloads delete confirmation become the native action sheet? It is glass, but it cannot show the current layout.

## Wrong paths

- Do not put `GlassView` inside the player controls layer to "just try it". That was done on 2026-08-13 and it draws nothing.
- Do not conclude that `GlassView` is broken in the app. It works outside fading layers.
- Do not trust jest for the material. Render suites mock `GlassView` and `PlatformBlur` to `null` (`apps/mobile/CLAUDE.md`, "No test can see the RENDERED material").
- Do not trust Fast Refresh for material changes. Terminate and reopen the dev client, and prove the code path is live with a loud temporary `tintColor` (`apps/mobile/CLAUDE.md`, "Fast Refresh does not reliably apply changes to the material").
- Do not set `isInteractive` inside a `Pressable` (`docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md`).
- Do not commit a regenerated `docs/roadmap/README.md` from this machine. The generator blanks every date in a UTC+ time zone.
- Do not allocate a roadmap ID from `main` alone. `feat-699` came from a scan of every `origin` branch (highest 698 on 2026-10-14). Check again before a PR, because the CI job `roadmap-id-collisions-advisory` scans all branches.

## Simulator state (machine-local, 2026-10-14)

- iPhone 17 Pro Max simulator, UDID `C832868E-B456-43A9-8FB2-B61660DB674A`, iOS 26.5, booted. It runs the dev client `org.jesusfilm.forgewatch` built 2026-10-13. That build already contains `expo-glass-effect`, so JavaScript-only glass changes need no native rebuild.
- Port 8130 belongs to the `mobile-app-polish` workspace's Metro, and port 8081 to the `pause-devo-feature` workspace. Start this worktree's own Metro on a new free port, detached with `nohup`. Check the port owner's directory just before `xcrun simctl openurl`, then open `forgemobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A<port>`.
- In Orca workspaces, Fast Refresh did not reach the app on 2026-10-01. After each edit, terminate the app and open the dev client URL again.
- The app follows the device language (English). An earlier per-app Arabic override was removed in this session.
- Taps: `idb ui tap --udid <udid> <x> <y>` in points (the screen is 440 × 956 points).

## Verification done in this session

- All verdicts come from reading code on `Ur-imazing/mobile-app-polish` (main at `45d20673e`), then line numbers were taken again on main at `0c22078df` for `feat-699`.
- The audit page was checked once in headless Chrome. Three layout bugs were fixed after that look, and the page was not checked again. The script in the repo copy parses after Prettier.

## Next step

`CLAUDE.md` asks for a brainstorm against the ticket, then a plan, before code. The previous agent's recommendation is one path: ask the owner the four questions, then run the two spikes (the `'none'` style animation on one element, and one native sheet without its opaque options), because their results decide steps 2 and 3 of `feat-699`. The "Ready" items do not depend on the spikes and can go first or in parallel.

Skills that fit: `compound-engineering:ce-brainstorm`, `compound-engineering:ce-plan`, `compound-engineering:ce-work`, `compound-engineering:ce-code-review`, and `compound-engineering:ce-compound` at the end.

Branch naming: Orca names branches `Ur-imazing/<name>`. The repo convention is `feat/<description>`, so rename the branch before you open a PR. Only the user merges PRs.
