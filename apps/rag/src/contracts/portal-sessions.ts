export type PortalIdentity = { id: number; login: string }

export type SessionStore = {
  createState(state: string, browser: string): Promise<void>
  consumeState(state: string, browser: string): Promise<boolean>
  createSession(token: string, identity: PortalIdentity): Promise<void>
  getSession(token: string): Promise<PortalIdentity | null>
  revokeSession(token: string): Promise<void>
  close(): Promise<void>
}
