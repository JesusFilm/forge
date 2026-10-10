// Canonical button state for every visible "Generate" button on the
// /demo-search page: the hero shortcut (above Suspense), the in-panel
// button (inside AiExperienceGeneratorDemo), and the Suspense skeleton's
// static button. All three render from this pure function so they cannot
// drift out of sync.
//
// The precedence table (first matching row wins) is the authoritative
// source — see docs/plans/2026-04-22-001-refactor-demo-search-canonical-ux-plan.md.

export type GenerateButtonVariant = "hero" | "in-panel" | "skeleton"

export type GenerateButtonCursor = "pointer" | "wait" | "not-allowed"

export type GenerateButtonState = {
  disabled: boolean
  showSpinner: boolean
  label: string
  cursor: GenerateButtonCursor
}

type DeriveInput = {
  searchPending: boolean
  generatePending: boolean
  emptyQuery: boolean
  successState?: boolean
  variant: GenerateButtonVariant
}

const IDLE_LABEL_HERO = "Generate"
const IDLE_LABEL_PANEL = "Generate experience with AI"

function idleLabel(variant: GenerateButtonVariant): string {
  return variant === "hero" ? IDLE_LABEL_HERO : IDLE_LABEL_PANEL
}

export function deriveGenerateButtonState(
  input: DeriveInput,
): GenerateButtonState {
  const { searchPending, generatePending, emptyQuery, successState, variant } =
    input

  if (emptyQuery) {
    return {
      disabled: true,
      showSpinner: false,
      label: idleLabel(variant),
      cursor: "not-allowed",
    }
  }

  if (searchPending) {
    return {
      disabled: true,
      showSpinner: true,
      label: "Loading…",
      cursor: "wait",
    }
  }

  if (generatePending) {
    return {
      disabled: true,
      showSpinner: true,
      label: "Composing…",
      cursor: "wait",
    }
  }

  if (successState && variant === "in-panel") {
    return {
      disabled: false,
      showSpinner: false,
      label: "Try another prompt!",
      cursor: "pointer",
    }
  }

  return {
    disabled: false,
    showSpinner: false,
    label: idleLabel(variant),
    cursor: "pointer",
  }
}
