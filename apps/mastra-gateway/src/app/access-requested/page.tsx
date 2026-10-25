const reasonCopy: Record<string, string> = {
  pending: "Your request is waiting for a gateway admin to approve it.",
  revoked: "Your Studio access has been revoked.",
  missing_email: "Your Auth profile does not include an email address.",
  forbidden: "The sign-in attempt could not be verified.",
}

export default function AccessRequestedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  return (
    <main className="center-shell">
      <section className="auth-panel">
        <p className="eyebrow">Mastra Gateway</p>
        <h1>Access Requested</h1>
        <AccessReason searchParams={searchParams} />
        <form action="/api/auth/login">
          <button className="button-link" type="submit">
            Try again
          </button>
        </form>
      </section>
    </main>
  )
}

async function AccessReason({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason = "pending" } = await searchParams
  return <p>{reasonCopy[reason] ?? reasonCopy.pending}</p>
}
