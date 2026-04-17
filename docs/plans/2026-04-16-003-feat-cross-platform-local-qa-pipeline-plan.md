---
title: "feat: Cross-platform local QA pipeline"
type: feat
status: active
date: 2026-04-16
origin: docs/brainstorms/2026-04-16-cross-platform-local-qa-pipeline-requirements.md
scenarios: docs/plans/2026-04-16-003-e2e-test-scenarios.md
---

# feat: Cross-platform local QA pipeline

## Overview

Build a local, pre-push QA pipeline invoked via a `/qa` Claude Code skill that gives confidence a change works across all affected surfaces (browser, iOS, Android, tvOS, Android TV) — without opening a PR or booting simulators manually. The pipeline has 4 layers: type check + lint (Layer 1), LLM diff analysis (Layer 2), unit/component tests (Layer 3), and automated UI flows (Layer 4a) with visual review (Layer 4b).

The companion [test scenarios document](docs/plans/2026-04-16-003-e2e-test-scenarios.md) specifies ~135 flows covering ~750 individual scenarios across all 3 apps and 5 surfaces. Agents implementing flow authoring units (4, 5, 7) must read that document for comprehensive coverage.

## Problem Frame

Urim owns frontend across 5 surfaces. With ~5 unit tests total, zero e2e tests, and no automation frameworks, every change requires manually booting simulators and visually verifying each platform. Bugs slip through because manual verification doesn't scale to 5 surfaces. (see origin: `docs/brainstorms/2026-04-16-cross-platform-local-qa-pipeline-requirements.md`)

## Requirements Trace

- R1. Analyze staged diff and identify affected apps/surfaces
- R2. Flag cross-platform divergence patterns
- R3. Output structured verdict (affected surfaces, risks, recommended action)
- R4. Map shared package changes to downstream consumers via actual dependency graph
- R5. Suggest missing unit tests
- R6. Claude generates unit/component tests, developer reviews before committing
- R7. Tests run via existing runners (vitest, jest-expo) with infrastructure additions
- R8. Only affected tests run, scoped by Layer 2's verdict
- R9. Maestro for mobile, Playwright for web, custom YAML runner for TV
- R10. Flows cover critical paths across all apps
- R11. Only affected surfaces run per Layer 2 verdict
- R12. Flows capture screenshots at key interaction points
- R13-R15. Claude visual review of screenshots, cross-comparing per platform pair
- R16. Screenshot count scoped to ~3-5 per flow
- R17-R19. `/qa` skill as single entry point, fast gate layers, parallel simulators

## Scope Boundaries

- Local only — no CI integration in this plan
- No visual regression baselining (Percy, Chromatic)
- No performance testing
- No accessibility auditing beyond visual review
- No exploratory testing (Claude navigating via taps) — flow runners handle navigation
- Does not replace human judgment for novel UI decisions

### Deferred to Separate Tasks

- Adding `tv` scope to `.claude/commands/work.md`, `.github/ISSUE_TEMPLATE/scope.yml`, and issue label workflow — not part of QA pipeline
- CI e2e job (`.github/workflows/`) — separate future effort
- Creating `.env.ci` for `apps/tv` — separate from local QA

## Context & Research

### Relevant Code and Patterns

- `apps/web/vitest.config.ts` — existing test config (node env, `.test.ts` only)
- `apps/web/src/lib/content.test.ts` — vitest pattern: `vi.hoisted()` + `vi.mock()` + dynamic imports
- `apps/tv/src/lib/validateUrl.test.ts` — jest-expo pattern: Jest globals, colocated
- `packages/video-player/vitest.config.ts` — jsdom env example for component tests
- `.claude/commands/work.md` — existing skill format (plain markdown)
- `turbo.json` — existing pipeline tasks (typecheck, lint, test all defined)
- `apps/tv/src/components/sections/SectionDispatcher.tsx` — SDUI dispatch pattern
- `apps/tv/src/components/ContentRail.tsx` — TVFocusGuideView with autoFocus
- `apps/tv/src/components/VideoPlayer.tsx` — TVFocusGuideView trapFocus pattern

### Institutional Learnings

- **Metro watchFolders storm** (`docs/solutions/developer-experience/metro-watchfolders-monorepo-refresh-storm-20260415.md`): Parallel test runs can trigger spurious Fast Refresh in sibling apps. Each app's Metro config must scope watchFolders tightly. File writes from Playwright screenshots or Maestro recordings could trigger TV app refreshes.
- **tvOS simulator detection broken** (`docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`): Expo CLI cannot detect installed apps on Apple TV Simulator. Use `xcrun simctl openurl` with deep links. Android TV emulator needs `10.0.2.2` for localhost.
- **tvOS runtime-only bugs** (`docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`): 5 documented pitfalls (WebView crash, SVG pod failure, absolute-position focus loss, scroll focus fight, AVPlayerLayer blocking) are invisible to type checking, linting, and unit tests — only catchable on simulators. Validates need for Layer 4.
- **pnpm React singleton fragility** (`docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md`): Custom `resolveRequest` in `metro.config.js` is load-bearing. Pipeline must not disrupt resolution.
- **Env file management** (`docs/solutions/mobile/expo-env-file-handling.md`): Metro reads `.env` files, not shell env vars. Pipeline must ensure correct `.env.local` exists before builds.
- **Agent instructions should be tool-agnostic** (`docs/solutions/platform/agent-instructions-should-stay-tool-agnostic-and-current.md`): Write skill in workflow terms, not hard-coupled to specific tool surfaces.

