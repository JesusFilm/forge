---
name: JesusFilm Forge Mobile
colors:
  background: "#1c1917"
  surface: "#292524"
  surface-black: "#000000"
  on-surface: "#f5f5f4"
  on-surface-variant: "#a8a29e"
  on-surface-body: "#d6d3d1"
  on-overlay: "#ffffff"
  accent: "#CB333B"
  gradient-warm-start: "#E8891C"
  gradient-warm-end: "#CB333B"
  overlay-dark: "rgba(0, 0, 0, 0.5)"
  overlay-light: "rgba(255, 255, 255, 0.2)"
  divider: "rgba(255, 255, 255, 0.1)"
  error: "#ef4444"
  error-detail: "#fbbf24"
  easter-sky: "#5b9bd5"
  easter-gold: "#d4a033"
  easter-crimson: "#c0392b"
typography:
  display:
    fontFamily: System
    fontSize: 56px
    fontWeight: "700"
    lineHeight: 68px
  heading:
    fontFamily: System
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 32px
  title-large:
    fontFamily: System
    fontSize: 22px
    fontWeight: "700"
    lineHeight: 28px
  title-small:
    fontFamily: System
    fontSize: 18px
    fontWeight: "700"
    lineHeight: 24px
  body:
    fontFamily: System
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 24px
  body-small:
    fontFamily: System
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  caption:
    fontFamily: System
    fontSize: 12px
    fontWeight: "700"
    lineHeight: 16px
  heading-h1:
    fontFamily: System
    fontSize: 32px
    fontWeight: "700"
    lineHeight: 40px
  heading-h2:
    fontFamily: System
    fontSize: 28px
    fontWeight: "700"
    lineHeight: 36px
  heading-h3:
    fontFamily: System
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 32px
  heading-h4:
    fontFamily: System
    fontSize: 20px
    fontWeight: "700"
    lineHeight: 28px
  label-uppercase:
    fontFamily: System
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
    letterSpacing: 2px
    textTransform: uppercase
  label-category:
    fontFamily: System
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
    letterSpacing: 1px
    textTransform: uppercase
rounded:
  sm: 6px
  DEFAULT: 8px
  md: 12px
  lg: 16px
  xl: 20px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px
  4xl: 48px
  gutter: 16px
  card-gap: 12px
  section-vertical: 10px
---

# Design System: JesusFilm Forge Mobile

## 1. Visual Theme & Atmosphere

The JesusFilm mobile app is a cinematic, immersive video experience built on a warm dark foundation. The palette is drawn from Tailwind's stone scale -- warm charcoals and creams rather than cold blue-grays -- giving the interface a candlelit, intimate quality that suits devotional content. The base background (`#1c1917`, stone-900) and elevated surface (`#292524`, stone-800) create a subtle depth hierarchy without harsh contrast, letting full-bleed video and photography command visual attention.

The design philosophy is "content theater": generous hero areas (120% of screen width tall), edge-to-edge imagery with gradient scrims for text readability, and minimal chrome. The interface disappears behind the content. Glass-effect header buttons, translucent overlays, and smooth scroll-driven transitions reinforce a premium streaming-app feel. Every interaction surface meets a 48px minimum touch target, and the warm stone neutrals keep the dark theme approachable rather than austere.

## 2. Color Palette & Roles

### Primary Foundation

- **Warm Charcoal** `#1c1917` -- App base background, screen containers, tab bar, navigation headers. The warmest dark tone in the stone scale.
- **Elevated Stone** `#292524` -- Card surfaces, placeholder backgrounds, skeleton loading states. One step lighter for layered depth.
- **True Black** `#000000` -- Video player background, gradient anchors for text overlays on imagery.

### Accent & Interactive

- **JFP Red** `#CB333B` -- Brand accent for CTAs, tab bar active state, navigation back chevrons, share/action icons, link text. The single accent color used consistently across every interactive surface.
- **Warm Orange** `#E8891C` -- Quiz gradient start. Only appears in the quiz button's left-to-right gradient alongside JFP Red.
- **Easter Spectrum** `#5b9bd5` / `#d4a033` / `#c0392b` -- Tri-color diagonal gradient for the seasonal Easter dates card. Context-specific, not used elsewhere.

