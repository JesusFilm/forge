---
date: 2026-04-16
topic: cross-platform-local-qa-pipeline
---

# Cross-Platform Local QA Pipeline

## Problem Frame

Urim owns frontend across 5 surfaces — apps/web (browser), apps/mobile (iOS + Android), and apps/tv (tvOS + Android TV). Every change requires manually booting simulators and visually verifying each platform to catch regressions. With minimal existing test coverage (~5 unit tests across all apps, zero e2e tests, no automation frameworks), bugs regularly slip through because manual verification doesn't scale to 5 surfaces.

The goal is a local, pre-push QA pipeline that gives high confidence a change works across all affected platforms — without opening a PR or relying on CI.

## Terminology

- **App**: one of the 3 codebases — `apps/web`, `apps/mobile`, `apps/tv`
- **Surface**: a specific platform target — browser, iOS, Android, tvOS, Android TV (5 total)
- **Flow**: a single authored test scenario (e.g., "search for a video and play it")
- **Run**: a flow executed on one surface. 61 flows × multiple surfaces = 102 runs.

## QA Pipeline Flow

```
┌─────────────────────────────────────────────────────────┐
│  Developer invokes /qa in Claude Code session           │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  Layer 1: Type Check +    │  ~5-10s
         │  Lint (deterministic)     │
         │                           │
         │  turbo run typecheck lint │
         │  --filter=[HEAD^1]        │
         │  STOP on failure.         │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  Layer 2: Diff Analysis   │  ~15-30s
         │  (Claude, within session) │
         │                           │
         │  • Read staged diff       │
         │  • Identify affected apps │
         │    + surfaces             │
         │  • Flag platform risks    │
         │  • Output: structured     │
         │    verdict (see R3)       │
         │                           │
         │  If verdict = "no UI      │
         │  testing needed":         │
         │  STOP, report pass.       │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  Layer 3: Unit/Component  │  ~5-15s
         │  Tests (jest + vitest)    │
         │                           │
         │  turbo run test           │
         │  --filter=[HEAD^1]        │
         │  WARN on failure,         │
         │  continue to Layer 4.     │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  Layer 4a: Automated UI   │  ~1-6min
         │  Flows (per surface)      │  (depends on
         │                           │   surfaces)
         │  Maestro (iOS, Android)   │
         │  Playwright (browser)     │
         │  Custom YAML (tvOS,       │
         │    Android TV)            │
         │                           │
         │  • Run flows on affected  │
         │    surfaces only          │
         │  • Capture screenshots    │
         │    at key points          │
         │  WARN on failure,         │
         │  continue to 4b.          │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  Layer 4b: Visual Review  │  ~1-3min
         │  (Claude, within session) │
         │                           │
         │  • Review screenshots     │
         │    from surfaces that ran │
         │  • Cross-compare iOS vs   │
         │    Android, tvOS vs       │
         │    Android TV             │
         │  • Report discrepancies   │
         │    with severity          │
         └───────────────────────────┘
```

**Entry point:** `/qa` is a Claude Code skill invoked within an active session. Because Layer 2 and Layer 4b require LLM inference (diff analysis, screenshot review), the pipeline must run inside a Claude Code session. There is no standalone `pnpm qa` script — deterministic layers (1, 3, 4a) are invoked by the skill via Bash commands.

**Failure behavior per layer:**

- **Layer 1 failure** (type error, lint error): pipeline stops, no further layers run
- **Layer 2 verdict "no UI testing needed"**: pipeline stops, reports pass
- **Layer 3 failure** (unit test fails): warn with details, continue to Layer 4 — UI flows may still reveal the root cause visually
- **Layer 4a failure** (flow fails): warn with details, continue to 4b — visual review of captured screenshots may diagnose what went wrong
- **Layer 4b finding** (visual discrepancy): report with severity (P0: blocking, P1: should fix, P2: cosmetic)

## Requirements

**Layer 2 — Diff Analysis**

- R1. Analyze staged git diff and identify which apps and surfaces are affected. A change to `apps/mobile/` means surfaces iOS + Android. A change to `apps/tv/` means surfaces tvOS + Android TV. A change to `apps/web/` means surface browser.
- R2. Flag known cross-platform divergence patterns: safe area handling, shadow rendering, focus navigation (TV), keyboard behavior, platform-specific APIs, gesture handling differences
- R3. Output a structured verdict listing: (a) affected surfaces, (b) platform-specific risks found, (c) recommended action — "run Layer 4 on [surfaces]" or "no UI testing needed"
- R4. When shared packages are changed, identify downstream consumer apps using the actual dependency graph. `packages/graphql` is consumed by web, mobile, and tv. `packages/video-player` is consumed by web only (it depends on video.js + react-dom; mobile and tv use expo-video).
- R5. Suggest missing unit tests for the changed code when coverage gaps are obvious