### External References

- Research conducted during brainstorm (see origin document):
  - Maestro confirmed for iOS + Android, not tvOS
  - Playwright recommended over Cypress for web
  - AppleScript keystroke injection verified working for tvOS D-pad
  - `adb shell input keyevent KEYCODE_DPAD_*` verified for Android TV
  - Agent Device (Callstack) identified as future upgrade path for TV runner

## Key Technical Decisions

- **`/qa` is a Claude Code skill, not a standalone script**: Layers 2 and 4b require LLM inference. The skill orchestrates deterministic layers (1, 3, 4a) via Bash and performs LLM layers (2, 4b) inline. (see origin)
- **Screenshot convention**: `{app}/e2e/screenshots/{surface}/{flow-name}/{step-name}.png`. Surface names: `ios`, `android`, `tvos`, `androidtv`, `browser`. This allows Claude to find and compare platform pairs by directory structure.
- **Flow file locations**: `apps/mobile/.maestro/` (Maestro convention), `apps/web/e2e/` (Playwright convention), `apps/tv/e2e/flows/` (custom runner).
- **TV YAML runner lives at `apps/tv/e2e/runner.ts`**: ~100-200 lines of TS. Translates D-pad primitives to `osascript` (tvOS) or `adb keyevent` (Android TV). Swappable backend for future Agent Device migration.
- **Test generation is separate from `/qa` runs**: Claude generates tests during feature development. `/qa` only runs existing committed tests and flows. This keeps `/qa` fast and deterministic.
- **Dependency graph for Layer 2 is hardcoded and scoped to QA surfaces**: `packages/graphql` -> web, mobile, tv. `packages/video-player` -> web only. Other consumers (e.g., `apps/manager` also uses `video-player`) are outside QA scope. Simpler and more reliable than dynamic resolution. Updated manually when new shared packages are added.
- **Layer 2's verdict drives all downstream filtering**: Turbo's `--filter=[HEAD^1]` only captures the last commit, not uncommitted working-tree changes. Instead, Layer 2 reads `git diff` (staged + unstaged), identifies affected packages, and the skill constructs explicit `--filter=@forge/web --filter=@forge/tv` style arguments from the verdict. This ensures Layers 1 and 3 target exactly the packages with uncommitted changes.
- **CMS must be running locally for Layer 4a flows**: All three apps fetch data from the CMS via GraphQL. Without a running Strapi, e2e flows will screenshot error states. The `/qa` skill should verify CMS availability (check `http://localhost:1337/graphql` health) before running Layer 4a and warn if it's down. Alternative: set `.env.local` to point at a staging CMS URL if local Strapi is not running.
- **Apps must be pre-built and running before `/qa`**: The pipeline assumes apps are already built, installed on simulators, and running (or the dev servers are active). Building native apps takes 5-10 minutes and would blow the 8-minute target. The skill checks for installed apps and warns if missing, but does not build them.
- **Layer 3 failures warn, don't stop**: A unit test failure shouldn't prevent Layer 4 from running — the UI flow may reveal the root cause visually. Layer 1 failures (type errors, lint) do stop the pipeline.

## Open Questions

### Resolved During Planning

- **Directory structure for test flows**: Follow monorepo convention — each app owns its test infrastructure. `apps/mobile/.maestro/`, `apps/web/e2e/`, `apps/tv/e2e/flows/`.
- **Screenshot naming convention**: `{app}/e2e/screenshots/{surface}/{flow-name}/{step-name}.png`. Surface prefix enables Claude to compare platform pairs by listing directory contents.
- **Test generation trigger**: Separate from `/qa`. Generation happens during feature development via `/work` or manual request. `/qa` only runs committed tests.
- **Parallel simulator capacity**: Defer benchmarking to implementation. Target 2-3 simultaneous. The skill will attempt parallel and fall back to sequential if resource-constrained.

### Deferred to Implementation

