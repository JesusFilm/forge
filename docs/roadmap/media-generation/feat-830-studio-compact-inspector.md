---
id: "feat-830"
title: "Make the Studio inspector compact"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Apply the user's Resolve reference to the right inspector in
`apps/manager/src/features/video-studio/studio.css`: inline labels and compact
controls, tighter section spacing, paired transform values, and a full-width
text editor. Preserve existing control labels, native input behavior and all
editing commands. Scope styling to the inspector so asset dialogs stay unchanged.
No added client initialization, imports, media requests or dependencies.

## Verification

Measure text inspector height before and after and verify video properties in a
browser using the actual Inspector component. Verify numeric edits, selects and checkboxes still update
EditorSession and controls fit the panel. Compare page load/resource timings.
Run formatting, diff whitespace checks and manager typecheck (CSS-only scope).

## Outcome

Inspector-scoped CSS uses labels beside 24px controls, 4px row margins, compact
section dividers, a 40px color swatch, and paired X/Y inputs. The text editor stays
full width. Text inspector content measured 868px versus 1532px before (43% less).
Video inspector measured 908px; both have zero horizontal overflow in a 229px
content viewport. Paired numeric inputs remain 85px wide. Browser interactions
verified font size 84, Inter selection and enabling shadow update EditorSession.

Loading evidence from the same actual-component fixture: DOM/load 515/524ms before,
321/328ms after (warm-cache observation, not a claimed speedup). Identical resource
counts: one metadata request, two waveforms, three thumbnails, all after load.
Selection and input changes add no requests. No imports, effects, dependencies or
new initialization were added. Manager typecheck, Prettier and diff checks pass.
Remote app preview responds with its normal authentication redirect (307).

Durable rule: compact inspector styles must be scoped beneath `.nle-inspector`
after the shared editor input rules; preserve full-width multiline fields and
native control labels while placing ordinary fields inline.
