import { revokeTokenRecord } from "@/app/dashboard/tokens/actions"
import { prisma } from "@/db/client"

export const dynamic = "force-dynamic"

export default async function TokensPage() {
  const tokens = await prisma.tokenRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      app: { select: { displayName: true } },
      environment: { select: { kind: true } },
      user: { select: { email: true } },
    },
  })

  return (
    <section className="dashboard-section">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Tokens</p>
          <h2>Issued token records</h2>
        </div>
      </header>

      <div className="data-panel">
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Family</th>
              <th>Status</th>
              <th>Audience</th>
              <th>Scopes</th>
              <th>Expires</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td>
                  <strong>{token.app.displayName}</strong>
                  <small>{token.environment.kind.toLowerCase()}</small>
                </td>
                <td>{token.family.toLowerCase()}</td>
                <td>{token.status.toLowerCase()}</td>
                <td>{token.audience}</td>
                <td>{token.scopes.join(", ")}</td>
                <td>{token.expiresAt.toISOString()}</td>
                <td>
                  {token.status === "ACTIVE" ? (
                    <form action={revokeTokenRecord}>
                      <input type="hidden" name="tokenId" value={token.id} />
                      <button className="danger-button" type="submit">
                        Revoke
                      </button>
                    </form>
                  ) : (
                    "none"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