- Exact Maestro flow YAML content — depends on observing actual app behavior on simulators
- Exact Playwright test content — depends on running dev server and observing pages
- Whether AppleScript tvOS keystroke injection needs a delay tuning pass — depends on runtime experience
- Optimal screenshot capture points per flow — start with 3-5 per flow, tune based on visual review usefulness

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
                         /qa skill invoked
                              │
                    ┌─────────▼──────────┐
                    │ Layer 1: Bash      │
                    │ turbo run typecheck │
                    │   lint             │
                    │   --filter=@forge/ │
                    │   {affected pkgs}  │
                    └────────┬───────────┘
                             │ pass
                    ┌────────▼───────────┐
                    │ Layer 2: LLM       │
                    │ Read git diff      │
                    │ Check CMS health   │
                    │ Match against      │
                    │ platform risk DB   │──── "no UI testing needed" → DONE
                    │ Output verdict:    │
                    │   affected surfaces│
                    │   + risk flags     │
                    │   + Turbo filters  │
                    └────────┬───────────┘
                             │
                    ┌────────▼───────────┐
                    │ Layer 3: Bash      │
                    │ turbo run test     │
                    │   --filter=@forge/ │
                    │   {affected pkgs}  │
                    └────────┬───────────┘
                             │ warn on fail
               ┌─────────────┼─────────────┐
               │    Layer 4a: Bash (per surface)   │
      ┌────────▼───┐  ┌─────▼─────┐  ┌────▼────────┐
      │ Playwright │  │  Maestro  │  │ TV YAML     │
      │ (browser)  │  │ (iOS,     │  │ runner      │
      │            │  │  Android) │  │ (tvOS,      │
      │ e2e/       │  │ .maestro/ │  │  AndroidTV) │
      └────────┬───┘  └─────┬─────┘  └────┬────────┘
               │             │             │
               └─────────────┼─────────────┘
                             │ screenshots saved
                    ┌────────▼───────────┐
                    │ Layer 4b: LLM      │
                    │ Read screenshots   │
                    │ Compare iOS vs     │
                    │   Android          │
                    │ Compare tvOS vs    │
                    │   Android TV       │
                    │ Report with P0-P2  │
                    │   severity         │
                    └────────────────────┘
```

**TV YAML Runner architecture:**

```
  flow.yaml          runner.ts           platform adapters
 ┌──────────┐      ┌──────────────┐     ┌──────────────────┐
 │ dpad: down│ ──> │ parse YAML   │ ──> │ tvos-adapter.ts  │
 │ screenshot│     │ for each step│     │  osascript keycode│
 │ dpad: sel │     │ dispatch to  │     ├──────────────────┤
 │ wait: 2000│     │ adapter      │     │ androidtv-adapter│
 └──────────┘      └──────────────┘     │  adb keyevent    │
                                        └──────────────────┘
```

## Output Structure

```
apps/web/
  e2e/
    playwright.config.ts
    flows/
      home.spec.ts
      search.spec.ts
      video-playback.spec.ts
      navigation.spec.ts
      watch-page.spec.ts
    screenshots/
      browser/
apps/mobile/
  .maestro/
    home-navigation.yaml
    search-flow.yaml
    video-playback.yaml
  e2e/
    screenshots/
      ios/
      android/
apps/tv/
  e2e/
    runner.ts
    adapters/
      tvos.ts
      androidtv.ts
    flows/
      home-navigation.yaml
      experience-detail.yaml
      video-playback.yaml
    screenshots/
      tvos/
      androidtv/
.claude/
  commands/
    qa.md