**Layer 3 — Unit and Component Tests**

- R6. Claude generates unit and component tests as features are built. Generated tests are committed to the repo so they run deterministically on subsequent invocations. The developer reviews assertions before committing (~30s per test file) to guard against the oracle problem.
- R7. Tests run via existing runners (vitest for web, jest-expo for mobile and tv) with no new test runners. However, existing test infrastructure requires additions before component tests are viable (see Dependencies).
- R8. Only affected tests run, using Turbo's `--filter=[HEAD^1]` change detection — this is zero-cost and already available

**Layer 4a — Automated UI Flows**

- R9. Claude generates Maestro YAML flows for iOS and Android surfaces, Playwright scripts for the browser surface, and custom YAML flows for tvOS and Android TV surfaces. The developer reviews assertions before committing. TV flows use a custom YAML runner (~100-200 lines of TS) that translates D-pad primitives (`dpad: up/down/left/right/select/back`) to platform-specific commands: AppleScript keystroke injection via `osascript` for tvOS Simulator, `adb shell input keyevent KEYCODE_DPAD_*` for Android TV Emulator. Both backends are verified working locally. The runner is designed to be swappable — if Callstack's Agent Device matures its TV support, the YAML flows stay the same and only the backend adapter changes.
- R10. Flows cover critical paths: app launch, navigation between screens, video playback controls, search, content carousels, modals/overlays, and error states
- R11. Only affected surfaces run, as determined by Layer 2's verdict
- R12. Flows capture screenshots at key interaction points using `xcrun simctl io booted screenshot` (iOS/tvOS) and `adb exec-out screencap -p` (Android/Android TV)

**Layer 4b — Visual Review**

- R13. After Layer 4a completes, Claude reviews captured screenshots from all surfaces that ran. Visual review does not run on surfaces that Layer 4a skipped.
- R14. For mobile: compare iOS screenshots against Android screenshots of the same screens, flagging layout drift, font rendering differences, spacing, safe areas, truncated text, and color differences
- R15. For TV: compare tvOS screenshots against Android TV screenshots, with special attention to focus rings, D-pad navigation states, and remote-driven UI
- R16. Screenshot count per run should be scoped to ~3-5 per flow to keep visual review tractable. At ~2-5 seconds LLM inference per image, a 15-flow run producing ~50-75 screenshots takes ~2-3 minutes for visual review, not seconds.

**Orchestration**

- R17. The `/qa` Claude Code skill is the single entry point. It runs Layers 1, 3, and 4a via Bash commands and performs Layers 2 and 4b inline as LLM analysis.
- R18. Layers 1-3 run fast (under 30 seconds total) as a quick gate before the slower Layer 4
- R19. Layer 4a runs simulators in parallel where machine resources allow (target: 2-3 simultaneous simulators given 32GB RAM)

## Success Criteria

- A typical single-app change gets full QA feedback in under 8 minutes locally (including visual review)
- Web-only changes complete in under 2 minutes (Playwright + visual review)
- The developer does not manually author test files or UI flows — Claude generates them, developer reviews assertions before committing
- Cross-platform visual discrepancies that would previously require booting 4+ simulators manually are caught automatically
- False positive rate is low enough that the developer runs the pipeline before every push. Measured qualitatively during first 2 weeks of use — if the developer stops running it, investigate why.

## Scope Boundaries

- This pipeline runs locally only — CI integration is a separate future effort
- No visual regression baselining system (e.g., Percy, Chromatic) — Claude's visual judgment replaces pixel-diff tooling for now
- No performance testing — this pipeline checks correctness and visual fidelity, not speed or memory
- No accessibility auditing beyond what Claude spots in visual review — dedicated a11y testing is separate
- Layer 4 exploratory testing (Claude autonomously navigating via taps/keystrokes) is not in scope — flow runners handle all navigation, Claude only reviews screenshots
- The pipeline does not replace human judgment for novel/ambiguous UI decisions — it catches regressions and platform divergence

## Key Decisions

