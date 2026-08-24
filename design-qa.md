# Design QA: Watch sharing jobs-to-be-done flow

## Source and implementation

- Source visual truth: `/home/lado/.codex/generated_images/01a0270e-32fb-71d1-8c8b-7c2f2e552b25/exec-967687c0-c939-47d5-a897-2b16498d4a14.png`
- Final desktop chooser: `/tmp/fge64-share-flow-final/desktop-01-choose.png`
- Final mobile chooser: `/tmp/fge64-share-flow-final/mobile-01-choose.png`
- All desktop steps: `/tmp/fge64-share-flow-final/desktop-all-steps.png`
- All mobile steps: `/tmp/fge64-share-flow-final/mobile-all-steps.png`
- Mobile scroll completions: `/tmp/fge64-share-flow-final/mobile-scroll-completions.png`
- Normalized source/implementation comparison: `/tmp/fge64-share-flow-final/comparison-reference-desktop.png`
- Source pixels and CSS target: 1668 by 943 at device pixel ratio 1.
- Desktop implementation pixels and CSS viewport: 1668 by 943 at device pixel ratio 1. The modal measures 1400 by 851 pixels.
- Mobile implementation pixels and CSS viewport: 390 by 844 at device pixel ratio 1. The modal measures 366 pixels wide and at most 778 pixels tall.
- State: dark Watch share modal, open on the initial intent chooser. Additional captures cover every reachable result state.

## Full-view comparison evidence

- The normalized side-by-side comparison uses equal 1668 by 943 images without scaling. It shows the same large centered dark frame, 465-pixel media rail, inset divider, right-side task chooser, four bordered rows, close action, and full-width help footer. The close action uses Watch's shared safe-area-aware viewport corner instead of the mock's in-frame offset, preserving the repository's modal accessibility contract.
- The implementation preserves the selected design's hierarchy while using the production Watch typography, brand-red token, shared dialog primitives, Lucide icon library, and dynamic video metadata.
- The poster subject differs because the QA harness uses an existing playable Mux fixture; production receives the current video's real poster, title, and description through the component contract. The poster slot, crop, radius, and density match the target.
- The source's age recommendation is content-specific metadata that is not available to the existing ShareModal contract. It was not fabricated. Its absence does not affect the sharing journey or shift the task controls.

## Required fidelity surfaces

- Fonts and typography: the implementation uses Watch's existing Montserrat family and optical weights. The desktop chooser heading is 36 pixels and stays on one line like the source; mobile reduces it to 24 pixels with intentional wrapping. Titles, descriptions, controls, and helper links retain distinct hierarchy at both breakpoints.
- Spacing and layout rhythm: the desktop modal matches the source's 1400 by approximately 850 frame, 465-pixel left track, 60-pixel poster inset, 52-pixel main inset, 118-pixel chooser rows, 22-pixel radius, and inset footer divider. Mobile compacts the media rail so choices remain above the fold and uses one vertical scroll surface where result content exceeds the viewport.
- Colors and visual tokens: the implementation uses the target's near-black surface, subtle white borders, translucent row/icon surfaces, stone text hierarchy, platform blue for Facebook, and Watch brand red for help/licensing links. Contrast remains clear in the tested states.
- Image quality and asset fidelity: the component uses the real production poster supplied by the Watch page and Next Image's cover treatment. All UI icons come from the repository's Lucide dependency; no placeholder drawing, emoji, custom SVG, or CSS illustration substitutes for a target icon.
- Copy and content: the chooser and every branch use the approved product semantics: Facebook creates a Watch-page link post; YouTube and Instagram receive a shareable Watch link and no embed recommendation; offline use opens the existing download flow; website use provides iframe HTML; native upload, clip reuse, and republication route to existing usage guidance and licensing intake.

## Focused comparison evidence

- `/tmp/fge64-share-flow-final/comparison-reference-desktop.png` keeps the poster/title rail, chooser heading, all four rows, icon treatment, borders, close control, and help footer readable in one comparison input.
- `/tmp/fge64-share-flow-final/desktop-all-steps.png` verifies the repeated media rail and the information hierarchy of all ten task states.
- `/tmp/fge64-share-flow-final/mobile-all-steps.png` verifies compact media context, usable row targets, natural heading wrapping, and no horizontal overflow across all ten states.
- `/tmp/fge64-share-flow-final/mobile-scroll-completions.png` verifies the four longer result states can reach their licensing guidance or final copy action through the modal's single vertical scroll surface.

## Interaction and runtime verification

- Browser automation traversed all ten paths on desktop and mobile: chooser, platform selection, Facebook, YouTube, Instagram, direct link, offline/download, website-or-production choice, embed, and production reuse.
- Desktop and mobile captures reported no horizontal overflow. Desktop result states fit within the fixed 851-pixel modal; mobile overflow is limited to the modal's vertical scroll surface.
- YouTube and Instagram expose one Watch link and no embed code. Facebook exposes the Watch link, Facebook share action, and licensing route. Website embed exposes the iframe snippet and copy action.
- Initial focus moves to the chooser heading rather than displaying an unsolicited close-button focus ring. Each forward step focuses its result heading, Back returns focus to the parent heading, and both responsive scroll surfaces reset to the top. Back, close, chooser rows, platform rows, copy actions, download handoff, and external guidance links remain keyboard-focusable.
- Mobile browser capture reported no console errors. Desktop reported one fixture/resource 404 during repeated QA navigation; the rendered poster and all product interactions remained available, and no application exception or hydration error occurred.

## Comparison history

- First pass findings: P1 desktop composition was compressed relative to the source (405-pixel media rail, 16:9 poster, wrapped chooser heading, and a footer confined to the right column). P1 mobile composition let the full media summary push choices below the fold and allowed the help footer to overlap chooser content. P2 initial focus produced an unwanted ring on the close control.
- Fixes: changed the desktop grid to a 465-pixel rail with asymmetric source-matched poster insets and a 3:2 crop; reduced the chooser's desktop heading to the source scale; moved the footer to a full-grid row; compacted mobile media context and row density; made the grid the single mobile scroll surface; and focused the semantic chooser heading when the dialog opens.
- Post-fix evidence: `/tmp/fge64-share-flow-final/comparison-reference-desktop.png`, `/tmp/fge64-share-flow-final/mobile-01-choose.png`, and `/tmp/fge64-share-flow-final/mobile-scroll-completions.png` show the corrected proportions, unobstructed choices/footer, neutral close action, and reachable content.

## Findings

- No remaining P0, P1, or P2 visual, responsive, accessibility, or interaction findings.

## Follow-up polish

- P3: replace provisional English catalog fallbacks with human-reviewed translations when localization credentials and locale owners are available. The fallback status is tracked explicitly and is not represented as translated copy.

## Result

final result: passed
