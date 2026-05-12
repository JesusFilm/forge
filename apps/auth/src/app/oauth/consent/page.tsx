import { AUTH_SCOPES } from "@/domain/scopes"

export default function OAuthConsentPage() {
  return (
    <main>
      <h1>Authorize application</h1>
      <p>
        Jesus Film Auth is preparing the OAuth consent surface. First-party
        applications can be auto-approved by policy, but requested scopes remain
        visible and auditable.
      </p>
      <ul>
        {AUTH_SCOPES.map((scope) => (
          <li key={scope.key}>
            <strong>{scope.label}</strong>: {scope.description}
          </li>
        ))}
      </ul>
    </main>
  )
}
