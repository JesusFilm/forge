# Design QA: Watch share-feedback redesign

## Source and implementation

- Full-screen language reference: `/tmp/codex-clipboard-f814af74-4a8d-4478-8864-f6406506c920.png` (2598 × 2534).
- Cropped legacy feedback reference: `/tmp/codex-clipboard-51f5cd21-0179-4957-97b1-3e55c32b9d89.png` (2152 × 1884).
- Success-state reference: `/tmp/codex-clipboard-d7a656bf-d0f8-4bac-bdc7-b01272d913e4.png` (1824 × 1420).
- Implementation: `apps/web/src/components/FeedbackModal.tsx` and its server actions in `apps/web/src/lib/feedback-action.ts`.
- Desktop evidence: `feedback-native-desktop-initial.png`, `feedback-native-desktop-dropdown.png`, `feedback-native-success-no-email.png`, `feedback-native-success-email-added.png`, and `feedback-native-delivery-failure.png` (1280 × 720 CSS pixels at DPR 1).
- Mobile evidence: `feedback-native-mobile-success.png` (390 × 844 CSS pixels at DPR 1).
- Combined visual inputs: `design-qa-comparison.png` and `design-qa-dropdown-comparison.png`. ImageMagick proportionally scaled each source and implementation capture into equal cells without stretching; the comparison is for visible structure and treatment rather than exact cross-viewport pixel alignment.
- State coverage: initial form, open language menu, successful submission without email, late-email attachment, successful submission with follow-up copy, and failed Linear delivery.

## Full-view comparison

- The implementation now uses the language selector's full-viewport pattern: the Watch page remains visible through one dark blurred overlay, the content sits directly on that surface, and the close control is fixed to the viewport corner.
- The separate rounded feedback parent panel, internal panel scrollbar, and panel border shown in the legacy feedback references are absent by design, matching the user's explicit direction.
- The 800-pixel desktop content column preserves the native five-step hierarchy while leaving the surrounding overlay visually open. At mobile width, the same surface reflows into a single-column full-height flow without horizontal overflow.
- The success state keeps the reference's centered checkmark, heading, restrained body copy, and primary action hierarchy. Its former bordered parent card is intentionally removed so it remains consistent with the language overlay.

## Focused dropdown comparison

- In `design-qa-dropdown-comparison.png`, the legacy menu is visibly constrained by the modal's rounded scrolling box. The new menu opens into the viewport over the shared overlay.
- Browser measurement for the open menu was `top: 344`, `bottom: 622`, `height: 278` in a 720-pixel viewport, confirming the complete list is visible and not clipped by a parent overflow boundary.
- The form content wrapper uses visible overflow, while the viewport owns vertical scrolling for genuinely short screens. This removes the nested scroll surface that caused the original crop.

## Required fidelity surfaces

- Typography: existing Watch Montserrat typography, optical weights, line heights, and stone text hierarchy are preserved across headings, labels, helpers, values, and receipt copy.
- Spacing and layout: the centered 800-pixel column, full-screen overlay, fixed close control, five-step progress rhythm, responsive card grid, and compact footer align with the language-selector composition.
- Color and effects: Watch black/stone surfaces, brand red, subtle white borders, and the existing backdrop blur are reused from the product design system. No additional outer blurred panel was introduced.
- Assets and icons: all visible symbols use the existing Lucide icon dependency. The flow contains no raster product imagery and introduces no placeholder, emoji, handcrafted SVG, or CSS-drawn asset.
- Copy and content: success copy changes by feedback category when an email was supplied; when email was omitted, the receipt offers one final optional email field. A delivery failure retains the completed form and exposes the official Jesus Film Project support form.

## Interaction and runtime verification

- Browser QA completed the five-step desktop journey using synthetic values and a no-side-effect local Linear stub.
- Browser QA verified the open language selector, late-email validation and attachment, email-aware success copy, the 390 × 844 mobile success layout, and the failed-delivery support fallback.
- The existing dynamic-import boundary in `FeedbackLauncher` remains intact; the modal is still loaded only after launcher intent, so the redesign does not add feedback-form work to initial Watch rendering or hydration.
- Focused component/server tests cover full-screen layout, receipt copy, opaque receipt creation, tamper and expiry rejection, sanitized comment creation, and the support URL.
- No application console error was observed. The only console noise was the known Codex browser-extension frame manager and Next.js development-mode cache warning.
- The small Next.js development badge visible in captures is development tooling and is not part of the production interface.

## Comparison history

