---
name: Crimson Gallery (Forge TV)
colors:
  surface: "#161311"
  surface-dim: "#161311"
  surface-bright: "#383432"
  surface-container-lowest: "#161311"
  surface-container-low: "#1C1917"
  surface-container: "#221F1D"
  surface-container-high: "#2D2927"
  surface-container-highest: "#383432"
  on-surface: "#F5F5F4"
  on-surface-variant: "#A8A29E"
  inverse-surface: "#F5F5F4"
  inverse-on-surface: "#161311"
  outline: "#4A4543"
  outline-variant: "#2D2927"
  surface-tint: "#CB333B"
  primary: "#CB333B"
  on-primary: "#F5F5F4"
  primary-container: "#3A1416"
  on-primary-container: "#F5C9CB"
  inverse-primary: "#CB333B"
  secondary: "#A8A29E"
  on-secondary: "#161311"
  secondary-container: "#2D2927"
  on-secondary-container: "#F5F5F4"
  tertiary: "#A8A29E"
  on-tertiary: "#161311"
  tertiary-container: "#221F1D"
  on-tertiary-container: "#F5F5F4"
  error: "#CB333B"
  on-error: "#F5F5F4"
  error-container: "#3A1416"
  on-error-container: "#F5C9CB"
  background: "#161311"
  on-background: "#F5F5F4"
  surface-variant: "#2D2927"
typography:
  display-hero:
    fontFamily: Inter
    fontSize: 44px
    fontWeight: "700"
    lineHeight: 52px
    letterSpacing: -0.5px
  title-page:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: "700"
    lineHeight: 48px
    letterSpacing: -0.5px
  heading-section:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: "700"
    lineHeight: 36px
    letterSpacing: "0"
  title-card:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: "600"
    lineHeight: 30px
    letterSpacing: "0"
  label-rail:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 26px
    letterSpacing: 0.5px
  body-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: "400"
    lineHeight: 33px
    letterSpacing: "0"
  body-base:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: "400"
    lineHeight: 30px
    letterSpacing: "0"
  caption:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 22px
    letterSpacing: "0"
  meta-time:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "500"
    lineHeight: 18px
    letterSpacing: "0"
rounded:
  chip: 8px
  pill: 12px
  card: 16px
  panel: 24px
  full: 9999px
spacing:
  unit: 8px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  focus-room: 40px
  player-edge: 48px
  safe-gutter: 80px
---

# Design System: Crimson Gallery (Forge TV)

**Platform:** React Native (react-native-tvos), Apple TV + Android TV. Reference canvas **1920×1080** (landscape). A **10-foot UI**: no pointer, no touch, no hover. Every interaction is **D-pad focus + Select**.

## 1. Theme & Atmosphere

