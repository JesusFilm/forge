// Wrapper around fetch for internal API calls.
// Automatically signs the user out and redirects to login
// when any API response indicates an expired or invalid session.

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired")
    this.name = "SessionExpiredError"
  }
}

function handleSessionExpiry() {
  // Clear the JWT cookie and redirect to login
  void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
    window.location.href = "/login?expired=1"
  })
}

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)

  if (response.status === 401) {
    handleSessionExpiry()
    throw new SessionExpiredError()
  }

  return response
}
