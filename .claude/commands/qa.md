Run the cross-platform local QA pipeline for the current working tree changes.

Follow project rules in `CLAUDE.md` and `AGENTS.md`.

## Pipeline Overview

This pipeline has 4 layers:

1. **Layer 1** — Typecheck + Lint (deterministic, fast gate)
2. **Layer 2** — Diff analysis with platform risk flagging (LLM)
3. **Layer 3** — Unit/component tests (deterministic)
4. **Layer 4a** — Automated UI flows per surface (Playwright, Maestro, TV YAML runner)
5. **Layer 4b** — Visual screenshot review (LLM)

Layer 1 failures STOP the pipeline. Layer 3 and 4a failures WARN and continue. Layer 4b findings are informational with severity ratings.

---

## Layer 2: Diff Analysis

Perform this analysis FIRST because it determines which packages and surfaces are affected for ALL other layers.

### Step 2.1 — Read the diff

Run:

```bash
git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null
```

If nothing is returned (no changes), also check:

```bash
git diff --name-only main...HEAD 2>/dev/null
```

Collect the full list of changed file paths.

### Step 2.2 — Identify affected packages

Map changed files to packages using these rules:

| Path prefix              | Package filter        | Surfaces                                                  |
| ------------------------ | --------------------- | --------------------------------------------------------- |
| `apps/web/`              | `@forge/web`          | browser                                                   |
| `apps/mobile/`           | `@forge/mobile`       | iOS, Android                                              |
| `apps/tv/`               | `@forge/tv`           | tvOS, Android TV                                          |
| `apps/cms/`              | `@forge/cms`          | (none — CMS changes affect schema, not surfaces directly) |
| `packages/graphql/`      | `@forge/graphql`      | browser, iOS, Android, tvOS, Android TV                   |
| `packages/video-player/` | `@forge/video-player` | browser                                                   |

**Dependency graph for shared packages:**

- `packages/graphql` is consumed by: `@forge/web`, `@forge/mobile`, `@forge/tv`
- `packages/video-player` is consumed by: `@forge/web` only

When a shared package changes, include ALL its downstream consumer packages in the affected set.

Build two lists:

- **affectedFilters**: the `--filter=` arguments for Turbo (e.g., `--filter=@forge/web --filter=@forge/tv`)
- **affectedSurfaces**: the surfaces that need Layer 4a testing (e.g., `browser`, `iOS`, `Android`, `tvOS`, `Android TV`)

### Step 2.3 — Platform risk analysis

Scan the full diff content (`git diff` and `git diff --cached`) for these known cross-platform divergence patterns:

| Pattern                                                        | Risk                                                     | Surfaces affected              |
| -------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| `Platform.select` or `Platform.OS`                             | Platform-specific behavior branching                     | iOS/Android or tvOS/Android TV |
| `StyleSheet.create` with `shadow*` properties                  | Shadows render differently on Android (elevation) vs iOS | iOS, Android                   |
| Safe area usage (`useSafeAreaInsets`, `SafeAreaView`)          | Inset values differ across devices                       | iOS, Android                   |
| `TVFocusGuideView`, `hasTVPreferredFocus`                      | TV focus navigation patterns                             | tvOS, Android TV               |
| `ScrollView` with focus-related props                          | Focus fight risk on TV                                   | tvOS, Android TV               |
| Absolute positioning (`position: 'absolute'`) in TV components | Focus loss risk on TV                                    | tvOS, Android TV               |
| `WebView` usage                                                | WebView crashes on tvOS — must be conditional            | tvOS                           |
| `LayoutAnimation`                                              | Requires explicit enable on Android                      | Android, Android TV            |
| `KeyboardAvoidingView`, keyboard handling                      | Different behavior iOS vs Android                        | iOS, Android                   |
| Gesture handlers (`PanGesture`, `onTouchStart`)                | Touch vs D-pad input model                               | tvOS, Android TV (no touch)    |
| `BlurView` / `expo-blur`                                       | iOS only — Android needs fallback                        | Android                        |
| `expo-glass-effect`                                            | iOS only — Android needs fallback                        | Android                        |
| Video player changes (`expo-video`, `video.js`)                | Different player APIs per platform                       | All                            |
| GraphQL query/mutation changes                                 | Data shape affects all consumers                         | All                            |
| Image handling (`next/image` vs `expo-image`)                  | Different optimization per platform                      | browser vs mobile/TV           |

Report each risk found with:

- The pattern matched
- The file(s) where it appears
- Which surfaces are specifically at risk
- A brief explanation of what could go wrong

### Step 2.4 — Suggest missing tests

For each changed file, check whether a colocated test file exists (e.g., `Foo.tsx` -> `Foo.test.tsx`). If not, note it as a coverage gap. Do not generate tests — just flag them.

### Step 2.5 — Output verdict

Produce a structured verdict:

```
## Layer 2 Verdict

**Affected packages:** @forge/web, @forge/tv
**Affected surfaces:** browser, tvOS, Android TV
**Turbo filter args:** --filter=@forge/web --filter=@forge/tv

### Platform risks found
- [P1] `Platform.select` in apps/tv/src/components/QuizModal.tsx — tvOS renders QR code, Android TV renders WebView. Verify both paths.
- [P2] Shadow properties in apps/web/src/components/Card.tsx — may render differently on browsers with different GPU acceleration.

### Coverage gaps
- apps/web/src/components/SearchOverlay.tsx — no test file found
- apps/tv/src/components/QuizModal.tsx — no test file found

### Recommended action
Run Layer 4 on: browser, tvOS, Android TV
```

If the verdict determines NO surfaces are affected (pure documentation, config-only, or CMS-only changes with no UI impact), report:

