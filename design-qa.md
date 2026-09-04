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

# Design QA: Watch home beveled video controls

## Source and implementation

- Source visual truth: `/home/lado/.t3/userdata/attachments/a323a038-dd9d-43b6-a5cd-5205a449d5c4-7d74161c-4882-4c3f-b1f2-6bdd8dafbac9.png` (378 × 176 px), used as a focused style reference for borderless translucent circular controls.
- Browser-rendered implementation: `/tmp/watch-home-final-bevel-hover.png` (2521 × 1240 px capture) from `http://localhost:3000/watch`.
- Mobile current-and-next evidence: `/tmp/forge-mobile-circle-qa/watch-375x667-current-next-inline.png` (375 × 667 px capture) from the same local Watch page.
- Focused normalized comparison: `/tmp/watch-home-final-bevel-comparison.png` (760 × 176 px). The implementation crop was normalized to 378 × 176 px beside the source without changing its circle aspect ratio.
- Browser viewport: 2536 × 1247 CSS px at DPR 2. The capture API emitted a 2521 × 1240 px JPEG payload.
- State: muted Watch-home hero after a real mute-button click, with the pointer still hovering the control; the current timeline circle retained its playback-progress ring.

## Full-view comparison evidence

- The action row remains directly below the hero title, with the single mute control immediately beside Watch Now at the same 52 px height.
- One previous, the current, and three future circular thumbnails remain right-aligned without colliding with the copy at the checked desktop viewport.
- At mobile widths, the timeline deliberately reduces to the current and next circular thumbnails and keeps them on the same horizontal row as Watch Now and mute.
- The non-current circles no longer have the thin border. Their semi-transparent imagery is shaped by a light inset top edge and darker inset bottom edge; the current circle keeps the separate white playback-progress ring required by the feature.

## Focused comparison evidence

- The side-by-side focused comparison shows the source's translucent, dimensional circle treatment and the implementation's corresponding borderless inset highlight/shadow treatment.
- Final polish keeps `border-width: 0px` and uses one uniform, crisp 1px semi-transparent light ring inset inside both the timeline circles and mute control.
- The ring uses `mix-blend-mode: overlay` with a 28% white base and 48% white hover shadow, allowing the image underneath to shape its contrast without increasing its width or introducing blur. The mute control retains its 70% black translucent hover fill and white icon color.

## Required fidelity surfaces

- Typography: unchanged existing Watch typography, weights, wrapping, and hierarchy.
- Spacing and layout rhythm: Watch Now, mute, and the compact current/next timeline share one mobile action row; desktop retains its existing 48 px timeline geometry and spacing.
- Colors and visual tokens: existing black/white/brand-red tokens remain; bevel depth comes from semi-transparent inset light and shadow rather than a new solid outline.
- Image quality and assets: real video thumbnails remain lazy-loaded and circularly cropped; Lucide supplies the mute icon. No placeholder or fabricated image asset was introduced.
- Copy and content: no visible copy changed.

## Interaction and runtime verification

- Browser interaction toggled mute/unmute successfully and verified the live hover state through computed styles.
- Focused tests verify one mute control beside Watch Now, borderless bevel layers, the two-circle mobile window, three-future desktop queue prefetch, direct timeline selection, and focus preservation across automatic slide replacement.
- Console diagnostics were checked in the collaborative preview before it disconnected during hot reload. Existing duplicate-key, recommendation 503/429, and Next Image positioning warnings remain unrelated; no new control error was introduced.

### Final responsive and loading pass

- Fresh portrait captures at `/tmp/forge-watch-circle-lfg/watch-mobile-320x700.png`, `/tmp/forge-watch-circle-lfg/watch-mobile-375x667.png`, and `/tmp/forge-watch-circle-lfg/watch-mobile-430x800.png` each show exactly the current and next circles. Browser geometry reported zero horizontal overflow and a `0px` center-line delta between Watch Now, mute, current, and next.
- `/tmp/forge-watch-circle-lfg/watch-mobile-landscape-long-label-568x320.png` uses a deliberately longer `Watch This Video Now` label. It remained on the same row with the mute and two timeline circles, with zero overflow and no clipped control content.
- Desktop interaction at `1280 x 800` verified direct selection and the steady-state order of one past, current, and three future circles. Two consecutive focus-recovery cycles moved focus from the disappearing past circle to the new current circle.
- Scoped axe verification reported zero violations for the Watch Home carousel. Its two incomplete checks are indeterminate contrast over video and the pre-existing preview-caption check.
- A cold development load recorded FCP at `464ms`, LCP at `1172ms`, CLS at `0.04`, and TTFB at `196.4ms`. The LCP element remained the active hero poster, not a timeline thumbnail. Timeline images retained `loading="lazy"` and `fetchPriority="auto"` at `48px`; the hidden responsive copy reused the same URLs rather than introducing an eager preload.
- The fresh console pass contained only the existing unrelated media-collection duplicate-key error and Next Image sticky-parent warning; no timeline-control error was emitted.

## Comparison history

- Initial state: the mute hover inherited a dark foreground over a dark translucent surface, and timeline circles used thin white borders.
- First correction: strengthened hover contrast and added an inset treatment.
- Final correction: removed visible circle outlines, applied sharp semi-transparent inset bevels to both timeline and mute controls, and kept the current playback ring distinct.
- Final comparison found no remaining actionable P0, P1, or P2 mismatch for the requested control treatment. Circle size differences from the cropped source are intentional because the source is a style reference, while the established responsive control geometry remains unchanged.

## Result

final result: passed