```

## Implementation Units

- [ ] **Unit 1: Environment prerequisites**

**Goal:** Ensure all tooling dependencies are available so subsequent units can execute.

**Requirements:** Prerequisite for R9, R12, R17

**Dependencies:** None

**Files:**

- Modify: shell profile (`~/.zshrc` or `~/.zprofile`) — not repo-managed, manual step
- Modify: `apps/web/package.json` — add Playwright devDependency
- Create: `apps/web/e2e/` directory

**Approach:**

- Set `$ANDROID_HOME` to `~/Library/Android/sdk` and add `$ANDROID_HOME/platform-tools` to `$PATH` in shell profile
- Install Maestro CLI: `brew install maestro`
- Install Playwright: `pnpm --filter @forge/web add -D @playwright/test` then `npx playwright install`
- Verify all simulators boot: `xcrun simctl list devices available`, check for Apple TV and iPhone entries; `$ANDROID_HOME/emulator/emulator -list-avds` for Android TV
- Grant macOS Accessibility permissions for Terminal/iTerm (required for osascript keystroke injection to tvOS Simulator)

**Patterns to follow:**

- Existing `devDependencies` structure in `apps/web/package.json`

**Test expectation:** none — environment setup, no behavioral change

**Verification:**

- `which maestro` returns a path
- `adb devices` works without full path
- `npx playwright --version` works from `apps/web/`
- `xcrun simctl list | grep "Apple TV"` shows available simulators
- `osascript -e 'tell application "System Events" to name of processes'` succeeds (accessibility permissions granted)

---

- [ ] **Unit 2: `/qa` skill with Layers 1 + 2**

**Goal:** Create the Claude Code skill that serves as the pipeline entry point. Implement Layer 1 (typecheck + lint via Turbo) and Layer 2 (LLM diff analysis with platform risk flagging). This unit delivers immediate value — usable before any e2e infrastructure exists.

**Requirements:** R1, R2, R3, R4, R5, R17, R18

**Dependencies:** None (Layer 2 is pure LLM analysis, Layer 1 uses existing Turbo tasks)

**Files:**

- Create: `.claude/commands/qa.md`

**Approach:**

- Follow the format of existing commands (`.claude/commands/work.md`) — plain markdown with workflow instructions
- Layer 1 section: instruct the skill to run `turbo run typecheck lint` filtered to affected packages (determined by reading `git diff --name-only` to identify changed app/package directories, then constructing `--filter=@forge/web --filter=@forge/tv` etc.). Stop pipeline on failure.
- Layer 2 section: instruct the skill to read `git diff --cached` (or `git diff` if nothing staged), then analyze the diff against:
  - App directory mapping: `apps/web/` -> browser, `apps/mobile/` -> iOS + Android, `apps/tv/` -> tvOS + Android TV
  - Shared package mapping: `packages/graphql` -> web + mobile + tv, `packages/video-player` -> web only
  - Platform risk patterns: a curated list of known divergence patterns (safe areas, shadows, focus navigation, keyboard behavior, platform-specific APIs, gesture handling, WebView availability on tvOS, ScrollView focus fights on TV, absolute-position focus loss on TV)
- Layer 2 output format: structured verdict listing (a) affected surfaces, (b) risks found with explanations, (c) recommended action
- If verdict is "no UI testing needed" (pure logic/config change with no UI impact), report pass and stop
- Include a "suggest missing tests" step where the skill identifies untested code paths in the changed files

**Patterns to follow:**

- `.claude/commands/work.md` — plain markdown skill format
- `.claude/commands/review-fix-loop.md` — multi-step skill with conditional logic

**Test expectation:** none — Claude Code skill file, not executable code

**Verification:**

- Invoking `/qa` in a Claude Code session triggers the skill
- Layer 1 runs typecheck + lint and reports results
- Layer 2 correctly identifies which surfaces are affected by a test diff
- Layer 2 flags a known platform risk when one is present in the diff (e.g., a `Platform.select` usage, a `StyleSheet.create` with shadows)

---

- [ ] **Unit 3: Layer 3 test infrastructure (forward-looking)**

**Goal:** Add the missing libraries and config changes so component tests are viable in all three apps. Note: Layer 3 of the `/qa` pipeline already works today — `turbo run test` runs existing unit tests. This unit serves R6 (Claude generates component tests during future feature development), not the immediate pipeline functionality.

**Requirements:** R6, R7

**Dependencies:** None

**Files:**

- Modify: `apps/web/vitest.config.ts` — add jsdom environment, extend include to `.test.tsx`
- Modify: `apps/web/package.json` — add `@testing-library/react`, `jsdom` devDependencies
- Modify: `apps/mobile/package.json` — add `@testing-library/react-native` devDependency
- Modify: `apps/tv/package.json` — add `@testing-library/react-native` devDependency

**Approach:**

- For web: change vitest environment from `node` to `jsdom` for `.tsx` test files. Keep `node` for `.ts` tests (existing logic tests don't need DOM). Use vitest's `environmentMatchGlobs` to split: `["src/**/*.test.tsx", "jsdom"]`.
- For mobile/tv: `@testing-library/react-native` is the standard. Add as devDependency, no config changes needed (jest-expo already handles JSX transform).
- Do NOT write any test files in this unit — that happens incrementally during feature development (R6).

**Patterns to follow:**

- `packages/video-player/vitest.config.ts` — existing jsdom vitest setup with `@testing-library/react`-style testing
- `apps/web/vitest.config.ts` — existing config to extend (not replace)

**Test scenarios:**

- Happy path: A new `.test.tsx` file in `apps/web/src/` can import React components, render them with `@testing-library/react`, and assert on DOM output
- Happy path: A new `.test.tsx` file in `apps/mobile/src/` can import React Native components, render them with `@testing-library/react-native`, and query by testID
- Edge case: Existing `.test.ts` files in `apps/web/src/` continue to run in `node` environment (no DOM), ensuring no regression

**Verification:**

- Create a trivial smoke test in each app that renders a component and asserts it mounts — then delete it. The point is to verify the infrastructure works, not to commit the smoke test.
- `pnpm --filter @forge/web run test` passes with both `.test.ts` and `.test.tsx` files
- `pnpm --filter @forge/tv run test` passes (existing 2 tests still work + new setup doesn't break)

---

- [ ] **Unit 4: Playwright setup + first web flows**

**Goal:** Configure Playwright for the web app and author the first ~5 critical-path e2e flows covering the most important user journeys.

**Requirements:** R9 (Playwright for web), R10, R11, R12, R16, R17

**Dependencies:** Unit 1 (Playwright installed), Unit 2 (`/qa` skill exists)

**Files:**

- Create: `apps/web/e2e/playwright.config.ts`
- Create: `apps/web/e2e/flows/home.spec.ts`
- Create: `apps/web/e2e/flows/search.spec.ts`
- Create: `apps/web/e2e/flows/video-playback.spec.ts`
- Create: `apps/web/e2e/flows/navigation.spec.ts`
- Create: `apps/web/e2e/flows/watch-page.spec.ts`
- Create: `apps/web/e2e/screenshots/` directory (gitignored)
- Modify: `apps/web/package.json` — add `e2e` script
- Modify: `apps/web/.gitignore` — add `e2e/screenshots/`
- Modify: `.claude/commands/qa.md` — add Layer 3 (turbo run test) + Layer 4a browser section (run Playwright when browser surface is affected)

**Approach:**

- Playwright config: base URL from env var or `http://localhost:3000`, screenshot on failure, trace on first retry. Consistent viewport (1280x720). Disable parallel workers for local determinism.
- Each flow captures screenshots at key interaction points using `page.screenshot({ path: ... })` with the naming convention: `e2e/screenshots/browser/{flow-name}/{step-name}.png`.
- Start Next.js dev server before flows run (Playwright `webServer` config).
- Script: `"e2e": "playwright test --config e2e/playwright.config.ts"`

