import { getAuthBaseUrl } from "@/config/env"

export default function AuthHome() {
  return (
    <main>
      <h1>Jesus Film Auth</h1>
      <p>{getAuthBaseUrl()}</p>
    </main>
  )
}
