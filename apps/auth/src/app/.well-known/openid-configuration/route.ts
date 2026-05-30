import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"

import { auth } from "@/auth/config"

export const GET = oauthProviderOpenIdConfigMetadata(auth)
