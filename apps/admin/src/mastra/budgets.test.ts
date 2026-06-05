import { describe, expect, it } from "vitest"

import {
  TOKEN_CAPS,
  STEP_CAPS,
  TIME_BUDGET_MS,
  getTimeBudgetMs,
} from "./budgets"

describe("budgets (U11)", () => {
  describe("TOKEN_CAPS", () => {
    it("has caps for all four agent shapes", () => {
      expect(TOKEN_CAPS.draftExperience).toBeGreaterThan(0)
      expect(TOKEN_CAPS.addSection).toBeGreaterThan(0)
      expect(TOKEN_CAPS.rewriteCopy).toBeGreaterThan(0)
      expect(TOKEN_CAPS.autoEnrich).toBeGreaterThan(0)
    })

    it("scales caps by job size (draft > addSection > rewriteCopy)", () => {
      expect(TOKEN_CAPS.draftExperience).toBeGreaterThan(TOKEN_CAPS.addSection)
      expect(TOKEN_CAPS.addSection).toBeGreaterThan(TOKEN_CAPS.rewriteCopy)
    })

    it("exposes per-step caps for the multi-step draft workflow", () => {
      expect(TOKEN_CAPS.multiStepDraftPlan).toBe(1_500)
      expect(TOKEN_CAPS.multiStepDraftDraft).toBe(4_000)
      expect(TOKEN_CAPS.multiStepDraftCritique).toBe(1_500)
      expect(TOKEN_CAPS.multiStepDraftRevise).toBe(4_000)
    })

    it("keeps the sum of multi-step caps ≤ 12_000 (drift guard)", () => {
      const sum =
        TOKEN_CAPS.multiStepDraftPlan +
        TOKEN_CAPS.multiStepDraftDraft +
        TOKEN_CAPS.multiStepDraftCritique +
        TOKEN_CAPS.multiStepDraftRevise
      expect(sum).toBeLessThanOrEqual(12_000)
    })
  })

  describe("STEP_CAPS", () => {
    it("caps tool-calling recursion at 8", () => {
      expect(STEP_CAPS.toolCallingTurn).toBe(8)
    })

    it("aligns multiStepDraft cap with the workflow's chain length (4)", () => {
      expect(STEP_CAPS.multiStepDraft).toBe(4)
    })
  })

  describe("TIME_BUDGET_MS", () => {
    it("scales time budgets by shape: chatTurn < multiStepWorkflow < backgroundAutoEnrich", () => {
      expect(TIME_BUDGET_MS.chatTurn).toBeLessThan(
        TIME_BUDGET_MS.multiStepWorkflow,
      )
      expect(TIME_BUDGET_MS.multiStepWorkflow).toBeLessThan(
        TIME_BUDGET_MS.backgroundAutoEnrich,
      )
    })

    it("uses sensible defaults (30s chat / 180s workflow / 300s background)", () => {
      expect(TIME_BUDGET_MS.chatTurn).toBe(30_000)
      expect(TIME_BUDGET_MS.multiStepWorkflow).toBe(180_000)
      expect(TIME_BUDGET_MS.backgroundAutoEnrich).toBe(300_000)
    })

    it("pins multiStepWorkflow at 180_000ms (regression guard — sized after live smoke runs)", () => {
      expect(TIME_BUDGET_MS.multiStepWorkflow).toBe(180_000)
    })
  })

  describe("getTimeBudgetMs", () => {
    it("returns the cap for a named shape", () => {
      expect(getTimeBudgetMs("chatTurn")).toBe(30_000)
      expect(getTimeBudgetMs("multiStepWorkflow")).toBe(180_000)
      expect(getTimeBudgetMs("backgroundAutoEnrich")).toBe(300_000)
    })
  })
})
