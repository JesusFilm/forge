import { useRouter } from "expo-router"

import { CustomizeSheet } from "../../src/components/dailyPause/CustomizeSheet"

// R27: the Customize sheet. U7's layout presents this route as a form sheet
// over the Opening, and Done closes it.
export default function CustomizeRoute() {
  const router = useRouter()
  return <CustomizeSheet onDone={() => router.back()} />
}
