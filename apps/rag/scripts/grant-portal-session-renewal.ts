import {
  grantPortalSessionRenewal,
  PortalSessionGrantError,
} from "./lib/portal-session-renewal-grant.js"

const sessionUrl = process.env.RAG_PORTAL_DATABASE_URL
if (!sessionUrl) {
  console.log("portal session renewal grant skipped: portal is not configured")
} else {
  const administratorUrl = process.env.DATABASE_URL
  if (!administratorUrl)
    throw new PortalSessionGrantError("administrator_database_url_missing")
  const receipt = await grantPortalSessionRenewal(administratorUrl, sessionUrl)
  console.log(
    JSON.stringify({
      operation: "portal_session_renewal_grant",
      ...receipt,
      tableUpdate: false,
      identityUpdate: false,
      absoluteUpdate: false,
      otherSessionUpdate: false,
      oauthStateUpdate: false,
      consumerSchema: false,
      outsidePortalDataPrivilege: false,
    }),
  )
}