```
## Layer 2 Verdict

No UI testing needed. Changes are limited to [description].
Pipeline complete — PASS.
```

And STOP the pipeline here.

---

## Layer 1: Typecheck + Lint

Using the **affectedFilters** from Layer 2's verdict, run:

```bash
pnpm turbo run typecheck lint <affectedFilters>
```

For example:

```bash
pnpm turbo run typecheck lint --filter=@forge/web --filter=@forge/tv
```

**If Layer 1 FAILS:** Report the errors clearly and STOP the pipeline. Do not proceed to Layer 3 or 4.

**If Layer 1 PASSES:** Continue to Layer 3.

---

## Layer 3: Unit/Component Tests

Using the same **affectedFilters** from Layer 2, run:

```bash
pnpm turbo run test <affectedFilters>
```

**If Layer 3 FAILS:** Report the failures as WARNINGS but CONTINUE to Layer 4. The UI flows may reveal the root cause visually.

**If Layer 3 PASSES:** Continue to Layer 4.

---

## Layer 4a: Automated UI Flows

Before running any flows, check CMS availability:

```bash
curl -sf http://localhost:1337/graphql -o /dev/null -w "%{http_code}" 2>/dev/null || echo "CMS_DOWN"
```

If CMS is down, WARN:

> CMS is not reachable at http://localhost:1337/graphql. E2E flows will likely screenshot error states.
> Options: (1) Start CMS with `pnpm --filter @forge/cms dev`, (2) Set INTERNAL_GRAPHQL_URL in .env.local to a staging URL.

Then proceed — some flows may still provide useful screenshots even without CMS.

### Layer 4a — Browser (Playwright)

**Run when:** `browser` is in affectedSurfaces.

```bash
cd apps/web && pnpm run e2e
```

This runs all Playwright flows in `apps/web/e2e/flows/` and saves screenshots to `apps/web/e2e/screenshots/browser/`.

Report results: number of flows passed/failed, any failures with error messages.

### Layer 4a — iOS + Android (Maestro)

**Run when:** `iOS` or `Android` is in affectedSurfaces.

For iOS:

```bash
cd apps/mobile && maestro test --device ios .maestro/ --output e2e/screenshots/ios/
```

For Android:

```bash
cd apps/mobile && maestro test --device android .maestro/ --output e2e/screenshots/android/
```

Run iOS and Android in parallel if resources allow (check available simulators first):

```bash
xcrun simctl list devices booted 2>/dev/null
adb devices 2>/dev/null
```

Report results per surface.

### Layer 4a — tvOS + Android TV (TV YAML Runner)

**Run when:** `tvOS` or `Android TV` is in affectedSurfaces.

**Important:** tvOS flows require exclusive foreground (AppleScript keystroke injection). Do NOT run tvOS in parallel with other keyboard-interactive tasks.

For Android TV (can run in parallel with other flows):

```bash
cd apps/tv && pnpm run e2e:androidtv
```

For tvOS (run sequentially, after other flows complete):

```bash
cd apps/tv && pnpm run e2e:tvos
```

Report results per surface.

---

## Layer 4b: Visual Review

After all Layer 4a flows complete, review the captured screenshots.

### Step 4b.1 — Collect screenshots

List all screenshots captured during this run:

```bash
find apps/web/e2e/screenshots apps/mobile/e2e/screenshots apps/tv/e2e/screenshots -name "*.png" 2>/dev/null
```

### Step 4b.2 — Review screenshots

For each surface that ran, review the screenshots and check for:

- Broken layouts (elements overlapping, clipping, missing)
- Missing content (empty areas that should have data)
- Rendering errors (blank screens, error messages, spinners that never resolved)
- Text truncation or overflow
- Incorrect colors or contrast issues

### Step 4b.3 — Cross-platform comparison

For platform pairs, compare screenshots of the same flows:

**Mobile pair: iOS vs Android**

- Compare layout consistency
- Check safe area handling differences
- Verify font rendering is acceptable on both
- Check shadow/elevation rendering
- Verify platform-specific UI (blur vs dark overlay, ripple vs opacity)

**TV pair: tvOS vs Android TV**

- Compare focus ring appearance
- Check quiz modal rendering (QR code vs WebView)
- Verify carousel navigation states
- Check text rendering and layout consistency
- Verify platform-specific D-pad behavior results

### Step 4b.4 — Report discrepancies

Rate each discrepancy:

- **P0 — Blocking:** Broken layout, missing content, crash, unusable UI
- **P1 — Should Fix:** Noticeable spacing/font/color differences, truncated text, misaligned elements
- **P2 — Cosmetic:** Minor rendering variance, slight anti-aliasing differences, subpixel shifts

---

## Final Report

After all layers complete, produce a summary report:

```
## QA Pipeline Report

### Layer 1: Typecheck + Lint
PASS (or FAIL with details)

### Layer 2: Diff Analysis
Affected: [surfaces]
Risks: [count] platform risks identified
Gaps: [count] missing test files

### Layer 3: Unit/Component Tests
PASS / WARN: [N] test(s) failed (with details)

### Layer 4a: Automated UI Flows
- Browser: [N] flows passed, [N] failed
- iOS: [N] flows passed, [N] failed
- Android: [N] flows passed, [N] failed
- tvOS: [N] flows passed, [N] failed
- Android TV: [N] flows passed, [N] failed

### Layer 4b: Visual Review
- [N] discrepancies found
  - P0: [count]
  - P1: [count]
  - P2: [count]
- [Details of each discrepancy]

### Overall Verdict
[PASS / WARN / FAIL] — [summary sentence]
```
