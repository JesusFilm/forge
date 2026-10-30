export type PortalUser = { login: string; id: number }
export type PortalAllowlist = { users: PortalUser[] }

const LOGIN = /^(?=.{1,39}$)[a-z\d]+(?:-[a-z\d]+)*$/i

export function parsePortalAllowlist(value: unknown): PortalAllowlist {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_allowlist")
  const object = value as Record<string, unknown>
  if (Object.keys(object).length !== 1 || !Array.isArray(object.users))
    throw new Error("invalid_allowlist")
  const seen = new Set<string>()
  const ids = new Set<number>()
  const users = object.users.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("invalid_user")
    const user = entry as Record<string, unknown>
    if (
      Object.keys(user).sort().join(",") !== "id,login" ||
      typeof user.login !== "string" ||
      !LOGIN.test(user.login) ||
      !Number.isSafeInteger(user.id) ||
      (user.id as number) <= 0
    )
      throw new Error("invalid_user")
    const login = user.login.toLowerCase()
    if (seen.has(login)) throw new Error("duplicate_login")
    if (ids.has(user.id as number)) throw new Error("duplicate_id")
    seen.add(login)
    ids.add(user.id as number)
    return { login, id: user.id as number }
  })
  return { users }
}

export function admitted(
  list: PortalAllowlist,
  login: string,
  id: number,
): boolean {
  return list.users.some(
    (user) => user.login === login.toLowerCase() && user.id === id,
  )
}
