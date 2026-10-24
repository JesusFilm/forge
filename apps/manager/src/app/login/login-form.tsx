"use client"

export function LoginForm({
  expired,
  error,
  loginHref,
}: {
  expired: boolean
  error?: string
  loginHref: string
}) {
  const message = expired
    ? "Your session has expired. Please sign in again."
    : error
      ? "Manager access was not granted for this account."
      : null

  return (
    <div className="login-card">
      {message && (
        <div className="login-error" role="alert">
          {message}
        </div>
      )}

      <a className="login-button" href={loginHref}>
        Sign in with Jesus Film
      </a>
    </div>
  )
}
