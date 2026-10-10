import { describe, expect, it } from "vitest"
import { deriveGenerateButtonState } from "./generate-button-state"

const base = {
  searchPending: false,
  generatePending: false,
  emptyQuery: false,
  successState: false,
} as const

describe("deriveGenerateButtonState", () => {
  describe("row 1 — empty input", () => {
    it("hero: disabled, no spinner, 'Generate', not-allowed", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          emptyQuery: true,
          variant: "hero",
        }),
      ).toEqual({
        disabled: true,
        showSpinner: false,
        label: "Generate",
        cursor: "not-allowed",
      })
    })

    it("in-panel: disabled, no spinner, 'Generate experience with AI', not-allowed", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          emptyQuery: true,
          variant: "in-panel",
        }),
      ).toEqual({
        disabled: true,
        showSpinner: false,
        label: "Generate experience with AI",
        cursor: "not-allowed",
      })
    })

    it("skeleton: disabled, no spinner, 'Generate experience with AI', not-allowed", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          emptyQuery: true,
          variant: "skeleton",
        }),
      ).toEqual({
        disabled: true,
        showSpinner: false,
        label: "Generate experience with AI",
        cursor: "not-allowed",
      })
    })

    it("empty takes precedence over searching + pending + success", () => {
      const state = deriveGenerateButtonState({
        searchPending: true,
        generatePending: true,
        emptyQuery: true,
        successState: true,
        variant: "hero",
      })
      expect(state.label).toBe("Generate")
      expect(state.showSpinner).toBe(false)
      expect(state.cursor).toBe("not-allowed")
    })
  })

  describe("row 2 — searching", () => {
    it("hero: disabled, spinner, 'Loading…', wait", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          searchPending: true,
          variant: "hero",
        }),
      ).toEqual({
        disabled: true,
        showSpinner: true,
        label: "Loading…",
        cursor: "wait",
      })
    })

    it("in-panel: same state + label as hero", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          searchPending: true,
          variant: "in-panel",
        }).label,
      ).toBe("Loading…")
    })

    it("skeleton: same state + label as hero", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          searchPending: true,
          variant: "skeleton",
        }).label,
      ).toBe("Loading…")
    })

    it("searching takes precedence over pending + success", () => {
      const state = deriveGenerateButtonState({
        searchPending: true,
        generatePending: true,
        emptyQuery: false,
        successState: true,
        variant: "hero",
      })
      expect(state.label).toBe("Loading…")
    })
  })

  describe("row 3 — composing", () => {
    it("hero: disabled, spinner, 'Composing…', wait", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          generatePending: true,
          variant: "hero",
        }),
      ).toEqual({
        disabled: true,
        showSpinner: true,
        label: "Composing…",
        cursor: "wait",
      })
    })

    it("in-panel: same state + label as hero", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          generatePending: true,
          variant: "in-panel",
        }).label,
      ).toBe("Composing…")
    })

    it("skeleton: same state + label as hero", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          generatePending: true,
          variant: "skeleton",
        }).label,
      ).toBe("Composing…")
    })
  })

  describe("row 4 — success (in-panel only gets the special label)", () => {
    it("hero: enabled, no spinner, 'Generate' (falls through to idle label)", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          successState: true,
          variant: "hero",
        }),
      ).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Generate",
        cursor: "pointer",
      })
    })

    it("in-panel: enabled, no spinner, 'Try another prompt!'", () => {
      expect(
        deriveGenerateButtonState({
          ...base,
          successState: true,
          variant: "in-panel",
        }),
      ).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Try another prompt!",
        cursor: "pointer",
      })
    })

    it("skeleton: enabled-output, falls through to idle label (success state is unreachable for skeleton in practice, but behavior is defined)", () => {
      // "Try another prompt!" is the in-panel's unique label. Hero and
      // skeleton fall through to the idle label on successState. The
      // skeleton consumer is separately responsible for forcing
      // `disabled={true}` at render time since it has no onClick handler.
      expect(
        deriveGenerateButtonState({
          ...base,
          successState: true,
          variant: "skeleton",
        }),
      ).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Generate experience with AI",
        cursor: "pointer",
      })
    })
  })

  describe("row 5 — idle", () => {
    it("hero: enabled, no spinner, 'Generate', pointer", () => {
      expect(deriveGenerateButtonState({ ...base, variant: "hero" })).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Generate",
        cursor: "pointer",
      })
    })

    it("in-panel: enabled, no spinner, 'Generate experience with AI', pointer", () => {
      expect(
        deriveGenerateButtonState({ ...base, variant: "in-panel" }),
      ).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Generate experience with AI",
        cursor: "pointer",
      })
    })

    it("skeleton: enabled-output, same label as in-panel (consumer forces disabled)", () => {
      expect(
        deriveGenerateButtonState({ ...base, variant: "skeleton" }),
      ).toEqual({
        disabled: false,
        showSpinner: false,
        label: "Generate experience with AI",
        cursor: "pointer",
      })
    })
  })
})
