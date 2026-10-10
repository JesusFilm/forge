---
title: "Manager Dark Contrast Polish - Plan"
type: fix
date: 2026-08-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Manager Dark Contrast Polish

## Objective

Improve the Manager application's dark theme page by page so its warm charcoal foundation, text hierarchy, semantic colors, and component surfaces remain readable and visually consistent. Preserve the light theme and all existing application behavior.

## Scope

### In scope

- Dark-theme color and contrast corrections in `apps/manager/src/app/globals.css`.
- Coverage, Jobs, Smart Crop, SEO, Shorts, Agents, shared shell, and theme-menu visual verification.
- Preservation and completion of the existing uncommitted dark-theme tuning work.
- Normalization of the untracked roadmap tickets to unused sequential IDs, plus a ticket for this audit.

### Out of scope

- Routing, data fetching, workflow logic, hydration, or theme synchronization changes.
- New design tokens, new hexadecimal colors, or changes to light-theme rules.
- Production deployment outside the normal PR-to-main flow.

## Settled Decisions

1. Use a warm near-neutral charcoal foundation. This is user-directed. A cold neutral foundation and a visibly brown foundation were both rejected in prior visual reviews. Governs R1 and R8.
2. Use `#141414` for the dark sidebar. This is user-directed from the supplied reference swatch; a near-black sidebar was rejected as too dark. Governs R1.
3. Use calm, lower-saturation semantic status colors on dark surfaces. This is user-directed; the bright light-theme reds and greens were rejected as acidic. Governs R2, R3, and R4.

## Requirements

- **R1 — Foundation:** Preserve the current warm dark foundation and the `#141414` sidebar while leaving the light theme unchanged.
- **R2 — Contrast:** Small dark-theme status labels and semantic text must meet at least 4.5:1 contrast; large text must meet at least 3:1; graphical status indicators must meet at least 3:1 against adjacent surfaces.
- **R3 — Coverage semantics:** Subtitle, audio, and metadata coverage legends must use the existing dark coverage semantic text tokens instead of legacy literal colors.
- **R4 — Completion semantics:** Jobs and Smart Crop completed steps and summaries must use existing success tokens and remain distinct from pending and active states.
- **R5 — Secondary text:** Dark-theme job loading, review, player, chapter, and Agents metadata copy must use the existing muted text token rather than light-theme foreground aliases.
- **R6 — Disabled mismatch cards:** SEO mismatch explanations must remain readable while retaining a clear disabled cue; do not dim the entire card with blanket opacity.
- **R7 — Thumbnail depth:** Empty and error Shorts thumbnails must have visible depth on dark surfaces using existing surface tokens.
- **R8 — Behavioral stability:** Do not change routes, data, workflows, hydration, theme synchronization, or add new tokens, hexadecimal values, or one-off color systems.
- **R9 — Roadmap integrity:** Preserve prior in-scope tuning work, normalize the untracked ticket IDs to the next unused sequence, keep dependencies bidirectional, and close the audit ticket after verification.

## Success Criteria

- Every affected dark-theme route has clear primary, secondary, muted, disabled, and semantic-state hierarchy.
- Coverage reds, greens, and purple remain identifiable without appearing fluorescent or low-contrast.
- Jobs and Smart Crop completed steps are visibly successful rather than black or indistinguishable.
- SEO disabled mismatch details are legible without appearing interactive.
- The sidebar, content canvas, cards, controls, and borders preserve intentional warm depth without reading as brown.
- The same routes remain visually unchanged in light theme except for pre-existing behavior.
- Focused tests, TypeScript, formatting, browser console checks, and responsive visual checks pass.

## Key Technical Decisions

### KTD1 — Dark-scoped overrides only

Use existing semantic tokens inside dark-theme selectors. Do not alter base light-theme rules. This implements R1, R3–R8 and limits regression risk.

### KTD2 — Resolve the winning cascade in place

Replace or remove the final winning hard-coded declarations instead of stacking another page-specific patch at the end of the stylesheet. This implements R3–R7 and keeps computed styles traceable.

### KTD3 — Browser output is the visual authority

Source tests protect structure and state, but real routes and computed colors are the proof for contrast and cascade behavior. This governs the verification contract for R2–R7.

### KTD4 — Normalize untracked roadmap identity before shipping

Reserve the new upstream `feat-405`, rename the four Manager follow-up tickets to `406/407/408/409`, update all dependency references, and create `feat-410` for this audit. This implements R9 without rewriting tracked history.

## Implementation Units

### Unit 1 — Normalize roadmap scope and identity

**Files**

- Rename the Manager palette, SEO, alias, and sidebar tickets to `feat-406` through `feat-409`.
- `docs/roadmap/platform/feat-406-manager-dark-palette-tuning.md`
- `docs/roadmap/platform/feat-407-manager-seo-priority-list-restyle.md`
- `docs/roadmap/platform/feat-408-manager-dark-legacy-foreground-aliases.md`
- `docs/roadmap/platform/feat-409-manager-dark-sidebar-depth.md`
- `docs/roadmap/platform/feat-410-manager-dark-contrast-audit.md`
- `docs/roadmap/README.md`

**Changes**

- Rename the existing untracked tickets according to KTD4.
- Repair the final graph so `feat-406` depends on `feat-401` and blocks
  `feat-407`, `feat-408`, `feat-409`, and `feat-410`; `feat-407`, `feat-408`,
  and `feat-409` each depend on `feat-406` and block `feat-410`; and `feat-410`
  depends on all four predecessor tickets.
- Add `feat-410` with exact affected selectors, route coverage, constraints, and verification commands; mark it `in-progress` before CSS changes and `complete` after verification.
- Add the normalized Manager entries to the roadmap feature index and remove no
  tracked entry.