- **Maestro for mobile (iOS + Android), custom YAML runner for TV (tvOS + Android TV)**: Maestro's YAML syntax is simpler, more LLM-friendly for generation, requires no native module integration, and has built-in flakiness handling. However, Maestro does not support tvOS and its touch primitives don't map to TV focus navigation. Research confirmed three viable TV options — Appium (most battle-tested), Agent Device (most Claude-native), and a custom YAML runner (simplest). The custom runner wins for local-only use: both backends are verified working (`osascript` for tvOS, `adb keyevent` for Android TV), zero external dependencies, and the YAML format is trivially LLM-generatable. The runner can be swapped to Agent Device later if Callstack matures its TV D-pad support — the YAML flow files stay the same.
- **Claude generates tests, developer reviews assertions before committing**: Research shows Claude excels at test scaffolding but has a documented oracle problem — it asserts what code does, not what it should do. Generated tests are committed to the repo after human review so they run deterministically.
- **Playwright for web**: Playwright is faster than Cypress, supports multiple browsers natively, and has better Claude Code integration via the Playwright MCP server.
- **`/qa` as a Claude Code skill, not a standalone script**: Layers 2 and 4b require LLM inference (diff analysis, screenshot review). A standalone `pnpm qa` script cannot invoke Claude. The skill orchestrates deterministic layers (1, 3, 4a) via Bash and performs LLM layers (2, 4b) inline.
- **Layer 2 as a smart gate**: Running all flows on every surface for every change is wasteful. Diff analysis determines which surfaces are affected, keeping typical runs fast. For unit tests (Layer 3), Turbo's `--filter=[HEAD^1]` provides the same gating at zero cost.

## Dependencies / Assumptions

**Already present:**

- iOS Simulator, Android Emulator, tvOS Simulator, Android TV Emulator — all installed
- `xcrun simctl` — available via Xcode
- vitest configured in `apps/web` (node environment, `.test.ts` only)
- jest-expo configured in `apps/mobile` and `apps/tv` (zero test files, `--passWithNoTests`)
- Turbo `test` task with change detection

**Requires setup before Layer 3 component tests:**

- `apps/web`: add `jsdom` or `happy-dom` as vitest environment, add `@testing-library/react`, update vitest include to accept `.test.tsx`
- `apps/mobile`: add `@testing-library/react-native`
- `apps/tv`: add `@testing-library/react-native`

**Requires setup before Layer 4a:**

- Maestro CLI installed (`brew install maestro`) — for iOS + Android flows
- Playwright installed as `apps/web` devDependency — for browser flows
- Custom TV YAML runner built (~100-200 lines TS) — for tvOS + Android TV flows
- `$ANDROID_HOME` or `$ANDROID_SDK_ROOT` set (currently unset — `adb` exists at `~/Library/Android/sdk/platform-tools/adb` but is not in `$PATH`)
- macOS Accessibility permissions granted for `osascript` to send keystrokes to Simulator (tvOS backend)
- Simulators pre-booted before `/qa` runs, or the skill boots them (cold boot adds 15-60s per simulator)

**Machine resources:**

- 32GB RAM — sufficient for 2-3 simultaneous simulators

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Technical] What is the best directory structure for Maestro flows and Playwright tests in this monorepo? Should they live alongside app code or in a top-level `e2e/` directory?
- [Affects R12][Technical] What screenshot naming convention should flows use so Claude can associate screenshots with specific surfaces and screens? (Blocks Layer 4b — must be resolved before R13-R15 can be implemented.)
- [Affects R19][Technical] Benchmark parallel simulator capacity — test 2 vs 3 simultaneous simulators to determine optimal batching. All simulators are currently `Shutdown`; cold boot timing should be measured.
- [Affects R6][Technical] How does Claude know when to generate new tests vs. when to run existing ones? During a `/qa` run, Layer 2 could flag coverage gaps, and the developer could choose to invoke test generation separately (e.g., `/qa --generate`) rather than on every run.

## Test Coverage Estimates

| App       | Flows to author | Surfaces              | Total runs    |
| --------- | --------------- | --------------------- | ------------- |
| web       | ~20 Playwright  | 1 (browser)           | 20            |
| mobile    | ~23 Maestro     | 2 (iOS + Android)     | 46            |
| tv        | ~18 custom YAML | 2 (tvOS + Android TV) | 36            |
| **Total** | **~61 flows**   |                       | **~102 runs** |

Incremental rollout: start with ~15 critical-path flows (video playback, search, navigation) across all 3 apps.

## Next Steps

-> `/ce:plan` for structured implementation planning — start with Layer 2 (`/qa` skill) + Layer 3 infrastructure setup for immediate value, then Layer 4a (Maestro for mobile, Playwright for web, custom YAML runner for TV).
