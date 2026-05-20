"use client"

export function LoginForm({
  expired,
  error,
}: {
  expired: boolean
  error?: string
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

      <a className="login-button" href="/api/auth/login">
        Sign in with Jesus Film
      </a>
    </div>
  )
}