### Typography & Text Hierarchy

- **Cream White** `#f5f5f4` -- Primary text (headings, card titles, section headers). Stone-100.
- **Warm Stone** `#d6d3d1` -- Body text (paragraphs, answers, snippets). Stone-300.
- **Muted Stone** `#a8a29e` -- Secondary text (subtitles, captions, inactive tab labels, chevrons). Stone-400.
- **Pure White** `#ffffff` -- Text rendered over image/gradient overlays, card titles on dark scrims, badge text, modal UI.

### Functional States

- **Overlay Dark** `rgba(0, 0, 0, 0.5)` -- Play circles, mute buttons, scrim underlays for text-on-image legibility.
- **Overlay Light** `rgba(255, 255, 255, 0.2)` -- Android ripple feedback, ghost CTA buttons on quote cards, inactive pagination dots.
- **Divider** `rgba(255, 255, 255, 0.1)` -- Hairline separator between FAQ question rows.
- **Error Red** `#ef4444` -- Error boundary titles. **Error Detail** `#fbbf24` -- Amber for error message body and stack traces.

## 3. Typography Rules

### Hierarchy & Weights

The app uses the platform system font exclusively (`fontFamily: "System"` -- SF Pro on iOS, Roboto on Android). No custom fonts are loaded. This ensures native rendering quality, zero font-loading latency, and automatic accessibility scaling.

All font sizes are responsive: a `useTypography()` hook scales every token proportionally to screen width relative to a 375px baseline (iPhone SE), clamped between 0.85x and 1.15x. All computed values are `Math.round()`'d to avoid sub-pixel blur on Android.

| Token      | Base Size | Line Height | Weight  | Usage                                                     |
| :--------- | :-------- | :---------- | :------ | :-------------------------------------------------------- |
| display    | 56px      | 68px        | 700     | Video hero headings                                       |
| heading    | 24px      | 32px        | 700     | Section titles, carousel headers                          |
| h1         | 32px      | 40px        | 700     | CMS heading level 1                                       |
| h2         | 28px      | 36px        | 700     | CMS heading level 2                                       |
| h3         | 24px      | 32px        | 700     | CMS heading level 3                                       |
| h4         | 20px      | 28px        | 700     | CMS heading level 4                                       |
| titleLarge | 22px      | 28px        | 700     | Video card titles, Easter date heading                    |
| titleSmall | 18px      | 24px        | 700/800 | Easter secondary dates                                    |
| body       | 16px      | 24px        | 400-600 | Body paragraphs, quiz labels, CTA text                    |
| bodySmall  | 14px      | 20px        | 400-600 | Subtitles, captions, carousel card titles                 |
| caption    | 12px      | 16px        | 600-700 | Category labels, badges, nav card titles, search snippets |

### Spacing Principles

- **Uppercase labels** use generous `letterSpacing: 2` on hero subheadings and category indicators, stepping down to `1-1.5` for badge text and bible references, and `0.5-0.8` for compact nav card categories. Uppercase transforms always pair with letter-spacing to avoid cramped appearance.
- **Line height ratio** is consistently 1.33-1.5x the font size, with the tighter end used for display/heading styles and the more generous end for body text.
- **Weight distribution**: 700 (bold) dominates headings and card titles. 600 (semibold) for interactive text (CTA labels, question text, link text). 400 (regular) for body text and secondary descriptions. 800 (extra-bold) reserved for bible references and date numerals.

## 4. Component Stylings

### Buttons

**Primary CTA** (hero, quote cards): JFP Red (`#CB333B`) fill, 6px border radius, 24px horizontal / 12px vertical padding, 48px minimum height, semibold (600) white text. Press state: opacity 0.85 on iOS, white ripple on Android.

**Icon Buttons**: 44x44px hit area, centered icon. Used for share, chat, and close actions. Accent-colored icons on transparent background. 40x40px glass-effect variants in the header.

**Quiz Gradient Button**: Full-width, 12px border radius, horizontal orange-to-red gradient, row layout with bordered "QUIZ" badge (2px white border, 6px radius), centered label, trailing arrow glyph. 16px internal padding.