**Critical-path flows (first 5):**

1. **home**: Load homepage, verify hero renders, verify at least one content section visible, capture 3 screenshots (hero, mid-scroll, footer area)
2. **search**: Open search overlay, type a query, verify results appear, select a result, capture 3 screenshots (overlay open, results loaded, result selected)
3. **video-playback**: Navigate to a watch page, verify video player loads, interact with play/pause, capture 3 screenshots (player loaded, playing, paused)
4. **navigation**: Navigate between pages via links, verify correct page loads, verify back navigation works, capture 2 screenshots
5. **watch-page**: Load a specific `[slug]/[locale]` route, verify sections render from CMS data, capture 2 screenshots

**Patterns to follow:**

- Existing web routes: `app/page.tsx` (home), `app/search/page.tsx`, `app/[slug]/page.tsx`, `app/[slug]/[locale]/page.tsx`
- Playwright best practices: use `data-testid` attributes, avoid brittle CSS selectors

**Test scenarios:**

- Happy path: Each flow runs against the dev server and captures screenshots in the correct directory
- Happy path: `pnpm --filter @forge/web run e2e` exits 0 when all flows pass
- Error path: A flow that cannot find an expected element fails with a clear error and saves a failure screenshot
- Edge case: Dev server not running — Playwright's `webServer` config starts it automatically

**Verification:**

- `pnpm --filter @forge/web run e2e` completes successfully
- `apps/web/e2e/screenshots/browser/` contains screenshots from each flow
- Screenshots are readable PNG files that show actual rendered pages

---

- [ ] **Unit 5: Maestro setup + first mobile flows**

**Goal:** Author the first ~5 critical-path Maestro flows for the mobile app covering core user journeys on both iOS and Android.

**Requirements:** R9 (Maestro for mobile), R10, R11, R12, R16, R17

**Dependencies:** Unit 1 (Maestro CLI installed), Unit 2 (`/qa` skill exists)

**Files:**

- Create: `apps/mobile/.maestro/home-navigation.yaml`
- Create: `apps/mobile/.maestro/search-flow.yaml`
- Create: `apps/mobile/.maestro/video-playback.yaml`
- Create: `apps/mobile/.maestro/tab-navigation.yaml`
- Create: `apps/mobile/.maestro/library-experience.yaml`
- Create: `apps/mobile/e2e/screenshots/` directory (gitignored)
- Modify: `apps/mobile/package.json` — add `e2e:ios` and `e2e:android` scripts
- Modify: `apps/mobile/.gitignore` — add `e2e/screenshots/`
- Modify: `.claude/commands/qa.md` — add Layer 4a mobile section (run Maestro on iOS + Android when those surfaces are affected)

**Approach:**

- Maestro flows use `.maestro/` directory (Maestro convention — Maestro auto-discovers flows here).
- Each flow uses `takeScreenshot` command at key points, saving to `e2e/screenshots/{surface}/{flow-name}/{step-name}.png`.
- Separate scripts for iOS and Android: `maestro test --device ios .maestro/` and `maestro test --device android .maestro/`.
- App must be built and installed on simulator before Maestro runs. Scripts should check for installed app and warn if missing.

**Critical-path flows (first 5):**

1. **home-navigation**: Launch app, verify home tab loads, scroll down, verify content sections render, capture 3 screenshots
2. **search-flow**: Tap discover tab, type search query, verify results animate in, tap a result, capture 3 screenshots
3. **video-playback**: Navigate to a video, verify player loads, tap play, verify playback, capture 3 screenshots
4. **tab-navigation**: Switch between all 4 tabs (Home, Discover, Library, Profile), verify each loads, capture 4 screenshots
5. **library-experience**: Tap Library tab, verify experience list loads, select an experience, verify it becomes active, capture 2 screenshots

**Patterns to follow:**

- Maestro YAML format: `appId`, `---` separator, then `- tapOn`, `- assertVisible`, `- takeScreenshot`, etc.
- Mobile app routes: `/(tabs)/index`, `/(tabs)/watch`, `/(tabs)/library`, `/(tabs)/profile`, `/video/[sectionKey]`

**Test scenarios:**