A **warm, cinematic, theatre-dark** interface for ministry video viewing in the living room. The canvas is **warm stone (#161311)** — a near-black with faint earthen warmth, never pure black — so large dark expanses feel intentional and gallery-like. Cinematic video stills and clips are the heroes; chrome recedes. Elevation comes from a tight ladder of warm-charcoal tints (#221F1D → #2D2927 → #383432), **never borders** (standing rule: no 1px borders — lift with background color). The single accent, **Crimson Red (#CB333B)**, is used with discipline (play button, focus glow, progress) so it always reads as "you are here / this is the action." Mood: reverent, premium, unhurried — generous negative space, an 80px side safe-gutter, large couch-readable type, soft motion (250ms crossfades, spring-scaled focus). Nothing flashes; the eye is guided.

## 2. Color Roles

- **Warm Stone `#161311`** — root background, full-screen player backdrop (never #000).
- **Stone Containers `#221F1D` / `#2D2927` / `#383432`** — grouped panels / cards & bars / top-of-stack. Elevation by tint.
- **Gallery White `#F5F5F4`** — primary text and button labels (never #FFF).
- **Warm Mute `#A8A29E`** — secondary text, metadata, section labels, timestamps, chevrons.
- **Crimson `#CB333B`** — primary CTA fill (Play), progress fill, active indicators. The only chromatic color; used sparingly.
- **Crimson Glow** — the universal "focused" signal: a crimson **shadow** (radius 16–30, opacity 0.6–1.0, no offset), not a hard ring. Paired with a 1.05–1.1× spring scale.
- **Hairline `rgba(255,255,255,0.10)`** — the only sanctioned line: thin row dividers inside stacked lists. **Scrim** `rgba(0,0,0,0.5)` behind play badges; `rgba(0,0,0,0.9)` for modal overlays.

## 3. Typography

App ships the **platform system font** (SF Pro / Roboto); render Stitch mockups in **Inter** to match the clean look. Scale (1920px ref): Display Hero 44/Bold (−0.5), Page/Video Title 40/Bold (−0.5), Section Heading 28/Bold, Card & Player Title 24/Semibold, Rail Label 20/Semibold (+0.5, muted), Body 22/Regular (lh 33, muted), Body-sm 20/Regular (lh 30), Caption 16, Meta/Time 14 (tabular-nums). Display/titles use **negative tracking** for confidence; small labels use **positive tracking** + muted color to read as quiet metadata. Titles tight; body relaxed (1.5 lh). Titles clamp 2 lines, questions 3.

## 4. Components

- **Play (primary)**: solid crimson circle, 64px, white ▶. Resting crimson shadow; on focus glow intensifies + springs to 1.1×. The visual anchor of any play surface.
- **Secondary circular (skip ±10s)**: 52px, transparent at rest; crimson-wash fill + 1.1× on focus.
- **Pill / chip (Back, Search, actions)**: rounded-12 pill, translucent stone fill; focus → solid `surface-container-high` + crimson glow + 1.05×. Hugs content.
- **Card (video)**: 16px radius, `surface-container-high`, no border, 16:9 cover image with a bottom-up gradient; 24/600 white title bottom-left (2-line clamp); circular black-50% play badge centered. Focus = 1.05× spring + crimson glow halo. Reserve ~40px focus-room so the halo never clips neighbors.
- **Hero band**: full-bleed, **55% of screen height**. Muted looping autoplay video (cover) when a stream exists, else cinematic still, else solid `surface-container`. A gradient fade (transparent → warm stone, 0.4→1.0) melts media into the page; title+subtitle overlay bottom-left, 48px from bottom, 80px sides. Usually non-interactive; when selectable, stay visually static and rely on the focused control below.
- **Rail**: muted 20/600 label (+0.5) at 80px inset, then a horizontal list of cards (24px gaps) inside a focus guide that traps/auto-focuses D-pad within the row.
- **Top nav**: a horizontally **centered** pill cluster (Netflix pattern) over an opaque stone bar; can pin as a sticky header.
- **Player chrome**: full-screen `surface` overlay; auto-hiding controls (3s). Bottom **glass** bar (frosted translucent stone, radius 16, pad 32×24): title (24/600) + subtitle (16 muted), centered skip / crimson-play / skip row (32px gaps), then a **6px progress track** (rgba track + crimson fill) with start/end times (14 muted, tabular-nums). Back pill top-left; D-pad travels down from Back to Play. Error state: controls ghost to 0.3 opacity + unfocusable, layout never collapses.
- **Modal / overlay (10-foot)**: no bottom sheets. Full-screen overlay on `rgba(0,0,0,0.9)`, circular × close top-right (56px, white-15%). External handoff = **QR card** (tvOS) or in-app WebView (Android TV): centered `surface-container-high` card, radius 24, pad 48, 32/700 heading, muted URL. A **language/subtitle picker** uses the same vocabulary: a focused-list overlay or right-docked panel of focusable rows over the dimmed page — checkmark on the active row, crimson glow on focus — never a touch-style sheet.

## 5. Layout

Single-column vertical scroll on a fixed 1920×1080 reference (Android TV scales proportionally, never re-flows). Content respects an **80px horizontal safe-gutter** (overscan + breathing room); player chrome uses a tighter 48px edge. Vertical rhythm in multiples of 8: sections ~32px apart, headings 12–16px above content, card gaps 24px. Whitespace is **generous and dark** — large stone margins frame content like a gallery wall, not emptiness; never crowd the edges or add borders to fill space. Hero/page titles sit bottom-left over media; section content left-aligns at the gutter; top nav and player controls center.

## 6. Focus, Motion & Accessibility (TV-native)

**Every interactive element is D-pad focusable** with a visible crimson glow + spring scale — focus state is non-negotiable; the user must always see where they are. Motion is soft and purposeful (250ms crossfades, spring tension 150 / friction 10). Honor **reduce-motion** (snap instead of fade) and **screen-reader** state (disable auto-hide). Minimum control target ≈52px; spatial layouts engineered so D-pad travel between regions (Back→Play, rail→rail) is predictable.

## 7. Notes for Stitch Generation

Frame every screen as a **TV / 10-foot UI, landscape 16:9, 1920×1080, D-pad focus**. Language: "warm theatre-dark living-room UI on warm stone (#161311), cinematic and gallery-like; single crimson (#CB333B) accent for the play button, focus glows, and progress; large couch-readable type; generous 80px side safe margins; no borders — elevation via warm-charcoal tints; soft glows and slight enlargement on focus." Show "focused" as a crimson outer glow + slight enlargement, never a hard ring or color inversion. Keep crimson rare — if more than the play button and one focused element glow at once, pull back. Never crowd the 80px safe-gutter.
