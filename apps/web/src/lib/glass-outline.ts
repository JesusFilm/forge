// Faint white edge applied to glass / transparent-blurred surfaces (search
// field, future overlay chips, etc.) so the surface reads as bounded against
// bright backgrounds without competing with content.
export const GLASS_OUTLINE_CLASS = "outline-1 outline-white/15"

// Inset-shadow variant of GLASS_OUTLINE_CLASS for surfaces that sit inside
// an `overflow-hidden` ancestor (e.g. the SiblingCarousel viewport) where a
// CSS outline would be clipped at the container's edges. Same 1px / 15%
// white target as the outline form.
export const GLASS_OUTLINE_INSET_CLASS =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
