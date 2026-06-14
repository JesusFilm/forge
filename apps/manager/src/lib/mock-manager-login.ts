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
}

export function isLocalMockManagerLoginEnabled() {
  const managerMode = env.MANAGER_BACKEND_MODE ?? env.MANAGER_DATA_MODE
  return managerMode === "mock" && env.NODE_ENV !== "production"
}
