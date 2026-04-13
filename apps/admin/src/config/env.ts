import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// Unit 1 scaffolding ships a minimal env. Each later unit appends the
// vars it owns here and in runtimeEnv. Never read process.env directly.
export const env = createEnv({
  server: {
    // Placeholder — replaced with real server-side vars starting in Unit 2.
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("forge-admin"),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
})
