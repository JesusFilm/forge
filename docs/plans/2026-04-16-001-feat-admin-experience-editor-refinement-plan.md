# Admin Experience Editor Refinement Plan

## Scope

Finish the current admin experience editor block-by-block. Each supported block
should have a meaningful canvas preview, first-class inspector controls for the
settings operators commonly change, valid save serialization, and focused tests
for any extracted behavior. This follows
`docs/roadmap/platform/feat-103-admin-experience-editor-refinement.md` and
builds on the completed parity work in
`docs/roadmap/platform/feat-101-admin-experience-block-editor-parity.md`.

## Current Baseline

The route `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` already
loads experience locales, revision entries, video library rows, and server
actions for save, publish, and restore. The client component
`apps/admin/src/app/dashboard/experiences/experience-editor.tsx` provides the
canvas, block library, inspector rail, video picker, drag handling, and hidden
form serialization.

The main risk is concentration: a single client file owns block metadata,
payload normalization, canvas rendering, nested-item editing, video picking,
action state, and rail rendering. Future block refinements will be fragile until
the shared block helpers are pulled into testable modules.

## Block Readiness Matrix

Use this as the working scoreboard. A block is not finished until its common
operator path does not require raw JSON editing.

| Block                 | Current State                                                                    | Finish Criteria                                                             |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `videoHero`           | Rich canvas, video picker, route-video toggle, CTA settings                      | Validate helper extraction and publish/save posture                         |
| `video`               | Rich canvas, video picker, route-video toggle, metadata restore                  | Validate helper extraction and publish/save posture                         |
| `videoCarousel`       | Rich manual item add/reorder/edit, route-children toggle                         | Add serialization tests and confirm empty item override cleanup             |
| `mediaCollection`     | Finished manual item add/edit/move/remove controls; route-video source preserved | Add visual verification in browser pass                                     |
| `text`                | Inline heading/subtitle/body editing plus style settings                         | Add serialization tests                                                     |
| `cta`                 | Inline copy editing plus link/style settings                                     | Add serialization tests                                                     |
| `infoBlocks`          | Finished first-class card add/edit/move/remove controls                          | Add visual verification in browser pass                                     |
| `card`                | Inline title/description plus link/media/style settings                          | Add serialization tests and optional media URL cleanup                      |
| `bibleQuotesCarousel` | Rich quote add/reorder/edit/remove cards                                         | Add serialization tests and optional URL cleanup                            |
| `relatedQuestions`    | Rich question add/reorder/edit/remove cards                                      | Add serialization tests                                                     |
| `navigationCarousel`  | Finished first-class destination add/edit/move/remove controls                   | Add visual verification in browser pass                                     |
| `promoBanner`         | Inline copy plus intro/link/width settings                                       | Add serialization tests                                                     |
| `section`             | Pending refinement; needs vertical nested block composition controls             | Add first-class vertical composition editing and visual verification        |
| `container`           | Pending refinement; needs horizontal 12-column slot composition controls         | Add first-class horizontal/grid composition editing and visual verification |
| `easterDates`         | Inline seasonal labels plus locale settings                                      | Add serialization tests                                                     |
| `adventCountdown`     | Inline seasonal copy plus locale settings                                        | Add serialization tests                                                     |

## Visual Thesis

Extend the existing dense editorial workspace: calm dark surfaces, compact
operator controls, clear selected-state feedback, and explicit save/publish
posture.

## Content Plan

Keep the current three-pane shape: locale list on the left, block canvas in the
center, and action/inspector/settings rail on the right. Add refinement where it
helps the operator understand whether the current draft is changed, valid, and
ready to publish.

## Interaction Plan

Preserve current drag, add-block, and video-picker interactions. Add small,
state-driven feedback only where it clarifies actions: changed vs unchanged,
save disabled reasons, publish disabled reasons, and block insertion/selection
continuity.

## Implementation Units

### Unit 1 - Extract Block Helpers And Contract Tests

Files:

- Create `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- Create `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- Modify `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

Approach:

Move pure helpers out of the client component: safe value readers, block
template creation, block summarization, optional-field normalization, and block
type metadata where practical. Keep React rendering and state mutation in the
client component.

Test scenarios:

- Every `BlockTemplateKey` creates a payload accepted by `BlockSchema`.
- Optional empty URL-like fields are removed recursively before save.
- Summaries for video, text, collection, section, and unknown payloads remain
  meaningful and stable.

### Unit 2 - Payload Correctness

Files:

- Modify `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- Modify `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- Modify `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`

Approach:

Normalize editor-authored empty optional fields before serialization in a way
that aligns with `apps/admin/src/domain/blocks.ts`. Prefer omitting optional
fields over sending `null` or empty strings for schema fields that do not accept
those values.

Test scenarios:

- Video, card, media collection, Bible quote, and carousel templates serialize
  without invalid empty URL fields.
- Clearing optional numeric clip fields omits them instead of sending `null`.
- The serialized block array validates with `BlocksSchema`.

### Unit 3 - Finish Remaining Nested Blocks

Files:

- Modify `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- Add extracted components under
  `apps/admin/src/app/dashboard/experiences/experience-editor/` when a nested
  block becomes large enough to test independently.

Approach:

Work in small batches, starting with the blocks that currently force operators
into JSON for normal editing: `infoBlocks`, `mediaCollection`, and
`navigationCarousel`. Then decide, with the current implementation in front of
us, whether `section` and `container` need full nested block editing now or a
clearer structured affordance that keeps raw JSON as an expert escape hatch.

Test scenarios:

- Operators can add, edit, reorder, and remove repeatable nested items for each
  finished block.
- Clearing optional nested URL fields still serializes to a `BlocksSchema`-
  valid payload.
- Collapsed canvas previews remain readable after nested item changes.

### Unit 4 - Action Rail Confidence

Files:

- Modify `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- Add or update a focused UI test if an existing render harness can cover the
  behavior.

Approach:

Add compact action-state copy in the right rail: saved/unsaved indicator,
disabled save reason, disabled publish reason, and current locale publish
posture. Keep the copy utility-like and short.

Test scenarios:

- Unchanged draft disables save and communicates that there are no changes.
- Changed draft enables save.
- Publish communicates permission, unchanged, and unpublished-new-locale states.

### Unit 5 - Validation And Visual Check

Files:

- No expected source changes unless validation finds a real issue.

Approach:

Run focused tests first, then admin lint/typecheck/test. If local data and auth
are available, run the admin app and inspect the editor route at desktop width
and a narrower viewport for text fit and rail usability.

Verification:

- `pnpm --filter @forge/admin test -- experience-editor`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`

## Boundaries

Do not rebuild the editor layout, replace the service path, or add new database
models. Do not touch unrelated login-copy work currently present in the
worktree.
