// Functional placeholder — replaced in Unit 12 with Stitch-designed UI.
// This exists so Phase 1 end-to-end wiring (auth routes, BA sign-in) can be
// validated without blocking on design.
//
// The form wires to Better Auth's email/password endpoint in Unit 5. SSO
// buttons kick off BA's native OAuth flow for Google/Apple/Okta.
//
// No Firebase SDK is loaded client-side. Firebase users migrate transparently
// via the server-side fallback in Unit 5.

export default function LoginPage() {
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
      <hr />
      <h2>Or sign in with</h2>
      <ul>
        <li>
          <form method="post" action="/api/auth/sign-in/google">
            <button type="submit">Google</button>
          </form>
        </li>
        <li>
          <form method="post" action="/api/auth/sign-in/apple">
            <button type="submit">Apple</button>
          </form>
        </li>
        <li>
          <form method="post" action="/api/auth/sign-in/okta">
            <button type="submit">Okta</button>
          </form>
        </li>
      </ul>
      <p>
        <small>
          Placeholder UI. Design work tracked separately via Stitch; replaced in
          Unit 12 of the admin-app plan.
        </small>
      </p>
    </main>
  )
}
