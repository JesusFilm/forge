/**
 * Gateway sync API routes.
 *
 * Auth note: these routes use `admin::isAuthenticatedAdmin` under the content-API scope.
 * Use a full-access API token (not an admin JWT) — admin JWTs return 401 here.
 *
 * @see docs/solutions/cms/gateway-sync-local-testing.md — local testing runbook
 */
export default {
  routes: [
    {
      method: "POST",
      path: "/gateway-sync/trigger",
      handler: "gateway-sync.trigger",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/gateway-sync/status",
      handler: "gateway-sync.status",
      config: {
        policies: ["admin::isAuthenticatedAdmin"],
        middlewares: [],
      },
    },
  ],
}