**Ghost CTA** (on image overlays): `rgba(255, 255, 255, 0.2)` background, 6px radius, semibold white text. Pressed state brightens to 0.35 opacity.

### Cards & Containers

**Standard Card**: 12px border radius, `overflow: hidden`, `#292524` surface background. Used as the base for video thumbnails, carousel items, and navigation tiles.

**Video Card**: 16:9 aspect ratio, full-bleed thumbnail with black gradient scrim (transparent at 40%, `#000000` at 100%). Text overlay anchored to bottom-left with 16px padding. Centered 56px play circle (semi-transparent black, white play icon).

**Video Carousel Card**: 60% screen width, 9:16 portrait aspect ratio (tall), snap-to-card scrolling with 12px gaps. Centered 48px play circle. Title bar at bottom with 40% black overlay.

**Navigation Tile**: Fixed 110x130px, 12px radius, full-bleed image with black gradient scrim. Category label (uppercase, 0.5 letter-spacing) and title (bold caption) anchored bottom with 8px padding.

**Media Collection Card**: 37% screen width, 3:4 portrait aspect ratio, count badge top-right (6px radius, 60% black), category label + title anchored bottom-left.

**Bible Quote Card**: Square (1:1) aspect ratio, full-screen-width minus gutters, full-bleed background with color-matched gradient from 20%. Attribution (800 weight, 0.8 letter-spacing), reference (800 weight, 1.5 letter-spacing), italic quote body. Pagination dots below: 8px inactive (20% white), 10px active (70% white).

**Search Result Card**: 4:3 aspect ratio, 16px border radius, staggered entrance animation (fade + spring scale from 0.92), 2-column grid with 6px spacing.

### Navigation

**Tab Bar**: Solid `#1c1917` background, no top border. JFP Red active tint, stone-400 inactive tint. Platform-responsive label size (10px iOS, 12px Android). Four tabs: Home (home), Discover (compass), Library (albums-outline), Profile (person).

**Stack Header**: `#1c1917` background, no shadow, centered title (empty string for detail pages), JFP Red back chevron (28px), 12px hit slop.

**Home Header**: Floating, absolute-positioned over hero content (z-index 10). Row of glass-effect circular buttons (40x40, 20px radius) with gradient scrim backdrop. Center pill for scroll-reveal title (40px height, 20px radius, semibold 17px). On Android, glass fallback is semi-transparent surface color.

### Inputs & Forms

**Search**: Discover tab with dedicated search screen. Search results presented in a 2-column grid with animated card entrances. Skeleton loading state uses 6 shimmer cards (4:3 aspect, 16px radius, pulsing 0.3-0.7 opacity at 800ms).

### Expand/Collapse (FAQ, Easter Dates)

Accordion rows with hairline `rgba(255,255,255,0.1)` bottom borders. Question text in semibold primary color, animated chevron rotates 0-90 degrees over 300ms. Answer text in stone-300 body color. `LayoutAnimation` with 300ms easeInEaseOut drives expand/collapse transitions.

### Modal (Quiz WebView)

Full-screen, 90% black overlay, slide-up animation. Close button: 48px circle, top-right, `rgba(255,255,255,0.15)` background, safe-area-aware positioning. Loading spinner centered behind transparent WebView.

## 5. Layout Principles

### Grid & Structure

**Full-screen dark canvas**: Every screen fills the viewport with `#1c1917` background. No visible page margins or outer frames.

**Hero area**: Width = 100%, height = screenWidth \* 1.2 (portrait-biased, roughly 450px on iPhone SE, 520px on iPhone 15 Pro). Three-layer z-index architecture: video/image at z0, gradient + text at z1, interactive touch targets at z2 with `pointerEvents="box-none"` pass-through.

**Container grid**: 12-column responsive grid with breakpoints at xs(<640), sm(<768), md(<1024), lg(<1280), xl(1280+). Mobile collapses all spans to 12. Used for CMS-driven flexible layouts.

**Feed**: FlashList virtualized vertical scroll, full-width items. Content begins at heroHeight offset and scrolls over the hero with a 48px gradient feather at the transition.

