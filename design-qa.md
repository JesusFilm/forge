# Design QA: Native Watch feedback

## Source and implementation

- Source visual truth: `/home/lado/.codex/generated_images/01a02171-67a8-7dd1-8c6d-05784ddc3532/exec-570ed5ec-8ffa-4b79-881c-5c8e772763e2.png`
- Final desktop implementation: `/tmp/watch-feedback-desktop-final.png`
- Final mobile implementation: `/tmp/watch-feedback-mobile.png`
- Normalized full-view comparison: `/tmp/watch-feedback-comparison.png`
- Desktop CSS viewport: 1440 by 1058 at device pixel ratio 1. The in-app
  browser capture contains the visible 1250 by 1058 pixel region.
- Source pixels: 1487 by 1058. The source was center-cropped to the intended
  1440-pixel CSS viewport, then cropped to the browser's same visible 1250 by
  1058 region without scaling.
- Mobile CSS viewport and saved screenshot: 390 by 844 pixels at device pixel
  ratio 1.
- State: dark Watch page; Problem category; Blocking me impact; required name
  and email filled; technical details included but collapsed.

## Full-view comparison evidence

- The normalized side-by-side comparison shows the same centered dark composer,
  a five-step flow with four large icon tabs, contextual message field, the
  shared searchable language picker, direct media/collection title search,
  non-blocking manual language and content fallbacks,
  two-column identity row, page context, element marker, diagnostic consent,
  trust note, and paired actions.
- The implementation preserves the source hierarchy while using the existing
  Watch Montserrat typography, brand-red token, shared dialog overlay, Lucide
  icons, and real page context.
- The final desktop form measures 800 pixels wide and 995 pixels tall. Its full
  content and actions fit without internal scrolling at the comparison height.
- The mobile capture correctly becomes a full-screen composer, changes category
  tabs to a two-column grid, stacks optional context fields, and keeps one
  vertical scroll surface with no horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: Watch's Montserrat family, existing optical weights,
  line heights, and stone hierarchy are used. Heading, field labels, helper
  text, values, and compact metadata remain clearly differentiated without
  unintended wrapping on desktop.
- Spacing and layout rhythm: modal centering, 800-pixel frame, 24-pixel desktop
  vertical padding, four-column tab grid, section gaps, 12-pixel radii, and
  footer alignment closely follow the target. Mobile uses safe full-height
  bounds and expected stacked spacing.
- Colors and visual tokens: the implementation uses Watch black/stone surfaces,
  white opacity borders, and `brand-red` for selection, validation, checkbox,
  and submit states. Contrast and semantic emphasis match the target.
- Image quality and asset fidelity: this form has no raster product imagery.
  All visible icons use the project's Lucide icon library; no placeholder,
  emoji, CSS drawing, or handcrafted SVG replaces a target asset.
- Copy and content: the selected concept's heading, helper, category labels,
  language/content context, required identity fields, page context, optional element
  marking, diagnostics disclosure, trust note, and submit copy are present.
  The implementation intentionally leaves diagnostics unchecked until explicit
  consent and keeps public submissions separate from Linear priority.

## Focused comparison evidence

- No additional crop was needed: the 2500 by 1058 normalized comparison keeps
  tab icons, small helper copy, input values, metadata, consent disclosure, and
  footer controls readable at native height.
- Browser interaction separately verified category and context selection,
  required identity fields, diagnostic opt-in, semantic element selection, and
  mobile reflow.

## Interaction and runtime verification

- Category and context controls update their state and contextual copy.
- Required name, email, and message validation are covered without sending a
  real report during browser QA.
- Diagnostic values remain hidden until consent and can be previewed.
- Page marking temporarily dismisses the dialog. Selecting the visible Search
  control reopens it with `Search videos` recorded as a `button`, without
  activating the underlying search action or capturing form contents.
- The only browser-console errors came from the Codex browser extension's frame
  manager; no application error was recorded.
- The visible `N` control in the mobile development capture is Next.js tooling
  and is not part of the production interface.

## Comparison history

- First pass finding (P2): `/tmp/watch-feedback-matched-v2.png` required a short
  internal desktop scroll to reach the persistent actions, and its close action
  followed the global Watch viewport pattern instead of the selected composer's
  inset placement.
- Fix: the composer now uses the target's 94-dvh desktop bound, tighter message
  field and vertical rhythm, and an inset dialog close button.
- Post-fix evidence: `/tmp/watch-feedback-desktop-final.png` reports equal
  `clientHeight` and `scrollHeight` of 995 pixels with `scrollTop` 0, and shows
  all actions and the close control in the intended frame.
- Browser QA also exposed a semantic selection issue where a nested element
  could be recorded as a generic `div`. The picker now resolves nested targets
  to the nearest meaningful control or content landmark; the browser verified
  `Search videos` as a `button`, and the component test covers nested spans.

## Findings

- No remaining P0, P1, or P2 visual or interaction findings.

## Follow-up polish

- P3: translate the new form body copy across Watch's full locale catalog in a
  dedicated localization scope. The replaced Google form was English-only;
  existing launcher and close labels remain localized in this change.

## Result

final result: passed