**Test expectation**

- No automated test required for documentation-only changes; formatting and dependency review are required.

### Unit 2 — Correct dark semantic consumers and cascade winners

**File**

- `apps/manager/src/app/globals.css`

**Changes**

- Replace the scoped Coverage legend literals with `--coverage-human-text`, `--coverage-none-text`, and `--coverage-ai-text`.
- Make final Jobs and Smart Crop completed-step declarations use `--ds-success`; use the existing success treatment for completed summaries instead of a hard-coded legacy green.
- Add dark-scoped muted mappings for review summaries, loading copy, player placeholders, chapter copy, step subtitles, and Agents row metadata.
- Remove blanket opacity from disabled SEO mismatch cards and express the disabled cue using existing surfaces, borders, and muted text tokens.
- Give Shorts picker thumbnails an existing muted-panel fill, including empty and error states, without adding a new color.
- Preserve all existing light-theme declarations and avoid new tokens or literal colors.

**Test expectation**

- No new unit test is warranted for CSS-only color substitutions. Existing focused component and theme tests must pass, followed by computed-style and visual browser verification.

## Verification Contract

### Focused automated checks

```bash
pnpm --filter @forge/manager exec vitest run \
  src/lib/manager-theme.test.ts \
  src/features/shell/manager-theme-sync.test.ts \
  src/features/shell/manager-shell-user-menu.test.ts \
  src/features/coverage/selected-video-stack.test.ts \
  src/features/jobs/review-player/review-player-card.test.ts \
  src/features/seo/seo-workspace.test.ts \
  src/features/shorts/shorts-picker.test.ts \
  src/features/agents/automation-list-presenter.test.ts

pnpm --filter @forge/manager typecheck

pnpm exec prettier --check \
  apps/manager/src/app/globals.css \
  docs/plans/2026-08-21-0913-fix-manager-dark-contrast-plan.md \
  docs/roadmap/README.md \
  docs/roadmap/platform/feat-406-manager-dark-palette-tuning.md \
  docs/roadmap/platform/feat-407-manager-seo-priority-list-restyle.md \
  docs/roadmap/platform/feat-408-manager-dark-legacy-foreground-aliases.md \
  docs/roadmap/platform/feat-409-manager-dark-sidebar-depth.md \
  docs/roadmap/platform/feat-410-manager-dark-contrast-audit.md
```

### Browser verification

Inspect real routes in both dark and light themes at desktop and narrow widths:

- Shared shell, sidebar, report selector, user menu, and theme control.
- Coverage: subtitles, audio, and metadata.
- Jobs: list and detail/review.
- Smart Crop: list and detail.
- Shorts: list and create for empty/error thumbnails, plus job detail for
  completed, failed, and pending status summaries.
- SEO: overview, proposals, experiments, learnings, reconciliation, and runs.
- Agents: automation list and metadata.

For each surface:

- Confirm computed colors resolve to existing semantic tokens and that no later selector overrides the intended value.
- Measure every row in this affected-selector acceptance matrix; unavailable
  fixture rows remain incomplete rather than being replaced by a representative
  sample:

  | Selector family                                                 | Foreground or indicator                | Adjacent surface             | Minimum |
  | --------------------------------------------------------------- | -------------------------------------- | ---------------------------- | ------- |
  | Coverage `.stat-legend-item--human`                             | `--coverage-human-text`                | `--ds-bg` and coverage cards | 4.5:1   |
  | Coverage `.stat-legend-item--none`                              | `--coverage-none-text`                 | `--ds-bg` and coverage cards | 4.5:1   |
  | Coverage `.stat-legend-item--ai`                                | `--coverage-ai-text`                   | `--ds-bg` and coverage cards | 4.5:1   |
  | Jobs, Smart Crop, and Shorts `.jobs-progress-summary-completed` | existing success text treatment        | detail and list panels       | 4.5:1   |
  | Jobs and Smart Crop `.jobs-step-dot-completed`                  | `--ds-success`                         | dot-adjacent panel           | 3:1     |
  | Job review/loading secondary copy and `.agents-row-meta`        | `--ds-muted`                           | owning panel                 | 4.5:1   |
  | Disabled SEO mismatch explanation                               | `--ds-muted` or existing semantic text | disabled card surface        | 4.5:1   |
  | Shorts `.shorts-picker-thumb` boundary                          | existing panel and line tokens         | create-page panel            | 3:1     |

- Confirm focus, hover, selected, disabled, loading, empty, and error states remain distinguishable.
- Confirm the console is clean and no additional initialization or loading path was introduced.
- Capture key-screen evidence for the PR.

## Risks and Mitigations

- **Cascade regression:** A later global selector may override the intended dark rule. Mitigate by editing the final winning rule and confirming computed styles.
- **Shared selector impact:** Jobs and Smart Crop share step primitives. Mitigate by reviewing both route families in both themes.
- **Semantic token misuse:** A token can have the right hue but the wrong role. Mitigate by validating role and contrast rather than comparing raw hex values.
- **Fixture gaps:** Some route states may be unavailable locally. Record the missing state explicitly and verify its selector and component test rather than inventing production data.

## Definition of Done

- R1–R9 are satisfied with no new theme behavior, tokens, or literal colors.
- All automated checks in the verification contract pass.
- The page-by-page browser review is complete with key-screen screenshots and no unresolved P0/P1 contrast defect.
- Roadmap dependencies are valid and `feat-410` is marked `complete`.
- Structured review findings are resolved or explicitly handed off.
- The PR is conflict-free, all required checks are green, and it is squash-merged through the normal main-branch flow.