- Happy path: `maestro test .maestro/home-navigation.yaml` passes on iOS Simulator
- Happy path: Same flow passes on Android Emulator
- Happy path: Screenshots saved to correct surface-specific directories
- Error path: Missing app on simulator — Maestro reports clear error
- Integration: Tab navigation flow visits all 4 tabs and returns to home without crashing

**Verification:**

- `maestro test .maestro/` passes on iOS Simulator with all 5 flows
- `maestro test .maestro/` passes on Android Emulator with all 5 flows
- Screenshot directories populated with readable PNGs
- Each flow completes in under 30 seconds

---

- [ ] **Unit 6: Custom TV YAML runner**

**Goal:** Build the lightweight TypeScript runner that executes TV test flows written in a simple YAML format, dispatching D-pad commands to tvOS Simulator (via AppleScript) and Android TV Emulator (via adb).

**Requirements:** R9 (custom YAML runner for TV), R12

**Dependencies:** Unit 1 ($ANDROID_HOME set, accessibility permissions granted)

**Files:**

- Create: `apps/tv/e2e/runner.ts`
- Create: `apps/tv/e2e/adapters/tvos.ts`
- Create: `apps/tv/e2e/adapters/androidtv.ts`
- Create: `apps/tv/e2e/types.ts`
- Test: `apps/tv/e2e/runner.test.ts`
- Modify: `apps/tv/package.json` — add `e2e:tvos`, `e2e:androidtv` scripts, add `yaml` and `tsx` devDependencies

**Approach:**

- **YAML schema**: Each flow is a YAML file with `name`, `platform` (array of `tvos` | `androidtv`), and `steps` (array of commands).
- **Supported commands**: `dpad` (up/down/left/right/select/back), `wait` (milliseconds), `screenshot` (name), `launch` (app bundle ID).
- **runner.ts**: Reads YAML files, selects the platform adapter, iterates steps. ~100-150 lines.
- **tvos.ts adapter**: Uses `osascript` via `child_process.execSync` to send key codes to the Apple TV Simulator window. Key codes: 126 (up), 125 (down), 123 (left), 124 (right), 36 (enter/select), 53 (escape/back). Uses `AXRaise` on the Apple TV window to avoid stealing focus. Screenshots via `xcrun simctl io booted screenshot`.
- **androidtv.ts adapter**: Uses `adb shell input keyevent` — DPAD_UP (19), DPAD_DOWN (20), DPAD_LEFT (21), DPAD_RIGHT (22), DPAD_CENTER (23), BACK (4). Screenshots via `adb exec-out screencap -p`.
- **Backend swappability**: Adapters implement a common interface (`TVAdapter`). Future Agent Device integration only requires a new adapter file — YAML flows and runner.ts stay unchanged.
- **Add 200ms default delay between D-pad steps** to allow focus animations to settle. Configurable via `delay` step command.
- **Execution**: Scripts invoke via `tsx` (added as devDependency): `"e2e:tvos": "tsx e2e/runner.ts --platform tvos"`, `"e2e:androidtv": "tsx e2e/runner.ts --platform androidtv"`.
- **tvOS focus contention**: AppleScript keystroke injection requires the Apple TV Simulator window to be raised. tvOS flows cannot run in parallel with other keyboard-interactive tasks. The skill must run tvOS flows sequentially, not overlapping with other foreground input.

**Patterns to follow:**

- `apps/tv/src/lib/validateUrl.ts` + `validateUrl.test.ts` — colocated test pattern
- Maestro YAML format — similar simplicity level for Claude to generate

**Test scenarios:**

- Happy path: runner.ts parses a valid YAML flow and returns a step list with correct types
- Happy path: tvOS adapter translates `dpad: down` to `osascript` command with key code 125
- Happy path: androidtv adapter translates `dpad: down` to `adb shell input keyevent 20`
- Happy path: `screenshot` step produces a PNG file at the expected path
- Edge case: Unknown step command — runner logs warning and skips
- Edge case: YAML flow specifies `platform: [tvos]` only — runner skips androidtv adapter
- Error path: `adb` not found — adapter throws clear error with setup instructions
- Error path: No Apple TV Simulator window found — tvOS adapter throws clear error
- Integration: A 5-step flow (launch, dpad down, dpad right, select, screenshot) executes end-to-end on Android TV emulator and produces a screenshot

**Verification:**

- `pnpm --filter @forge/tv run e2e:androidtv` executes a test flow on Android TV emulator
- `pnpm --filter @forge/tv run e2e:tvos` executes a test flow on tvOS Simulator
- Screenshots land in `apps/tv/e2e/screenshots/{surface}/`
- Unit tests for runner.ts and adapters pass

---

- [ ] **Unit 7: First TV flows**

**Goal:** Author the first ~5 critical-path TV YAML flows covering core user journeys for the 2-screen TV app.

**Requirements:** R10, R11, R12, R16

**Dependencies:** Unit 6 (runner built)

**Files:**

