import { AUTH_SCOPES } from "@/domain/scopes"
import { getAuthBaseUrl } from "@/config/env"

// Configuration only: this module must never initialize Auth.
export const ID_TOKEN_SIGNING_ALGORITHM = "EdDSA" as const

export const advertisedMetadata = {
  scopes_supported: AUTH_SCOPES.map((scope) => scope.key),
  claims_supported: [
    "sub",
    "iss",
    "aud",
    "exp",
    "iat",
    "sid",
    "scope",
    "azp",
    "email",
    "email_verified",
    "name",
    "picture",
    "https://jesusfilm.org/claims/actor_type",
    "https://jesusfilm.org/claims/membership_status",
    "https://jesusfilm.org/claims/environment",
    "https://jesusfilm.org/claims/app",
  ],
}

/**
 * Fetch discovery from this container, never the old deployment or CDN.
 * Railway supplies PORT; local Next dev uses 3004. The document still names
 * the public issuer and endpoints, preserving account and token identity.
 */
export function getSelfRpDiscoveryUrl(): string {
  return `http://127.0.0.1:${process.env.PORT ?? "3004"}/.well-known/openid-configuration`
}

/** Configuration-only discovery breaks the self-RP initialization cycle.
 * The cold-start integration test checks exact parity with Better Auth.
 */
export function getOpenIdConfiguration() {
  const issuer = `${getAuthBaseUrl().replace(/\/$/, "")}/api/auth`
  const clientAuthMethods = [
    "client_secret_basic",
    "client_secret_post",
    "private_key_jwt",
  ]
  const clientSigningAlgorithms = [
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "ES512",
    "EdDSA",
  ]
  return {
    ...advertisedMetadata,
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    jwks_uri: `${issuer}/jwks`,
    registration_endpoint: `${issuer}/oauth2/register`,
    introspection_endpoint: `${issuer}/oauth2/introspect`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: [
      "authorization_code",
      "client_credentials",
      "refresh_token",
    ],
    token_endpoint_auth_methods_supported: ["none", ...clientAuthMethods],
    token_endpoint_auth_signing_alg_values_supported: clientSigningAlgorithms,
    introspection_endpoint_auth_methods_supported: clientAuthMethods,
    introspection_endpoint_auth_signing_alg_values_supported:
      clientSigningAlgorithms,
    revocation_endpoint_auth_methods_supported: clientAuthMethods,
    revocation_endpoint_auth_signing_alg_values_supported:
      clientSigningAlgorithms,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    dpop_signing_alg_values_supported: [
      "EdDSA",
      "ES256",
      "ES512",
      "PS256",
      "RS256",
    ],
    backchannel_logout_supported: true,
    backchannel_logout_session_supported: true,
    claims_parameter_supported: true,
    userinfo_endpoint: `${issuer}/oauth2/userinfo`,
    subject_types_supported: ["public"],
    acr_values_supported: ["0"],
    id_token_signing_alg_values_supported: [ID_TOKEN_SIGNING_ALGORITHM],
    end_session_endpoint: `${issuer}/oauth2/end-session`,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
    prompt_values_supported: [
      "login",
      "consent",
      "create",
      "select_account",
      "none",
    ],
  }
}
