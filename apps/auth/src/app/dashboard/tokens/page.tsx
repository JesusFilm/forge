import { revokeTokenRecord } from "@/app/dashboard/tokens/actions"
import { prisma } from "@/db/client"

import {
  DashboardPageShell,
  DashboardPanel,
  DashboardTable,
  DashboardTd,
  DashboardTh,
} from "@/app/dashboard/dashboard-components"

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
    <DashboardPageShell>
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ef3340]">
            Tokens
          </p>
          <h2 className="mb-0 mt-0.5 text-3xl font-bold">
            Issued token records
          </h2>
        </div>
      </header>

      <DashboardPanel>
        <DashboardTable>
          <thead>
            <tr>
              <DashboardTh>App</DashboardTh>
              <DashboardTh>Family</DashboardTh>
              <DashboardTh>Status</DashboardTh>
              <DashboardTh>Audience</DashboardTh>
              <DashboardTh>Scopes</DashboardTh>
              <DashboardTh>Expires</DashboardTh>
              <DashboardTh>Action</DashboardTh>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <DashboardTd>
                  <strong>{token.app.displayName}</strong>
                  <small className="block text-[#78716c]">
                    {token.environment.kind.toLowerCase()}
                  </small>
                </DashboardTd>
                <DashboardTd>{token.family.toLowerCase()}</DashboardTd>
                <DashboardTd>{token.status.toLowerCase()}</DashboardTd>
                <DashboardTd>{token.audience}</DashboardTd>
                <DashboardTd>{token.scopes.join(", ")}</DashboardTd>
                <DashboardTd>{token.expiresAt.toISOString()}</DashboardTd>
                <DashboardTd>
                  {token.status === "ACTIVE" ? (
                    <form action={revokeTokenRecord}>
                      <input type="hidden" name="tokenId" value={token.id} />
                      <button
                        className="min-h-8 cursor-pointer rounded border border-red-200 bg-red-50 px-2.5 font-semibold text-red-800 hover:bg-red-100"
                        type="submit"
                      >
                        Revoke
                      </button>
                    </form>
                  ) : (
                    "none"
                  )}
                </DashboardTd>
              </tr>
            ))}
          </tbody>
        </DashboardTable>
      </DashboardPanel>
    </DashboardPageShell>
  )
}