- Initial supplied state: a bounded rounded feedback panel differed from the language overlay and clipped suggestion menus within its scrolling parent.
- Rebuild: moved the native form directly onto the full-screen overlay, removed the panel surface and internal overflow boundary, and fixed the close action to the viewport.
- Completion pass: added category-aware email follow-up copy, a secure late-email path that comments on the existing Linear issue through a short-lived opaque receipt, and the official support fallback on delivery failure.
- Final combined comparison found no remaining P0, P1, or P2 visual, responsive, or interaction issue.

## Result

final result: passed

---

# Design QA: Minimal Watch coachmark refinement

## Selected target

- User direction: the anchored coachmark should be much smaller and less bulky, and its triangle should not read as a visible outlined shape on top of the modal.
- Before capture: `/tmp/watch-tour-search-final.png`.
- Refined Search capture: `/tmp/watch-tour-search-minimal-final.png`.
- Refined Language capture: `/tmp/watch-tour-language-minimal-final.png`.
- Combined same-state, same-viewport comparison: `/tmp/watch-tour-minimal-comparison.png` at 1280 × 800 per panel.

## Comparison findings

- The targeted card maximum width is reduced from 608 to 440 pixels and its estimated height from 390 to 260 pixels.
- Targeted steps now omit the decorative icon and eyebrow, leaving only progress, title, description, and actions.
- Padding, gaps, typography, button height, corner radius, and shadow are reduced while preserving readable hierarchy.
- The pointer is reduced from 32 to 20 pixels and its fill and stroke now match the card, making it read as a seamless directional nib instead of an outlined triangle icon.
- The Search and Language targets remain clearly spotlighted, and the compact card remains aligned to each target.

## Verification

- Search and Language captures are free of clipping, overlap, and viewport overflow.
- Focused component suite: 10/10 tests passed.
- Dialog-scoped accessibility scan: 0 violations, 0 incomplete checks, 19 passes after correcting progress-label contrast.

## Result

final result: passed

---

# Design QA: Watch introduction anchored coachmarks

## Verdict

Passed. No remaining P0, P1, or P2 visual fidelity issues were found in the corrected Search and Language coachmark states.

## Source and implementation evidence

- Source references: `/tmp/codex-clipboard-328c0505-8694-43e6-9b8a-13814b88da92.png` and `/tmp/codex-clipboard-2de87fa8-0b6b-4efc-a4f9-fd8d942222e0.png`
- Implementation captures: `/tmp/watch-tour-search-final.png` and `/tmp/watch-tour-language-final.png`
- Combined comparison inputs: `/tmp/watch-tour-search-comparison.png` and `/tmp/watch-tour-language-comparison.png`
- Browser viewport: 1280 × 800. The supplied references were normalized onto a 1280 × 800 canvas before comparison because their original viewport sizes differ.

## Fidelity findings

### Search tip

- The Search control is isolated by a dark spotlight and a bright red outline.
- The dialog is positioned immediately below the Search control.
- A visible triangle connects the dialog to the center of the highlighted control.
- The surrounding page is dimmed while the target and dialog remain sharp and readable.

### Language tip

- Advancing moves the spotlight, outline, connector, and dialog to the Language control.
- The target is not blurred or obscured by the shared dialog backdrop.
- The dialog remains fully inside the viewport and preserves the product's existing Watch styling.

## Issues found and resolved

- P1: The original connector was clipped by the popup's scroll container. Resolved by allowing popup overflow and moving scrolling to the inner content region.
- P1: The target outline did not create the strong spotlight effect shown in the references. Resolved with a full-viewport shadow cutout around the active target.
- P1: The spotlight could dim the dialog because it was mounted in a separate document-body portal. Resolved by adding a shared dialog portal layer between the backdrop and popup viewport.
- P2: The shared backdrop blur softened the highlighted Language target. Resolved by disabling backdrop blur only for anchored coachmark steps.

## Functional and accessibility checks

- Search and Language targets remain inert while highlighted.
- Back and Next move the active target and clean up the previous target state.
- Dialog-scoped automated accessibility scan: 0 violations, 0 incomplete checks, 19 passes.
- Focused component suite: 10/10 tests passed.
- Type check and touched-file lint passed.
- Browser console contained development-only informational logs; no runtime errors were reported for the tour.

## Intentional differences from the reference

The implementation uses the Jesus Film Project Watch design system, copy, controls, and target locations rather than cloning Netflix branding. The matched behavior is the requested interaction pattern: successive anchored tips that visibly point to live interface controls.

## Result

final result: passed
