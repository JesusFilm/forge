import { z } from "zod"

export const bearerTokenConfigSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
)
