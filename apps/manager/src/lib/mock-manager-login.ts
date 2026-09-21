import { DEFAULT_MOCK_MANAGER_CREDENTIALS } from "@/cms/mock-seed"
import { env } from "@/config/env"
import type { ManagerSessionPrincipal } from "@/lib/manager-session-cookie"

export const LOCAL_MOCK_MANAGER_SESSION: ManagerSessionPrincipal = {
  id: "mock-manager-1",
  subject: "mock-manager-1",
  email: DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
  name: "Mock Manager",
  managerRole: "OPERATOR",
  scopes: ["manager:access"],
  reviewerLanguageGrants: [],
}

export const LOCAL_MOCK_REVIEWER_SESSION: ManagerSessionPrincipal = {
  id: "mock-reviewer-1",
  subject: "mock-reviewer-1",
  email: "reviewer@forge.test",
  name: "Mock Spanish Reviewer",
  managerRole: "REVIEWER",
  scopes: ["manager:access"],
  reviewerLanguageGrants: [
    {
      id: "mock-grant-es",
      languageId: "mock-language-es",
      languageSlug: "spanish-latin-america",
      languageBcp47: "es-419",
      permittedRubricDimensions: [
        "MEANING_ACCURACY",
        "NATURALNESS",
        "TIMING_READABILITY",
      ],
      specialistCapabilities: { scripture: false, theology: false },
    },
  ],
}

export function isLocalMockManagerLoginEnabled() {
  const managerMode = env.MANAGER_BACKEND_MODE ?? env.MANAGER_DATA_MODE
  return managerMode === "mock" && env.NODE_ENV !== "production"
}
