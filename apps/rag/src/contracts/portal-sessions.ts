export type PortalIdentity = { id: number; login: string }
export type PortalSessionExpiry = {
  expiresAt: string
  absoluteExpiresAt: string
}

export type SessionStore = {
  createState(state: string, browser: string): Promise<void>
  consumeState(state: string, browser: string): Promise<boolean>
  createSession(
    token: string,
    identity: PortalIdentity,
  ): Promise<PortalSessionExpiry>
  getSession(token: string): Promise<PortalIdentity | null>
  getExpiry(token: string): Promise<PortalSessionExpiry | null>
  renewSession(token: string): Promise<PortalSessionExpiry | null>
  revokeSession(token: string): Promise<void>
  close(): Promise<void>
}