### Whitespace Strategy

The spacing system follows a 4px base unit: 4, 8, 12, 16, 20, 24, 32, 48.

- **Horizontal page gutters**: 16px consistently (`HORIZONTAL_PADDING`).
- **Section vertical spacing**: 10px between sections (`sectionOuter`). Tight to keep the feed dense and scrollable.
- **Card gaps**: 12px in all horizontal carousels.
- **Internal card padding**: 12-20px depending on content density. Quote cards use 20px for breathing room; carousel title overlays use 12px for compactness.
- **Section headings**: 12px bottom margin before content. Subtitles sit above headings with 2-4px gap.

### Alignment & Visual Balance

- **Bottom-anchored text**: All image-overlay text (video cards, nav tiles, media collection) anchors to the bottom of the card with gradient scrims above. This creates a consistent "title rises from darkness" motif.
- **Centered play indicators**: Play circles are always dead-center in the card via `absoluteFill` + centered flex.
- **Left-aligned body content**: Paragraphs, headings, and section titles are left-aligned. Only the header title pill is center-aligned.
- **Header row pattern**: Section heading (flex: 1) with optional trailing icon button (share, chat). Heading fills available space; action icon hugs the right edge.

### Responsive Behavior & Touch

- **Typography scales** 0.85x-1.15x with screen width, anchored to 375px.
- **Carousel card widths** are screen-width-proportional: 60% for video carousels, 37% for media collections, full-width-minus-gutters for bible quotes.
- **48px minimum touch targets** enforced on all interactive elements: buttons, question rows, toggle areas, icon buttons, close buttons. Achieved via `minHeight: 48` or explicit 44-48px dimensions.
- **Platform-adaptive feedback**: iOS uses opacity dimming (0.85) on press. Android uses `android_ripple` with `rgba(255,255,255,0.2)` and `foreground: true`.
- **Safe area awareness**: Header respects `useSafeAreaInsets()` for notch/dynamic island. Tab bar uses system safe area. Modal close button offsets from safe area top.

## 6. Design System Notes for Stitch Generation

### Language to Use

When generating screens for this app, describe the atmosphere as: "dark cinematic streaming interface with warm stone tones, full-bleed imagery, gradient text scrims, and a single red accent." Avoid: "minimalist," "clean white," "material design." The feel is closer to Netflix or Apple TV+ than a utility app.

### Color References

| Name           | Hex     | Role                           |
| :------------- | :------ | :----------------------------- |
| Warm Charcoal  | #1c1917 | Background                     |
| Elevated Stone | #292524 | Card surfaces                  |
| True Black     | #000000 | Video player, gradient anchors |
| Cream White    | #f5f5f4 | Primary text                   |
| Warm Stone     | #d6d3d1 | Body text                      |
| Muted Stone    | #a8a29e | Secondary text                 |
| JFP Red        | #CB333B | Accent, CTAs, active tabs      |
| Warm Orange    | #E8891C | Quiz gradient start            |
| Pure White     | #ffffff | Text on overlays               |

### Component Prompts

- "A tall hero card filling the screen with a muted background video, a bottom gradient fading from transparent to warm charcoal, a large bold display heading in cream white, an uppercase muted stone subtitle with wide letter-spacing, and a JFP Red CTA button with rounded corners."
- "A horizontal carousel of tall portrait video cards (9:16) with thumbnail images, dark gradient overlays, centered semi-transparent play circles, and a bold title bar at the bottom of each card. Section heading in cream white above."
- "An expandable FAQ section on a dark background with cream white question text, muted stone chevrons that rotate on tap, and warm stone answer text. Hairline white-10% dividers between items."

### Incremental Iteration

- Start with the color palette and typography -- they carry 80% of the visual identity.
- Add gradient scrims (`transparent-to-charcoal` and `transparent-to-black`) before placing text on any image surface.
- Use 12px border radius for cards universally. Only buttons vary (6-8px for CTAs, 20px for pill shapes).
- Keep section spacing tight (10px vertical) to maintain the dense feed scroll feel.
- Press states: 0.85 opacity on iOS, never scale transforms or color shifts.
