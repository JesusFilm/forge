import { inspect } from "node:util"
import { createLogger } from "graphql-yoga"
import { env } from "@/config/env"

export function createGraphqlLogger() {
  const logger = createLogger()
  if (env.NODE_ENV !== "production") return logger

  return {
    ...logger,
    error: (...args: unknown[]) => {
      // Next's custom Error inspector reparses server source maps for every
      // failed field. Retain native error details without blocking other
      // requests on repeated source-map inspection after a batched failure.
      logger.error(
        ...args.map((value) =>
          value instanceof Error
            ? inspect(value, { customInspect: false })
            : value,
        ),
      )
    },
  }
}
