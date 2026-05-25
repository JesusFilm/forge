import Link from "next/link"

import { approveAccessGrant, revokeAccessGrant } from "@/app/access/actions"
import {
  canManageInternalAccess,
  editableScopesForEnvironment,
  formatEnum,
  getAccessRegistry,
} from "@/data/access-grants"
import { requireDeveloperSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function AccessPage() {
  const session = await requireDeveloperSession("/access")
  const canManage = await canManageInternalAccess(session.subject)

  if (!canManage) {
    return (
      <main className="shell">
        <Sidebar identity={session.email ?? session.name ?? "Developer"} />
        <section className="workspace">
          <header className="page-header">
            <div>
              <p className="eyebrow">Internal Access</p>
              <h2>Developer admin required</h2>
            </div>
            <Link className="secondary-link" href="/">
              Apps
            </Link>
          </header>
          <section className="empty-panel">
            <h3>Access management is restricted</h3>
            <p>
              Your Auth account can open Developer, but it does not have an
              approved Developer admin grant for this OAuth app.
            </p>
          </section>
        </section>
      </main>
    )
  }

  const registry = await getAccessRegistry()

  return (
    <main className="shell">
      <Sidebar identity={session.email ?? session.name ?? "Developer"} />
      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">Internal Access</p>
            <h2>App user grants</h2>
          </div>
          <Link className="secondary-link" href="/">
            Apps
          </Link>
        </header>

        <section className="approval-grid" aria-label="Approve app access">
          <div className="panel-heading">
            <h3>Approve access</h3>
          </div>
          <div className="approval-list">
            {registry.environments.map((environment) => (
              <form
                action={approveAccessGrant}
                className="grant-form"
                key={environment.environmentId}
              >
                <input
                  name="environmentId"
                  type="hidden"
                  value={environment.environmentId}
                />
                <div className="grant-form-title">
                  <strong>{environment.appName}</strong>
                  <span>{formatEnum(environment.kind)}</span>
                </div>

                <label>
                  User
                  <select name="userId" required>
                    {registry.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.email} ({formatEnum(user.membershipStatus)})
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset>
                  <legend>Scopes</legend>
                  <div className="scope-grid">
                    {editableScopesForEnvironment(environment).map((scope) => (
                      <label key={`${environment.environmentId}:${scope}`}>
                        <input name="scopes" type="checkbox" value={scope} />
                        <span>{scope}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label>
                  Reason
                  <input
                    name="reason"
                    placeholder="Approved by Developer admin"
                    type="text"
                  />
                </label>

                <button type="submit">Approve grant</button>
              </form>
            ))}
          </div>
        </section>

        <section className="table-panel" aria-label="Current app grants">
          <div className="panel-heading">
            <h3>Current grants</h3>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>App</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Scopes</th>
                  <th>Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {registry.grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <strong>{grant.userEmail}</strong>
                      <small>{grant.userName}</small>
                    </td>
                    <td>{grant.appName}</td>
                    <td>{formatEnum(grant.kind)}</td>
                    <td>
                      <span className="status-pill" data-state={grant.status}>
                        {formatEnum(grant.status)}
                      </span>
                    </td>
                    <td>{grant.scopes.join(", ")}</td>
                    <td>{grant.reason ?? "No reason recorded."}</td>
                    <td>
                      {grant.status === "approved" ? (
                        <form action={revokeAccessGrant}>
                          <input
                            name="grantId"
                            type="hidden"
                            value={grant.id}
                          />
                          <input
                            name="reason"
                            type="hidden"
                            value="Revoked in Developer"
                          />
                          <button className="link-button" type="submit">
                            Revoke
                          </button>
                        </form>
                      ) : (
                        <span className="muted-text">No action</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}

function Sidebar({ identity }: { identity: string }) {
  return (
    <aside className="sidebar" aria-label="Developer navigation">
      <div>
        <p className="eyebrow">Jesus Film</p>
        <h1>Developer</h1>
      </div>
      <nav>
        <Link href="/">Apps</Link>
        <Link href="/access">Access</Link>
      </nav>
      <div className="sidebar-note">
        <span>Signed in</span>
        <strong>{identity}</strong>
      </div>
    </aside>
  )
}
