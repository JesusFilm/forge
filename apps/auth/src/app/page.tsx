import { redirect } from "next/navigation"

type AuthHomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function appendParam(
  params: URLSearchParams,
  name: string,
  value: string | string[] | undefined,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      params.append(name, item)
    }
    return
  }

  if (value) {
    params.set(name, value)
  }
}

export default async function AuthHome({ searchParams }: AuthHomeProps = {}) {
  const params = (await searchParams) ?? {}
  const loginParams = new URLSearchParams()
  appendParam(loginParams, "callbackURL", params.callbackURL)
  appendParam(loginParams, "error", params.error)

  const query = loginParams.toString()
  redirect(
    `/login${query ? `?${query}` : ""}` as Parameters<typeof redirect>[0],
  )
}
