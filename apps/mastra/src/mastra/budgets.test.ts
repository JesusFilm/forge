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

    it("exposes the U3 two-phase per-step caps (skeleton + per-node fill)", () => {
      // Skeleton is a tiny structure-only emission; fill is a small
      // per-block cap (one call per fillable node).
      expect(TOKEN_CAPS.multiStepDraftSkeleton).toBe(1_500)
      expect(TOKEN_CAPS.multiStepDraftFill).toBe(1_500)
      // Skeleton is no larger than the (retained-but-unchained) draft cap.
      expect(TOKEN_CAPS.multiStepDraftSkeleton).toBeLessThan(
        TOKEN_CAPS.multiStepDraftDraft,
      )
    })

    it("keeps the non-fill two-phase chain sum at 8_500 (drift guard)", () => {
      // plan + skeleton + critique + revise (the fill step's cost is N ×
      // multiStepDraftFill where N is the skeleton's fillable-node count,
      // accounted separately because it scales with structure).
      const nonFillSum =
        TOKEN_CAPS.multiStepDraftPlan +
        TOKEN_CAPS.multiStepDraftSkeleton +
        TOKEN_CAPS.multiStepDraftCritique +
        TOKEN_CAPS.multiStepDraftRevise
      expect(nonFillSum).toBe(8_500)
    })
  })

  describe("STEP_CAPS", () => {
    it("caps tool-calling recursion at 8", () => {
      expect(STEP_CAPS.toolCallingTurn).toBe(8)
    })

    it("aligns multiStepDraft cap with the workflow's chain length (5 after U3)", () => {
      // plan → skeleton → fill → critique → revise.
      expect(STEP_CAPS.multiStepDraft).toBe(5)
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

    it("uses sensible defaults (90s chat / 180s workflow / 300s background)", () => {
      // chatTurn raised 30s -> 90s: a from-scratch draft on the gateway
      // model runs ~37-45s, past the old 30s ceiling. See the abort guard
      // in experience-ai-chat.service.ts and TIME_BUDGET_MS.chatTurn doc.
      expect(TIME_BUDGET_MS.chatTurn).toBe(90_000)
      expect(TIME_BUDGET_MS.multiStepWorkflow).toBe(180_000)
      expect(TIME_BUDGET_MS.backgroundAutoEnrich).toBe(300_000)
    })

    it("pins multiStepWorkflow at 180_000ms (regression guard — sized after live smoke runs)", () => {
      expect(TIME_BUDGET_MS.multiStepWorkflow).toBe(180_000)
    })

    it("keeps the history read budget strictly below the chat proxy's 10s ceiling (feat-241)", () => {
      // apps/chat's /api/history/* proxies bound their upstream read with
      // min(seekerTimeoutMs(), 10_000) — HISTORY_READ_TIMEOUT_CEILING_MS in
      // apps/chat/src/app/api/history/history-proxy.ts. The route budget must
      // settle FIRST so its clean timeout reason (not the proxy's abort
      // classifier) wins the race. Cross-app literal by necessity: the apps
      // must not import each other, so this pin names the ceiling explicitly.
      expect(TIME_BUDGET_MS.historyRead).toBeLessThan(10_000)
    })
  })

  describe("getTimeBudgetMs", () => {
    it("returns the cap for a named shape", () => {
      expect(getTimeBudgetMs("chatTurn")).toBe(90_000)
      expect(getTimeBudgetMs("multiStepWorkflow")).toBe(180_000)
      expect(getTimeBudgetMs("backgroundAutoEnrich")).toBe(300_000)
    })
  })
})