- Create: `apps/tv/e2e/flows/home-navigation.yaml`
- Create: `apps/tv/e2e/flows/experience-detail.yaml`
- Create: `apps/tv/e2e/flows/video-playback.yaml`
- Create: `apps/tv/e2e/flows/carousel-focus.yaml`
- Create: `apps/tv/e2e/flows/quiz-modal.yaml`
- Create: `apps/tv/e2e/screenshots/` directory (gitignored)
- Modify: `apps/tv/.gitignore` — add `e2e/screenshots/`
- Modify: `.claude/commands/qa.md` — add Layer 4a TV section (run TV YAML runner on tvOS + Android TV when those surfaces are affected)

**Approach:**

- Flows exercise the two screens (Home, Experience Detail) and key interactive components (ContentRail, VideoPlayer, RelatedQuestions, QuizButton).
- Each flow captures 3-5 screenshots at meaningful interaction points.
- Flows must account for tvOS-specific behavior: focus animations need settling time (use `wait: 300-500` between D-pad steps), `hasTVPreferredFocus` sets initial focus on Home screen's Explore button.

**Critical-path flows (first 5):**

1. **home-navigation**: Launch app, screenshot home, D-pad down to content rail, D-pad right through cards, screenshot focused card, select a card, screenshot experience detail
2. **experience-detail**: From home, select first experience, screenshot detail, D-pad down through sections, screenshot a section mid-scroll, D-pad back to home, screenshot home restored
3. **video-playback**: Navigate to experience, find video card, select it, screenshot video player overlay, D-pad right (seek forward), screenshot, D-pad back to dismiss, screenshot detail restored
4. **carousel-focus**: From experience detail, D-pad to a carousel section, D-pad left/right through carousel items, verify focus ring moves, screenshot at start and end positions
5. **quiz-modal**: Navigate to a quiz button, select it, screenshot modal open (WebView on Android TV, QR code on tvOS), back to dismiss, screenshot modal closed

**Patterns to follow:**

- TV app navigation: Stack — Home (index) -> Experience Detail ([slug]) -> Video overlay
- TVFocusGuideView autoFocus on ContentRail — first card gets focus automatically
- Quiz platform branching: Android TV shows WebView, tvOS shows QR code

**Test scenarios:**

- Happy path: All 5 flows complete on tvOS Simulator with screenshots captured
- Happy path: All 5 flows complete on Android TV Emulator with screenshots captured
- Happy path: quiz-modal flow produces different screenshots on tvOS (QR code) vs Android TV (WebView)
- Edge case: Experience with no video cards — video-playback flow's select step finds no target. Flow should handle gracefully (skip or warn, not crash)

**Verification:**

- All flows pass on both tvOS and Android TV
- `apps/tv/e2e/screenshots/tvos/` and `apps/tv/e2e/screenshots/androidtv/` contain screenshots from each flow
- Quiz modal screenshots visually differ between tvOS and Android TV (platform-specific rendering)

---

- [ ] **Unit 8: Layer 4b visual review + final pipeline polish**

**Goal:** Add Layer 4b (visual screenshot review) to the `/qa` skill and polish the end-to-end pipeline. By this point, Units 4, 5, and 7 have already wired their respective Layer 4a runners into the skill — this unit adds the cross-platform visual comparison that runs after all Layer 4a flows complete.

**Requirements:** R13, R14, R15, R16

**Dependencies:** Units 4, 5, 7 (at least one runner wired into the skill)

**Files:**

- Modify: `.claude/commands/qa.md` — add Layer 4b visual review section, add CMS health check, add final report format

**Approach:**

- **Layer 4b visual review**: After Layer 4a completes, the skill instructs Claude to:
  - Read all screenshots from `e2e/screenshots/` directories for surfaces that ran
  - For mobile: compare `ios/` vs `android/` screenshots of the same flows side-by-side
  - For TV: compare `tvos/` vs `androidtv/` screenshots of the same flows
  - Flag discrepancies with severity: P0 (blocking — broken layout, missing content), P1 (should fix — noticeable spacing/font differences), P2 (cosmetic — minor rendering variance)
- **CMS health check**: Before Layer 4a, verify CMS is reachable at `$INTERNAL_GRAPHQL_URL` or `http://localhost:1337/graphql`. Warn and suggest alternatives if down.
- **Final report format**: Summarize Layer 1-4b results — what passed, what warned, what failed, visual discrepancies found with severity ratings.
- **Note**: Layer 4b is useful even with partial Layer 4a coverage. If only web flows exist (Unit 4 done, Units 5/7 not yet), visual review still adds value for browser screenshots.

**Patterns to follow:**

- `.claude/commands/work.md` — multi-section skill with conditional branching
- Layer 2 verdict format established in Unit 2

**Test scenarios:**

