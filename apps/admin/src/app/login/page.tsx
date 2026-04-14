// Functional placeholder — replaced in Unit 12 with Stitch-designed UI.
// This exists so Phase 1 end-to-end wiring (auth routes, BA sign-in) can be
// validated without blocking on design.
//
// The form wires to Better Auth's email/password endpoint in Unit 5. SSO
// buttons kick off BA's native OAuth flow for Google/Apple/Okta.
//
// No Firebase SDK is loaded client-side. Firebase users migrate transparently
// via the server-side fallback in Unit 5.

import { env } from "@/config/env"

export default function LoginPage() {
  const hasGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  const hasApple = Boolean(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET)
  const hasOkta = Boolean(
    env.OKTA_CLIENT_ID && env.OKTA_CLIENT_SECRET && env.OKTA_ISSUER,
  )

  return (
    <main>
      <h1>Sign in</h1>
      <form method="post" action="/api/auth/sign-in/email">
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit">Sign in</button>
      </form>
      {(hasGoogle || hasApple || hasOkta) && (
        <>
          <hr />
          <h2>Or sign in with</h2>
          <ul>
            {hasGoogle && (
              <li>
                <form method="post" action="/api/auth/sign-in/social">
                  <input type="hidden" name="provider" value="google" />
                  <button type="submit">Google</button>
                </form>
              </li>
            )}
            {hasApple && (
              <li>
                <form method="post" action="/api/auth/sign-in/social">
                  <input type="hidden" name="provider" value="apple" />
                  <button type="submit">Apple</button>
                </form>
              </li>
            )}
            {hasOkta && (
              <li>
                <form method="post" action="/api/auth/sign-in/oauth2">
                  <input type="hidden" name="providerId" value="okta" />
                  <button type="submit">Okta</button>
                </form>
              </li>
            )}
          </ul>
        </>
      )}
      <p>
        <small>
          Placeholder UI. Design work tracked separately via Stitch; replaced in
          Unit 12 of the admin-app plan.
        </small>
      </p>
    </main>
  )
}
