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

# Design QA — Watch series mobile hero

- Source visual truth: `/home/lado/.t3/userdata/attachments/e6b026cd-0be3-4add-a48f-c11d5c9f00cb-9866028c-0325-4c56-9526-b6398c56b2de.png`
- Implementation screenshots:
  - `/tmp/forge-series-responsive-screenshots/series-final-390x844.png`
  - `/tmp/forge-series-responsive-screenshots/series-final-320x700.png`
  - `/tmp/forge-series-responsive-screenshots/series-final-1920x1080.png`
- Viewports: 390 × 844 CSS px, 320 × 700 CSS px, and 1920 × 1080 CSS px
- Source pixels: 792 × 542; the supplied image is a cropped, approximately 2× phone capture (about 396 × 271 CSS px)
- Implementation pixels: equal to each CSS viewport at device scale factor 1
- State: static series poster hero with collection download and share actions visible

## Full-view comparison evidence

The supplied capture and the final 390px Chromium capture were opened together.
The source shows the action group consuming the horizontal title row, forcing
the heading into a one-word column and clipping the share control. The final
capture gives the title the full content width, keeps both actions within the
viewport, and preserves the poster-cover treatment. The final desktop capture
retains the established side-by-side title/action composition.

## Focused-region comparison evidence

The hero overlay was checked at 390px and at the narrower 320px stress case.
At 390px, both labeled pills fit on one line. Below 360px, the share control
keeps its icon and accessible name while visually hiding only the redundant
text label, preventing the action row from wrapping and obscuring the label or
title. No additional focused crop was needed because the complete hero region
is legible at native pixel size in both captures.

## Required fidelity surfaces

- Fonts and typography: existing Montserrat family, weights, sizes, tracking,
  and hierarchy are preserved; the title now wraps naturally across the full
  mobile width instead of being squeezed by fixed-width controls.
- Spacing and layout rhythm: mobile inset is aligned to the page's 20px content
  gutter; title and actions stack as regions while the actions remain a single
  contained row. Desktop spacing is unchanged at its breakpoint.
- Colors and visual tokens: existing stone, white, amber, dark overlay, and pill
  tokens are unchanged.
- Image quality and asset fidelity: the original series artwork and `cover`
  crop are unchanged; no assets were replaced or synthesized.
- Copy and content: title, episode label, and action names are unchanged. Only
  the visible Share text is suppressed below 360px; its accessible name remains
  `Share`.

## Comparison history

1. P1 — The desktop flex row squeezed the mobile heading and pushed actions
   beyond the viewport. Fixed by stacking title and action regions on mobile,
   using the full content width, and restoring the desktop row at `md`.
2. P2 — At 320px, two wrapped pill rows made the overlay too tall and collided
   with header chrome. Fixed with compact mobile pill spacing and an icon-only,
   accessible Share control below 360px. The final 320px capture shows the
   episode label, complete two-line title, and both actions without collision.

## Interaction and runtime checks

- The local route rendered in Chromium at all three target viewports.
- Download and Share controls remain native buttons with unchanged handlers;
  their presence and click state transitions pass the component suite.
- Chromium emitted no page console error during capture. A browser-service GCM
  registration warning appeared on one desktop capture and is unrelated to the
  page.
- Geometry checks at 320, 359, 360, 390, 767, 768, 1024, and 1920px found no
  document-level horizontal overflow and kept both actions inside the viewport.
  The action-row bottom inset measured 8px below 360px, 20px from 360px through
  767px, and 40px from the `md` breakpoint onward.
- Load-window checks reported zero layout-shift score and no page console errors
  at every measured viewport. The diff adds no request-producing code; the
  existing poster remained the only hero image and retained `object-fit: cover`.

## Findings

No actionable P0, P1, or P2 findings remain. No P3 follow-up is required for
the requested mobile repair.

The final spacing refinement increases the standard mobile action-row bottom
inset from 8px to 20px. The 8px inset remains below 360px, where the compact
layout is required to keep the complete overlay clear of the header.

Long localized download labels are constrained to the available pill width and
truncate visually when necessary; the button's full translated accessible name
remains unchanged.

final result: passed
