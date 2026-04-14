// Introspection gate — controlled by GRAPHQL_INTROSPECTION_ENABLED env.
//
// Defaults to disabled. NOT inferred from NODE_ENV because staging/preview
// could run with NODE_ENV=development and silently leak the schema.

import { useDisableIntrospection } from "@envelop/disable-introspection"
import { env } from "@/config/env"

export function getIntrospectionPlugins() {
  if (env.GRAPHQL_INTROSPECTION_ENABLED === "true") return []
  return [useDisableIntrospection()]
}
