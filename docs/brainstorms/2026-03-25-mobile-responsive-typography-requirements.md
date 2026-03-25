---
date: 2026-03-25
topic: mobile-responsive-typography
---

# Consistent Responsive Typography for Mobile App

## Problem Frame

Text sections across the mobile app render at different font sizes depending on which renderer is used (TextRenderer, CardRenderer, CTARenderer, etc.). Each component defines its own hardcoded pixel values independently. This creates visual inconsistency — two content cards in the same carousel can display body text at noticeably different sizes. Font sizes also don't adapt to device screen size.

## Requirements

- R1. All section renderers must use a shared typography scale instead of defining their own font sizes. The scale defines sizes for each semantic role (heading levels, subtitle, body, body-small, caption, button, etc.).
- R2. Font sizes must scale smoothly with screen width using a proportional scale factor, so text renders consistently across all device sizes without breakpoint jumps.
- R3. The same semantic text role (e.g., "body") must render at the same computed size regardless of which renderer is displaying it.

## Success Criteria

- Two content sections viewed side-by-side in a carousel show identical body text size.
- Text is legible on small phones (~320pt wide) and not oversized on large phones/tablets (~430pt+ wide).

## Scope Boundaries

- This covers font sizing only — not font family, weight, or color changes.
- Does not change the color scheme system or section layout.
- Accessibility font scaling (OS-level Dynamic Type / font scale) is out of scope for now but the approach should not conflict with it.

## Key Decisions

- **Smooth scaling over device-class presets**: Proportional scaling avoids breakpoint jumps and is simpler to maintain.
- **Centralized typography scale**: One source of truth for all renderers, rather than per-component font sizes.

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] What base screen width should the scale factor reference (e.g., 375pt for iPhone SE/standard)?
- [Affects R2][Technical] Should min/max caps be applied to prevent extreme sizes on very small or very large screens?
- [Affects R1][Technical] Best approach for the shared scale — a hook (`useTypography`), a utility function, or a theme context?

## Next Steps

→ `/ce:plan` for structured implementation planning