- Happy path: Layer 4b compares iOS vs Android screenshots of the same flow and reports "no discrepancies" when screens match
- Happy path: Layer 4b detects a visual discrepancy (e.g., different safe area padding) and reports it with P1 severity
- Happy path: Full pipeline runs for a web-only change — Layers 1-3 + Playwright + visual review. Completes in under 2 minutes.
- Happy path: Full pipeline runs for a mobile change — all layers including visual comparison. Completes in under 8 minutes.
- Edge case: Shared package change (packages/graphql) — Layer 2 triggers all 5 surfaces. Pipeline runs all available runners.
- Edge case: Only web flows exist (mobile/TV not yet authored) — Layer 4a runs Playwright only, Layer 4b reviews browser screenshots, skips cross-platform comparison
- Error path: CMS not running — skill warns before Layer 4a, suggests starting CMS or using staging URL

**Verification:**

- `/qa` produces a visual review report comparing platform-pair screenshots
- Discrepancies are reported with P0/P1/P2 severity
- Full pipeline for a single-app change completes in under 8 minutes

## System-Wide Impact

- **Interaction graph:** The `/qa` skill invokes Turbo tasks (typecheck, lint, test), Maestro CLI, Playwright CLI, and the custom TV runner. It reads git diff output and screenshots. No changes to production code paths.
- **Error propagation:** Layer 1 failures stop the pipeline. Layer 3 and 4a failures warn and continue. Layer 4b findings are informational. The pipeline never modifies code — it only reports.
- **State lifecycle risks:** Simulators may be left running after `/qa` completes. This is acceptable for local use (simulators are reused across runs). No persistent state is created beyond screenshot files (gitignored).
- **API surface parity:** No API changes. The `/qa` skill is internal tooling only.
- **Integration coverage:** The full pipeline is the integration test — Layer 4b visual review verifies that all layers produced correct outputs. Individual unit tests cover the TV runner logic.
- **Unchanged invariants:** Existing test infrastructure (vitest config, jest-expo config, Turbo tasks) continues to work identically. The changes to vitest config are additive (new environment for `.tsx` files, existing `.ts` tests unchanged).

## Risks & Dependencies

| Risk                                                                                                                         | Mitigation                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppleScript tvOS keystroke injection is fragile across macOS versions                                                        | Implement as a swappable adapter. If it breaks, swap to Agent Device or Appium XCUITest backend. YAML flows stay unchanged.                                                                     |
| Maestro flows may be flaky due to animation timing                                                                           | Maestro has built-in retry and wait logic. Start with generous timeouts, tune down.                                                                                                             |
| Metro watchFolders interference during parallel runs                                                                         | Ensure each app's Metro config only watches its own workspace dependencies (per institutional learning). Playwright writes to `apps/web/e2e/screenshots/` which is outside Metro's watch scope. |
| Visual review time scales with screenshot count                                                                              | Cap at 3-5 screenshots per flow (R16). For 15 flows, that's ~50-75 screenshots, ~2-3 minutes review time.                                                                                       |
| Oracle problem — Claude-generated tests assert buggy behavior                                                                | Developer reviews all generated test assertions before committing (Key Decision). `/qa` only runs committed tests.                                                                              |
| 32GB RAM may not support 4+ simultaneous simulators                                                                          | Target 2-3 parallel. Fall back to sequential. Benchmark during implementation.                                                                                                                  |
| Mobile Metro watchFolders watches entire monorepo root — Playwright/TV screenshot writes could trigger spurious Fast Refresh | Either fix mobile Metro config to scope watchFolders (like TV was fixed), or run mobile Maestro flows sequentially after Playwright/TV flows complete (not in parallel).                        |
| tvOS AppleScript needs foreground window — can't overlap with other keyboard input                                           | Run tvOS flows sequentially. Do not overlap with Playwright or other simulator input. Android TV (adb) is headless and can run in parallel.                                                     |
| CMS not running locally — all e2e flows fail with error states                                                               | Skill checks CMS health before Layer 4a. Warns and offers staging URL fallback.                                                                                                                 |
| Apps not pre-built on simulators — native rebuild takes 5-10 min                                                             | Skill checks for installed apps and warns. Does not build. Developer must build before first `/qa` run and after native dependency changes.                                                     |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-16-cross-platform-local-qa-pipeline-requirements.md](docs/brainstorms/2026-04-16-cross-platform-local-qa-pipeline-requirements.md)
- **Comprehensive test scenarios:** [docs/plans/2026-04-16-003-e2e-test-scenarios.md](docs/plans/2026-04-16-003-e2e-test-scenarios.md) — ~135 flows covering ~750 scenarios across all 3 apps and 5 surfaces. Agents implementing Units 4, 5, and 7 MUST read this to author comprehensive flows, not just the ~5 critical-path flows mentioned per unit.
- Related learnings: `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
- Related learnings: `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`
- Related learnings: `docs/solutions/developer-experience/metro-watchfolders-monorepo-refresh-storm-20260415.md`
- Related learnings: `docs/solutions/mobile/expo-env-file-handling.md`
- Existing commands: `.claude/commands/work.md`, `.claude/commands/review-fix-loop.md`
- TV app entry points: `apps/tv/app/index.tsx`, `apps/tv/app/experience/[slug].tsx`
- Web app routes: `apps/web/src/app/page.tsx`, `apps/web/src/app/search/page.tsx`, `apps/web/src/app/[slug]/page.tsx`
